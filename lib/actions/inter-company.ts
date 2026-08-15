"use server";

import { and, desc, eq, inArray, like } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import {
  companies,
  documents,
  documentTypes,
  documentLines,
  documentNumberLedger,
  inventoryTransactions,
  items,
  ledgerEntries,
} from "@/lib/db/schema";
import { getSession } from "@/lib/auth/session";
import { requirePermission } from "@/lib/auth/permissions";
import { getScopeCompanyIds } from "@/lib/auth/scope";
import { CACHE, invalidateLookups } from "@/lib/queries/lookups";
import { ensureDocumentType, nextDocumentNumber } from "@/lib/actions/document-numbering";
import { resolveContactId, resolveItemId, resolveUnitId } from "@/lib/actions/resolve-refs";
import { describeDbError, type ActionResult } from "@/lib/actions/guard";
import { recordAudit } from "@/lib/actions/audit";
import { claimOperation, readOperationId, DuplicateOperationError } from "@/lib/actions/operation-id";

// One company selling to the other was two jobs done by hand: a sale in the
// seller and a matching purchase in the buyer, typed twice, with two chances to
// mistype a quantity. This does both from one screen, in one transaction — either
// both documents exist or neither does.
//
// The two documents are ordinary SALES_INVOICE and PURCHASE_INVOICE rows, so they
// also show up in the Sales and Stock Purchase lists and can be edited or deleted
// there like anything else.
//
// The pair is tied together through documents.reason: both sides carry
// "Inter-Company <key>" with the same random key. That column already exists and
// already means "why this document exists", which is exactly what's being said —
// no schema change, and the prefix is what the list page filters on.
// ponytail: reason as the join key; add a real linked_document_id column if a
// second thing ever needs to pair documents.
const IC_REASON = "Inter-Company";

// The catalogs are per company (items.company_id is NOT NULL), so a line resolves
// to two different item rows: the seller's picked item, and the buyer's item of
// the same name, created on the fly if the buyer has never stocked it.

interface TransferLineInput {
  itemId: string;
  itemName: string;
  unitId: string;
  unitName: string;
  quantity: string;
  rate: string;
}

function readLines(formData: FormData): TransferLineInput[] {
  let lines: TransferLineInput[];
  try {
    lines = JSON.parse(String(formData.get("linesJson") ?? "[]"));
  } catch {
    return [];
  }
  return lines.filter((l) => (l.itemId || l.itemName?.trim()) && Number(l.quantity) > 0);
}

// Everything the two documents are written from, validated once for create and
// edit. The companies are only read on create — an edit keeps the pair where it
// is (see updateInterCompanySale).
function readHeader(formData: FormData) {
  const sellerCompanyId = String(formData.get("sellerCompanyId") ?? "");
  const buyerCompanyId = String(formData.get("buyerCompanyId") ?? "");
  const documentDate = String(formData.get("documentDate") ?? "");
  const fromLocationId = String(formData.get("fromLocationId") ?? "");
  const toLocationId = String(formData.get("toLocationId") ?? "");
  const lines = readLines(formData);

  const error = !documentDate
    ? "Document date is required."
    : !fromLocationId || !toLocationId
      ? "Pick where the stock ships from and where it lands."
      : lines.length === 0
        ? "Add at least one item with a quantity."
        : null;

  return { sellerCompanyId, buyerCompanyId, documentDate, fromLocationId, toLocationId, lines, error };
}

function linesTotal(lines: TransferLineInput[]) {
  return lines.reduce((sum, l) => sum + Number(l.quantity) * (Number(l.rate) || 0), 0);
}

type InterCompanyTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

interface Side {
  companyId: string;
  documentId: string;
  locationId: string;
}

// The buyer needs a row of its own — items.company_id is NOT NULL and stock hangs
// off the row — but it is the same physical product, so it gets the seller's name
// and the seller's SKU rather than a freshly minted one.
//
// Matched on SKU, which is stable. This used to go through resolveItemId by name,
// and the name it was handed was the picker's *label* ("Widget (RH-00003)"), so
// every inter-company sale created a second catalog entry named after the label
// with a brand new SKU. Migration 0042 renamed the rows that made.
async function mirrorItemToBuyer(tx: InterCompanyTx, sellerItemId: string | null, buyerCompanyId: string): Promise<string | null> {
  if (!sellerItemId) return null;
  const [source] = await tx.select({ name: items.name, sku: items.sku }).from(items).where(eq(items.id, sellerItemId)).limit(1);
  if (!source) return null;

  const [existing] = await tx
    .select({ id: items.id })
    .from(items)
    .where(and(eq(items.companyId, buyerCompanyId), eq(items.sku, source.sku)))
    .limit(1);
  if (existing) return existing.id;

  const [row] = await tx
    .insert(items)
    .values({ companyId: buyerCompanyId, name: source.name, sku: source.sku })
    .returning({ id: items.id });
  return row.id;
}

// One pass over the lines, resolving both companies' item rows and writing both
// sides' lines and movements: -1 out of the seller's location, +1 into the
// buyer's. Shared by create and edit — an edit clears the old lines first and
// calls this again, so the two sides can't drift apart.
async function writeInterCompanyLines(
  tx: InterCompanyTx,
  lines: TransferLineInput[],
  seller: Side,
  buyer: Side,
) {
  for (const [i, l] of lines.entries()) {
    const quantity = String(Number(l.quantity));
    const rate = String(Number(l.rate) || 0);
    const lineTotal = String(Number(quantity) * Number(rate));
    const unitId = await resolveUnitId(tx, l.unitId || null, l.unitName || null);
    const sellerItemId = await resolveItemId(tx, seller.companyId, l.itemId || null, l.itemName || null);
    const buyerItemId = await mirrorItemToBuyer(tx, sellerItemId, buyer.companyId);

    const line = {
      lineNo: i + 1,
      sortOrder: i,
      unitId,
      quantity,
      baseQuantity: quantity,
      unitPrice: rate,
      lineTotal,
    };

    for (const side of [
      { ...seller, itemId: sellerItemId, movement: -1 as const },
      { ...buyer, itemId: buyerItemId, movement: 1 as const },
    ]) {
      const [inserted] = await tx
        .insert(documentLines)
        .values({
          ...line,
          companyId: side.companyId,
          documentId: side.documentId,
          itemId: side.itemId,
          locationId: side.locationId,
        })
        .returning({ id: documentLines.id });

      if (side.itemId) {
        await tx.insert(inventoryTransactions).values({
          companyId: side.companyId,
          documentLineId: inserted.id,
          movement: side.movement,
          quantity,
          baseQuantity: quantity,
          unitCost: rate,
          totalCost: lineTotal,
        });
      }
    }
  }
}

// inventory_transactions.document_line_id is ON DELETE RESTRICT, so the movements
// go before the lines they point at can be replaced or dropped.
async function clearLines(tx: InterCompanyTx, documentIds: string[]) {
  const oldLines = await tx.select({ id: documentLines.id }).from(documentLines).where(inArray(documentLines.documentId, documentIds));
  if (oldLines.length > 0) {
    await tx.delete(inventoryTransactions).where(
      inArray(
        inventoryTransactions.documentLineId,
        oldLines.map((l) => l.id),
      ),
    );
  }
  await tx.delete(documentLines).where(inArray(documentLines.documentId, documentIds));
}

// Items and contacts can be created on the fly here, and stock moved on both
// sides, so the cached lookups and every page reading them are stale.
function invalidateInterCompanyViews() {
  invalidateLookups(CACHE.documentTypes, CACHE.items, CACHE.contacts, CACHE.cheques);
  revalidatePath("/inventory/inter-company");
  revalidatePath("/sales");
  revalidatePath("/purchases/stock");
  revalidatePath("/inventory/stock");
  revalidatePath("/inventory/products");
  revalidatePath("/ledger");
}

// --- Reads ---

export async function listInterCompanySales() {
  const session = await getSession();
  requirePermission(session, "sales", "view");

  // Both halves are pulled unscoped and the pair filtered afterwards: a sale in
  // Royal and its purchase in M52 can't both pass a single company filter, and
  // dropping one half would leave the row with no buyer or seller to show.
  const rows = await db
    .select({
      id: documents.id,
      reason: documents.reason,
      number: documents.number,
      companyId: documents.companyId,
      company: companies.name,
      documentDate: documents.documentDate,
      status: documents.status,
      grandTotal: documents.grandTotal,
      code: documentTypes.code,
    })
    .from(documents)
    .innerJoin(documentTypes, eq(documentTypes.id, documents.documentTypeId))
    .innerJoin(companies, eq(companies.id, documents.companyId))
    .where(like(documents.reason, `${IC_REASON} %`))
    .orderBy(desc(documents.documentDate));

  const scopeIds = await getScopeCompanyIds();
  const pairs = new Map<string, { sale?: (typeof rows)[number]; purchase?: (typeof rows)[number] }>();
  for (const r of rows) {
    const pair = pairs.get(r.reason!) ?? {};
    if (r.code === "SALES_INVOICE") pair.sale = r;
    else pair.purchase = r;
    pairs.set(r.reason!, pair);
  }

  return [...pairs.values()]
    .filter((p) => p.sale && (scopeIds.includes(p.sale.companyId) || (p.purchase && scopeIds.includes(p.purchase.companyId))))
    .map((p) => ({
      id: p.sale!.id,
      saleNumber: p.sale!.number,
      purchaseNumber: p.purchase?.number ?? "—",
      seller: p.sale!.company,
      buyer: p.purchase?.company ?? "—",
      documentDate: p.sale!.documentDate,
      status: p.sale!.status,
      grandTotal: p.sale!.grandTotal,
    }));
}

// The pair, read back by the seller's document id — that's what the list links to
// and what the edit page is addressed by.
export async function getInterCompanySale(saleId: string) {
  const session = await getSession();
  requirePermission(session, "sales", "view");

  const [sale] = await db.select().from(documents).where(eq(documents.id, saleId)).limit(1);
  if (!sale?.reason?.startsWith(`${IC_REASON} `)) return null;

  const [sides, sellerLines, [seller]] = await Promise.all([
    db.select().from(documents).where(eq(documents.reason, sale.reason)),
    db
      .select({
        itemId: documentLines.itemId,
        unitId: documentLines.unitId,
        locationId: documentLines.locationId,
        quantity: documentLines.quantity,
        unitPrice: documentLines.unitPrice,
      })
      .from(documentLines)
      .where(eq(documentLines.documentId, saleId))
      .orderBy(documentLines.lineNo),
    db.select({ name: companies.name }).from(companies).where(eq(companies.id, sale.companyId)).limit(1),
  ]);
  const purchase = sides.find((d) => d.id !== sale.id);
  if (!purchase) return null;

  const [buyerLine] = await db
    .select({ locationId: documentLines.locationId })
    .from(documentLines)
    .where(eq(documentLines.documentId, purchase.id))
    .limit(1);
  const [buyer] = await db.select({ name: companies.name }).from(companies).where(eq(companies.id, purchase.companyId)).limit(1);

  return {
    id: sale.id,
    saleNumber: sale.number,
    purchaseId: purchase.id,
    purchaseNumber: purchase.number,
    sellerCompanyId: sale.companyId,
    buyerCompanyId: purchase.companyId,
    sellerName: seller?.name ?? "—",
    buyerName: buyer?.name ?? "—",
    documentDate: sale.documentDate,
    status: sale.status,
    fromLocationId: sellerLines[0]?.locationId ?? "",
    toLocationId: buyerLine?.locationId ?? "",
    // Ids, not names — this feeds the edit form, which resolves its own labels
    // from the option lists.
    lines: sellerLines.map((l) => ({
      itemId: l.itemId ?? "",
      unitId: l.unitId ?? "",
      quantity: l.quantity,
      rate: l.unitPrice,
    })),
  };
}

// --- Writes ---

export interface InterCompanyResult {
  error?: string;
  success?: boolean;
  saleId?: string;
  saleNumber?: string;
  purchaseId?: string;
  purchaseNumber?: string;
}

export async function createInterCompanySale(_prevState: InterCompanyResult | undefined, formData: FormData): Promise<InterCompanyResult> {
  const session = await getSession();
  // Writes on both sides of the fence, so it needs the permission for both.
  requirePermission(session, "sales", "create");
  requirePermission(session, "purchases", "create");

  const header = readHeader(formData);
  const { sellerCompanyId, buyerCompanyId } = header;
  if (!sellerCompanyId || !buyerCompanyId) return { error: "Pick which company sells and which one buys." };
  if (sellerCompanyId === buyerCompanyId) return { error: "Seller and buyer must be different companies." };
  if (header.error) return { error: header.error };

  const [[seller], [buyer]] = await Promise.all([
    db.select({ name: companies.name }).from(companies).where(eq(companies.id, sellerCompanyId)).limit(1),
    db.select({ name: companies.name }).from(companies).where(eq(companies.id, buyerCompanyId)).limit(1),
  ]);
  if (!seller || !buyer) return { error: "Company not found." };

  const [salesType, purchaseType] = await Promise.all([
    ensureDocumentType({
      companyId: sellerCompanyId,
      code: "SALES_INVOICE",
      name: "Sales Invoice",
      series: "SI",
      affectsInventory: true,
      affectsAccounting: true,
      affectsReceivable: true,
      active: true,
    }),
    ensureDocumentType({
      companyId: buyerCompanyId,
      code: "PURCHASE_INVOICE",
      name: "Purchase Invoice",
      series: "PI",
      affectsInventory: true,
      affectsAccounting: true,
      affectsPayable: true,
      active: true,
    }),
  ]);

  const total = linesTotal(header.lines);
  const reason = `${IC_REASON} ${crypto.randomUUID()}`;
  const operationId = readOperationId(formData);

  let result: { saleId: string; saleNumber: string; purchaseId: string; purchaseNumber: string };
  try {
    result = await db.transaction(async (tx) => {
      // First statement: claim the operation id, or abort as a duplicate.
      if (!(await claimOperation(tx, operationId))) throw new DuplicateOperationError();
      const saleNumber = await nextDocumentNumber(salesType.series, tx);
      const purchaseNumber = await nextDocumentNumber(purchaseType.series, tx);

      // Each company books the other as a contact of its own — the buyer is a
      // customer in the seller's books, the seller a supplier in the buyer's.
      // Created by name on first use, same as any typed-in contact.
      const customerId = await resolveContactId(tx, sellerCompanyId, null, buyer.name);
      const supplierId = await resolveContactId(tx, buyerCompanyId, null, seller.name);

      const headerValues = {
        number: "",
        status: "posted" as const,
        documentDate: header.documentDate,
        subtotal: String(total),
        grandTotal: String(total),
        reason,
        // Left owing on both sides: the seller is due the money, the buyer owes
        // it. Settle it by editing either document in its own page.
        isPaid: false,
        paidAmount: "0",
        createdBy: session.userId,
      };

      const [sale] = await tx
        .insert(documents)
        .values({ ...headerValues, companyId: sellerCompanyId, documentTypeId: salesType.id, number: saleNumber, contactId: customerId })
        .returning({ id: documents.id });
      const [purchase] = await tx
        .insert(documents)
        .values({ ...headerValues, companyId: buyerCompanyId, documentTypeId: purchaseType.id, number: purchaseNumber, contactId: supplierId })
        .returning({ id: documents.id });

      await writeInterCompanyLines(
        tx,
        header.lines,
        { companyId: sellerCompanyId, documentId: sale.id, locationId: header.fromLocationId },
        { companyId: buyerCompanyId, documentId: purchase.id, locationId: header.toLocationId },
      );

      await tx.insert(documentNumberLedger).values([
        { companyId: sellerCompanyId, documentTypeId: salesType.id, number: saleNumber, documentId: sale.id },
        { companyId: buyerCompanyId, documentTypeId: purchaseType.id, number: purchaseNumber, documentId: purchase.id },
      ]);

      // Receivable on the seller's ledger (debit — owed to us), payable on the
      // buyer's (credit — we owe), both under the other company's contact name.
      if (total > 0) {
        await tx.insert(ledgerEntries).values([
          { companyId: sellerCompanyId, documentId: sale.id, debit: String(total) },
          { companyId: buyerCompanyId, documentId: purchase.id, credit: String(total) },
        ]);
      }

      return { saleId: sale.id, saleNumber, purchaseId: purchase.id, purchaseNumber };
    });
  } catch (e) {
    if (e instanceof DuplicateOperationError) return { error: e.message };
    return { error: describeDbError(e, "Can't create — a document number is already in use for one of these companies.") };
  }

  invalidateInterCompanyViews();
  await recordAudit({
    action: "create",
    entity: "inter-company sale",
    entityId: result.saleId,
    summary: `${result.saleNumber} / ${result.purchaseNumber}`,
    companyId: sellerCompanyId,
    detail: `Total ${total}`,
  });
  return { success: true, ...result };
}

// Editing replays both documents: the old lines, movements and ledger rows go and
// the new ones are written in their place. Stock and balances land correctly
// because they're derived from what's there now, not from a running total.
//
// Which companies sell and buy is fixed once created — moving a document to
// another company would mean renumbering it out of one series and into another.
// ponytail: delete and re-enter to change the companies.
export async function updateInterCompanySale(
  saleId: string,
  _prevState: InterCompanyResult | undefined,
  formData: FormData,
): Promise<InterCompanyResult> {
  const session = await getSession();
  requirePermission(session, "sales", "edit");
  requirePermission(session, "purchases", "edit");

  const header = readHeader(formData);
  if (header.error) return { error: header.error };

  const [sale] = await db.select().from(documents).where(eq(documents.id, saleId)).limit(1);
  if (!sale?.reason?.startsWith(`${IC_REASON} `)) return { error: "Inter-company sale not found." };
  const [purchase] = (await db.select().from(documents).where(eq(documents.reason, sale.reason))).filter((d) => d.id !== sale.id);
  if (!purchase) return { error: "The matching purchase is missing — edit each document from its own page." };

  const total = linesTotal(header.lines);

  try {
    await db.transaction(async (tx) => {
      // ledger_entries.document_id is ON DELETE NO ACTION, and the amount owed is
      // about to change, so both sides' rows are dropped and re-added from the
      // new total.
      await tx.delete(ledgerEntries).where(inArray(ledgerEntries.documentId, [sale.id, purchase.id]));
      await clearLines(tx, [sale.id, purchase.id]);

      for (const doc of [sale, purchase]) {
        // Anything already settled on the document's own page stays settled —
        // only what's still owed is recomputed against the new total.
        const paid = Number(doc.paidAmount);
        await tx
          .update(documents)
          .set({
            documentDate: header.documentDate,
            subtotal: String(total),
            grandTotal: String(total),
            isPaid: paid >= total,
            updatedAt: new Date(),
          })
          .where(eq(documents.id, doc.id));

        const balance = total - paid;
        if (balance > 0) {
          await tx.insert(ledgerEntries).values(
            doc.id === sale.id
              ? { companyId: doc.companyId, documentId: doc.id, debit: String(balance) }
              : { companyId: doc.companyId, documentId: doc.id, credit: String(balance) },
          );
        }
      }

      await writeInterCompanyLines(
        tx,
        header.lines,
        { companyId: sale.companyId, documentId: sale.id, locationId: header.fromLocationId },
        { companyId: purchase.companyId, documentId: purchase.id, locationId: header.toLocationId },
      );
    });
  } catch (e) {
    return { error: describeDbError(e, "Can't save this inter-company sale.") };
  }

  invalidateInterCompanyViews();
  revalidatePath(`/inventory/inter-company/${saleId}`);
  return { success: true, saleId: sale.id, saleNumber: sale.number, purchaseId: purchase.id, purchaseNumber: purchase.number };
}

export async function deleteInterCompanySale(_prevState: ActionResult | undefined, formData: FormData) {
  const session = await getSession();
  requirePermission(session, "sales", "delete");
  requirePermission(session, "purchases", "delete");

  const saleId = String(formData.get("documentId") ?? "");
  const [sale] = await db.select().from(documents).where(eq(documents.id, saleId)).limit(1);
  if (!sale?.reason?.startsWith(`${IC_REASON} `)) return { error: "Inter-company sale not found." };
  const [purchase] = (await db.select().from(documents).where(eq(documents.reason, sale.reason))).filter((d) => d.id !== sale.id);

  const sides = purchase ? [sale, purchase] : [sale];
  // Money that's already moved through a bank or cash account is reversed by the
  // settlement code on the document's own page, not here — this deletes the pair,
  // it doesn't unwind payments.
  if (sides.some((d) => Number(d.paidAmount) > 0)) {
    return { error: "Something has been paid against this — clear the payment on the sale or purchase page first." };
  }
  const ids = sides.map((d) => d.id);

  try {
    await db.transaction(async (tx) => {
      await tx.delete(ledgerEntries).where(inArray(ledgerEntries.documentId, ids));
      await clearLines(tx, ids);
      await tx.delete(documents).where(inArray(documents.id, ids));
    });
  } catch (e) {
    return { error: describeDbError(e, "Can't delete — one of these documents is still referenced elsewhere.") };
  }

  invalidateInterCompanyViews();
  await recordAudit({ action: "delete", entity: "inter-company sale", entityId: saleId, summary: sale.number, companyId: sale.companyId });
  return { success: true };
}
