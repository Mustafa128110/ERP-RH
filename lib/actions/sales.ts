"use server";

import { and, desc, eq, gte, ilike, inArray, lte, ne, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import {
  documents,
  documentTypes,
  documentLines,
  documentNumberLedger,
  companies,
  contacts,
  items,
  units,
  locations,
  chequeRegister,
  inventoryTransactions,
  ledgerEntries,
} from "@/lib/db/schema";
import { getSession } from "@/lib/auth/session";
import { requirePermission } from "@/lib/auth/permissions";
import { companyInScope } from "@/lib/auth/scope";
import { CACHE, getAvailableCheques, invalidateLookups } from "@/lib/queries/lookups";
import { ensureDocumentType, nextDocumentNumber } from "@/lib/actions/document-numbering";
import { adjustSettlementBalance, type SettlementType } from "@/lib/actions/settlement";
import { resolveContactId, resolveItemId, resolveUnitId } from "@/lib/actions/resolve-refs";
import { DEFAULT_SALE_TYPE, isSaleType } from "@/lib/sale-constants";
import { round1 } from "@/lib/format";
import { guard, describeDbError, type ActionResult } from "@/lib/actions/guard";
import { recordAudit } from "@/lib/actions/audit";

export interface SaleItemRow {
  itemName: string;
  quantity: string;
  unitPrice: string;
  lineTotal: string;
  unitSymbol: string | null;
}

export interface SalesFilters {
  // Inclusive date range on document_date; either end can stand alone.
  from?: string;
  to?: string;
  // Customer name, matched anywhere in it, case-insensitively.
  customer?: string;
  // documents.sale_type — counter / balochistan / shopify. Anything that isn't
  // one of them is ignored rather than returning nothing.
  saleType?: string;
}

// Filtering in SQL rather than over the returned array: the lines query is driven
// by document type, so a JS filter would still have dragged every sale and every
// line of it back before throwing most away.
export async function listSales(filters: SalesFilters = {}) {
  const session = await getSession();
  requirePermission(session, "sales", "view");
  const scope = and(
    await companyInScope(documents.companyId),
    filters.from ? gte(documents.documentDate, filters.from) : undefined,
    filters.to ? lte(documents.documentDate, filters.to) : undefined,
    filters.saleType && isSaleType(filters.saleType) ? eq(documents.saleType, filters.saleType) : undefined,
  );

  // The lines query used to wait on the document ids from the first query, which
  // made two ~170ms round trips where one would do. Selecting lines by the same
  // document *type* instead of by a list of ids removes that dependency, so both
  // run concurrently and the page pays for one trip.
  const [docs, lineRows] = await Promise.all([
    db
      .select({
        id: documents.id,
        number: documents.number,
        documentDate: documents.documentDate,
        subtotal: documents.subtotal,
        grandTotal: documents.grandTotal,
        isPaid: documents.isPaid,
        paidAmount: documents.paidAmount,
        discountTotal: documents.discountTotal,
        taxTotal: documents.taxTotal,
        shippingTotal: documents.shippingTotal,
        saleType: documents.saleType,
        customer: contacts.displayName,
      })
      .from(documents)
      .innerJoin(documentTypes, eq(documentTypes.id, documents.documentTypeId))
      .leftJoin(contacts, eq(contacts.id, documents.contactId))
      // The name filter lives here rather than in `scope`: the lines query below
      // doesn't join contacts, and it doesn't need to — extra lines for filtered
      // out sales are simply never looked up.
      .where(
        and(
          eq(documentTypes.code, "SALES_INVOICE"),
          scope,
          filters.customer ? ilike(contacts.displayName, `%${filters.customer}%`) : undefined,
        ),
      )
      // Newest first. createdAt breaks the tie because a day's sales all carry the
      // same document_date — without it the order within today is whatever the
      // planner returns, so a sale just entered could land mid-list.
      .orderBy(desc(documents.documentDate), desc(documents.createdAt)),
    db
      .select({
        documentId: documentLines.documentId,
        itemName: items.name,
        quantity: documentLines.quantity,
        unitPrice: documentLines.unitPrice,
        lineTotal: documentLines.lineTotal,
        unitSymbol: units.symbol,
      })
      .from(documentLines)
      .innerJoin(documents, eq(documents.id, documentLines.documentId))
      .innerJoin(documentTypes, eq(documentTypes.id, documents.documentTypeId))
      .innerJoin(items, eq(items.id, documentLines.itemId))
      .leftJoin(units, eq(units.id, documentLines.unitId))
      .where(and(eq(documentTypes.code, "SALES_INVOICE"), scope))
      .orderBy(documentLines.lineNo),
  ]);

  const linesByDoc = new Map<string, SaleItemRow[]>();
  for (const l of lineRows) {
    const arr = linesByDoc.get(l.documentId) ?? [];
    arr.push({ itemName: l.itemName, quantity: l.quantity, unitPrice: l.unitPrice, lineTotal: l.lineTotal, unitSymbol: l.unitSymbol });
    linesByDoc.set(l.documentId, arr);
  }

  return docs.map((d) => ({ ...d, items: linesByDoc.get(d.id) ?? [] }));
}

// Cheques available to settle a sale: unlinked everywhere, plus (when editing)
// the one already on this invoice. An action rather than a plain query because
// the invoice list re-fetches it from the browser when a popup opens.
export async function listChequesForSales(currentDocumentId?: string) {
  return getAvailableCheques(currentDocumentId);
}

// What this customer still owes on every other invoice — the "previous balance"
// line the sale form shows under the grand total, so the total handed over at
// the counter is the whole of what's due, not just today's basket.
//
// Read off ledger_entries, which is the whole of what has moved on this
// contact's books: the sale's debit, a payment received's credit, and any
// journal entry posted from the Ledger screen. It used to sum
// (grand_total - paid_amount) over the invoices instead, and that number only
// moves when someone edits the invoice — a payment taken on the Payments screen
// never writes back to `documents.paid_amount`, so a customer who had settled up
// still arrived at the counter carrying their old balance while the Ledger
// showed them at nil.
//
// The per-invoice Balance column on the invoice list stays as it was, and
// should: an unallocated payment doesn't belong to any one invoice. This is the
// contact's running total, the same figure the Ledger's "Owes Us" column shows,
// so the two screens now agree by construction rather than by coincidence.
//
// Sign follows the ledger convention (credit - debit, positive = we owe them),
// inverted here because this asks the receivable question. A contact who is also
// a supplier nets across both — one running account, which is what the Ledger
// already reports for them — and a net payable clamps to zero, showing no line.
export async function getCustomerOutstanding(contactId: string, excludeSaleId?: string): Promise<number> {
  if (!contactId) return 0;
  const session = await getSession();
  requirePermission(session, "sales", "view");

  const [row] = await db
    .select({
      owed: sql<string>`coalesce(sum(${ledgerEntries.debit} - ${ledgerEntries.credit}), 0)`,
    })
    .from(ledgerEntries)
    .innerJoin(documents, eq(documents.id, ledgerEntries.documentId))
    .where(
      and(
        eq(documents.contactId, contactId),
        // Editing an invoice must not count that invoice as part of what was
        // owed beforehand.
        excludeSaleId ? ne(documents.id, excludeSaleId) : undefined,
        await companyInScope(ledgerEntries.companyId),
      ),
    );

  return Math.max(0, round1(Number(row?.owed ?? 0)));
}

export async function getSale(documentId: string) {
  const session = await getSession();
  requirePermission(session, "sales", "view");

  // All three only need the id that was passed in, so there is nothing to wait
  // for between them — as three sequential statements this cost three round
  // trips to open one sale for editing.
  const [[doc], lineRows, [linkedCheque]] = await Promise.all([
    db.select().from(documents).where(eq(documents.id, documentId)).limit(1),
    db.select().from(documentLines).where(eq(documentLines.documentId, documentId)).orderBy(documentLines.lineNo),
    db.select({ id: chequeRegister.id }).from(chequeRegister).where(eq(chequeRegister.documentId, documentId)).limit(1),
  ]);
  if (!doc) return null;

  const settlementType: SettlementType | null = doc.bankAccountId ? "account" : doc.cashAccountId ? "cash" : linkedCheque ? "cheque" : null;

  return {
    id: doc.id,
    companyId: doc.companyId,
    contactId: doc.contactId,
    documentDate: doc.documentDate,
    discountTotal: doc.discountTotal,
    taxTotal: doc.taxTotal,
    shippingTotal: doc.shippingTotal,
    isPaid: doc.isPaid,
    paidAmount: doc.paidAmount,
    bankAccountId: doc.bankAccountId,
    cashAccountId: doc.cashAccountId,
    chequeId: linkedCheque?.id ?? null,
    settlementType,
    // Sales recorded before the channels existed carry NULL — they were counter
    // sales, which is also what the backfill in 0043 wrote for the ones already
    // in the table.
    saleType: doc.saleType ?? DEFAULT_SALE_TYPE,
    lines: lineRows.map((l) => ({
      itemId: l.itemId ?? "",
      locationId: l.locationId ?? "",
      unitId: l.unitId ?? "",
      quantity: l.quantity,
      unitPrice: l.unitPrice,
      unitCost: l.unitCost ?? "",
    })),
  };
}

// Everything the printable invoice puts on the page, resolved to names rather
// than ids — getSale() above returns ids because it feeds the edit form, and an
// invoice is the opposite job.
export async function getInvoice(documentId: string) {
  const session = await getSession();
  requirePermission(session, "sales", "view");

  const [[doc], lineRows] = await Promise.all([
    db
      .select({
        id: documents.id,
        number: documents.number,
        documentDate: documents.documentDate,
        status: documents.status,
        subtotal: documents.subtotal,
        discountTotal: documents.discountTotal,
        taxTotal: documents.taxTotal,
        shippingTotal: documents.shippingTotal,
        grandTotal: documents.grandTotal,
        paidAmount: documents.paidAmount,
        isPaid: documents.isPaid,
        companyName: companies.name,
        companyPhone: companies.phone,
        companyEmail: companies.email,
        companyAddress: companies.address,
        companyTaxNumber: companies.taxNumber,
        customerName: contacts.displayName,
        customerPhone: contacts.phone,
        customerAddress: contacts.address,
        customerCity: contacts.city,
        code: documentTypes.code,
      })
      .from(documents)
      .innerJoin(documentTypes, eq(documentTypes.id, documents.documentTypeId))
      .innerJoin(companies, eq(companies.id, documents.companyId))
      .leftJoin(contacts, eq(contacts.id, documents.contactId))
      .where(eq(documents.id, documentId))
      .limit(1),
    db
      .select({
        itemName: items.name,
        sku: items.sku,
        quantity: documentLines.quantity,
        unitPrice: documentLines.unitPrice,
        lineTotal: documentLines.lineTotal,
        unitSymbol: units.symbol,
      })
      .from(documentLines)
      .leftJoin(items, eq(items.id, documentLines.itemId))
      .leftJoin(units, eq(units.id, documentLines.unitId))
      .where(eq(documentLines.documentId, documentId))
      .orderBy(documentLines.lineNo),
  ]);

  // Only sales invoices print as invoices — a purchase or a journal entry
  // reached by id would otherwise render under the wrong heading.
  if (!doc || doc.code !== "SALES_INVOICE") return null;

  return { ...doc, lines: lineRows };
}

interface SaleLineInput {
  itemId: string;
  itemName: string;
  locationId: string;
  unitId: string;
  unitName: string;
  quantity: string;
  unitPrice: string;
  unitCost: string;
}

function num(formData: FormData, key: string, fallback: string) {
  const v = String(formData.get(key) ?? "").trim();
  return v === "" ? fallback : v;
}

function opt(formData: FormData, key: string) {
  const v = String(formData.get(key) ?? "").trim();
  return v === "" ? null : v;
}

// The form's Paid? field is yes | partial | no. "yes" settles the whole grand
// total, "partial" settles the amount typed in, "no" settles nothing and the
// whole total becomes receivable. is_paid stays as the derived shorthand — true
// only when nothing is left owing — so nothing that reads it has to change.
function readPayment(formData: FormData, grandTotal: number) {
  const mode = String(formData.get("isPaid") ?? "no");
  const settles = mode === "yes" || mode === "partial";
  // Clamped to the document: a slipped digit (35000 on a 3500 sale) would
  // otherwise credit the drawer with money that never arrived, and a negative
  // would take money out.
  const entered = Math.min(Math.max(Number(num(formData, "paidAmount", "0")) || 0, 0), grandTotal);
  const paidAmount = mode === "yes" ? grandTotal : mode === "partial" ? entered : 0;
  const settlementType = String(formData.get("settlementType") ?? "") as SettlementType;

  return {
    mode,
    settles,
    paidAmount,
    isPaid: settles && paidAmount >= grandTotal,
    settlementType,
    bankAccountId: settles && settlementType === "account" ? opt(formData, "bankAccountId") : null,
    cashAccountId: settles && settlementType === "cash" ? opt(formData, "cashAccountId") : null,
    chequeId: settles && settlementType === "cheque" ? opt(formData, "chequeId") : null,
  };
}

function paymentError(p: ReturnType<typeof readPayment>) {
  if (!p.settles) return null;
  if (p.mode === "partial" && p.paidAmount <= 0) return "Enter how much was paid, or set Paid? to No.";
  if (!p.bankAccountId && !p.cashAccountId && !p.chequeId) return "Select an account, cash account, or cheque.";
  return null;
}

// Sales invoices are a fixed document type (never user-configured), same
// reasoning as Payments' getOrCreatePaymentDocumentType.
function getOrCreateSalesDocumentType(companyId: string) {
  return ensureDocumentType({
    companyId,
    code: "SALES_INVOICE",
    name: "Sales Invoice",
    series: "SI",
    affectsInventory: true,
    affectsAccounting: true,
    affectsReceivable: true,
    active: true,
  });
}

function readLines(formData: FormData): SaleLineInput[] {
  let lines: SaleLineInput[];
  try {
    lines = JSON.parse(String(formData.get("linesJson") ?? "[]"));
  } catch {
    return [];
  }
  // A line counts if it has a picked item or a typed item name (created on save)
  // and a quantity.
  return lines.filter((l) => (l.itemId || l.itemName?.trim()) && Number(l.quantity) > 0);
}

type SaleTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

// Sales are always from the shop, so every line's location is the shop location
// (first location of type "shop") — the form doesn't ask.
async function getShopLocationId(): Promise<string | null> {
  const [row] = await db.select({ id: locations.id }).from(locations).where(eq(locations.locationType, "shop")).limit(1);
  return row?.id ?? null;
}

// Resolve each line's item and unit inside the transaction — a typed-but-unpicked
// name creates the record on the fly (see resolve-refs.ts).
async function resolveLineRows(tx: SaleTx, companyId: string, lines: SaleLineInput[], locationId: string | null) {
  const rows = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const quantity = Number(l.quantity);
    const unitPrice = Number(l.unitPrice) || 0;
    const itemId = await resolveItemId(tx, companyId, l.itemId || null, l.itemName || null);
    const unitId = await resolveUnitId(tx, l.unitId || null, l.unitName || null);
    rows.push({
      lineNo: i + 1,
      sortOrder: i,
      itemId,
      locationId,
      unitId,
      quantity: String(quantity),
      baseQuantity: String(quantity),
      unitPrice: String(unitPrice),
      unitCost: l.unitCost ? String(Number(l.unitCost)) : null,
      lineTotal: String(quantity * unitPrice),
    });
  }
  return rows;
}

export async function createSale(_prevState: (ActionResult & { id?: string }) | undefined, formData: FormData) {
  const session = await getSession();
  requirePermission(session, "sales", "create");

  const companyId = String(formData.get("companyId") ?? "");
  const documentDate = String(formData.get("documentDate") ?? "");
  if (!companyId) return { error: "Company is required." };
  if (!documentDate) return { error: "Document date is required." };

  const validLines = readLines(formData);
  if (validLines.length === 0) return { error: "Add at least one item." };

  const contactId = opt(formData, "contactId");
  const contactName = opt(formData, "contactName");
  if (!contactId && !contactName) return { error: "Customer is required." };
  const discountTotal = num(formData, "discountTotal", "0");
  const taxTotal = num(formData, "taxTotal", "0");
  const shippingTotal = num(formData, "shippingTotal", "0");
  // Unrecognised (or absent) falls back to counter rather than erroring — it is
  // the answer for the overwhelming majority of sales, and a rejected invoice
  // over a dropdown nobody touched helps nobody.
  const saleTypeRaw = String(formData.get("saleType") ?? "");
  const saleType = isSaleType(saleTypeRaw) ? saleTypeRaw : DEFAULT_SALE_TYPE;

  const subtotal = round1(validLines.reduce((sum, l) => sum + Number(l.quantity) * (Number(l.unitPrice) || 0), 0));
  const grandTotal = round1(subtotal - Number(discountTotal) + Number(taxTotal) + Number(shippingTotal));

  // Read after the total is known — a part payment is only meaningful against it.
  const payment = readPayment(formData, grandTotal);
  const payErr = paymentError(payment);
  if (payErr) return { error: payErr };
  const { paidAmount, isPaid, settles, bankAccountId, cashAccountId, chequeId } = payment;
  const balance = grandTotal - paidAmount;

  const documentType = await getOrCreateSalesDocumentType(companyId);
  const shopLocationId = await getShopLocationId();

  let createdId: string;
  let createdNumber = "";
  try {
    createdId = await db.transaction(async (tx) => {
      // Allocated inside the transaction so a failure gives the number back.
      const number = await nextDocumentNumber(documentType.series, tx);
      createdNumber = number;
      const resolvedContactId = await resolveContactId(tx, companyId, contactId, contactName);
      const [doc] = await tx
        .insert(documents)
        .values({
          companyId,
          documentTypeId: documentType.id,
          number,
          status: "posted",
          documentDate,
          contactId: resolvedContactId,
          subtotal: String(subtotal),
          discountTotal,
          taxTotal,
          shippingTotal,
          saleType,
          grandTotal: String(grandTotal),
          isPaid,
          paidAmount: String(paidAmount),
          bankAccountId,
          cashAccountId,
          createdBy: session.userId,
        })
        .returning();

      const lineRows = await resolveLineRows(tx, companyId, validLines, shopLocationId);
      const insertedLines = await tx
        .insert(documentLines)
        .values(lineRows.map((l) => ({ ...l, companyId, documentId: doc.id })))
        .returning({ id: documentLines.id });

      // Sales reduce stock — one -1 inventory movement per line, skipping
      // lines with no catalog item (nothing to track stock of).
      const stockLines = lineRows.map((l, i) => ({ l, lineId: insertedLines[i].id })).filter(({ l }) => l.itemId);
      if (stockLines.length > 0) {
        await tx.insert(inventoryTransactions).values(
          stockLines.map(({ l, lineId }) => ({
            companyId,
            documentLineId: lineId,
            movement: -1,
            quantity: l.quantity,
            baseQuantity: l.baseQuantity,
            unitCost: l.unitPrice,
            totalCost: l.lineTotal,
          })),
        );
      }

      await tx.insert(documentNumberLedger).values({ companyId, documentTypeId: documentType.id, number, documentId: doc.id });

      // What was paid settles immediately: credit the chosen account with the
      // money that came in, which for a part payment is the amount paid, not the
      // grand total.
      if (settles && paidAmount > 0) {
        if (chequeId) {
          await tx.update(chequeRegister).set({ documentId: doc.id }).where(eq(chequeRegister.id, chequeId));
        }
        await adjustSettlementBalance(tx, "in", String(paidAmount), bankAccountId, cashAccountId, chequeId, 1);
      }

      // Whatever is left owing goes on the customer's ledger as a debit — the
      // ledger reads credit as "we owe the contact" (unpaid purchases) and debit
      // as the other direction, so a part-paid sale's balance lands under the
      // contact's name in the ledger's owed-to-us column. The contact isn't
      // stored on the entry: it hangs off the document, same as the payable side.
      if (balance > 0) {
        await tx.insert(ledgerEntries).values({ companyId, documentId: doc.id, debit: String(balance) });
      }

      return doc.id;
    });
  } catch (e) {
    return { error: describeDbError(e, "Can't create — document number already in use for this company/type.") };
  }

  // A sale can create items and contacts on the fly (resolve-refs.ts), so their
  // cached option lists are stale — without this a product typed into a sale is
  // missing from the item picker (and the products/stock pages) for the 5-minute
  // TTL, even though its stock movement is already recorded.
  invalidateLookups(CACHE.documentTypes, CACHE.cheques, CACHE.items, CACHE.contacts);
  revalidatePath("/sales");
  revalidatePath("/inventory/products");
  revalidatePath("/inventory/stock");
  // An outstanding balance lands on the customer's ledger row.
  revalidatePath("/ledger");
  await recordAudit({ action: "create", entity: "sale", entityId: createdId, summary: createdNumber, companyId, detail: `Total ${grandTotal}` });
  return { success: true, id: createdId };
}

export async function updateSale(documentId: string, _prevState: ActionResult | undefined, formData: FormData): Promise<ActionResult> {
  return guard("Couldn't save the sale.", async () => {
    const session = await getSession();
    requirePermission(session, "sales", "edit");

    const companyId = String(formData.get("companyId") ?? "");
    const documentDate = String(formData.get("documentDate") ?? "");
    if (!companyId) return { error: "Company is required." };
    if (!documentDate) return { error: "Document date is required." };

    const validLines = readLines(formData);
    if (validLines.length === 0) return { error: "Add at least one item." };

    const contactId = opt(formData, "contactId");
    const contactName = opt(formData, "contactName");
    if (!contactId && !contactName) return { error: "Customer is required." };
    const discountTotal = num(formData, "discountTotal", "0");
    const taxTotal = num(formData, "taxTotal", "0");
    const shippingTotal = num(formData, "shippingTotal", "0");
    // Unrecognised (or absent) falls back to counter rather than erroring — it is
    // the answer for the overwhelming majority of sales, and a rejected invoice
    // over a dropdown nobody touched helps nobody.
    const saleTypeRaw = String(formData.get("saleType") ?? "");
    const saleType = isSaleType(saleTypeRaw) ? saleTypeRaw : DEFAULT_SALE_TYPE;

    const subtotal = round1(validLines.reduce((sum, l) => sum + Number(l.quantity) * (Number(l.unitPrice) || 0), 0));
    const grandTotal = round1(subtotal - Number(discountTotal) + Number(taxTotal) + Number(shippingTotal));

    const payment = readPayment(formData, grandTotal);
    const payErr = paymentError(payment);
    if (payErr) return { error: payErr };
    const { paidAmount, isPaid, settles, bankAccountId, cashAccountId, chequeId } = payment;
    const balance = grandTotal - paidAmount;
    const shopLocationId = await getShopLocationId();

    const [existingDoc] = await db
      .select({
        number: documents.number,
        paidAmount: documents.paidAmount,
        bankAccountId: documents.bankAccountId,
        cashAccountId: documents.cashAccountId,
      })
      .from(documents)
      .where(eq(documents.id, documentId))
      .limit(1);
    if (!existingDoc) return { error: "Sale not found." };
    const [existingCheque] = await db.select({ id: chequeRegister.id }).from(chequeRegister).where(eq(chequeRegister.documentId, documentId)).limit(1);

    await db.transaction(async (tx) => {
      // Reverse whatever was settled before applying the new figure — handles a
      // changed total, a changed part payment, and paid/unpaid flips in one pass.
      // Keyed on the amount rather than the is_paid flag, so a part payment gets
      // its actual amount back rather than nothing.
      if (Number(existingDoc.paidAmount) > 0) {
        await adjustSettlementBalance(
          tx,
          "in",
          existingDoc.paidAmount,
          existingDoc.bankAccountId,
          existingDoc.cashAccountId,
          existingCheque?.id ?? null,
          -1,
        );
        if (existingCheque) {
          await tx.update(chequeRegister).set({ documentId: null }).where(eq(chequeRegister.id, existingCheque.id));
        }
      }

      const resolvedContactId = await resolveContactId(tx, companyId, contactId, contactName);
      await tx
        .update(documents)
        .set({
          companyId,
          status: "posted",
          documentDate,
          contactId: resolvedContactId,
          subtotal: String(subtotal),
          discountTotal,
          taxTotal,
          shippingTotal,
          saleType,
          grandTotal: String(grandTotal),
          isPaid,
          paidAmount: String(paidAmount),
          bankAccountId,
          cashAccountId,
          updatedAt: new Date(),
        })
        .where(eq(documents.id, documentId));

      if (settles && paidAmount > 0) {
        if (chequeId) {
          await tx.update(chequeRegister).set({ documentId }).where(eq(chequeRegister.id, chequeId));
        }
        await adjustSettlementBalance(tx, "in", String(paidAmount), bankAccountId, cashAccountId, chequeId, 1);
      }

      // Re-sync the receivable: drop whatever was there and re-add only what is
      // still owed, so paying the rest off on edit clears the ledger row instead of
      // leaving a stale balance under the customer's name.
      await tx.delete(ledgerEntries).where(eq(ledgerEntries.documentId, documentId));
      if (balance > 0) {
        await tx.insert(ledgerEntries).values({ companyId, documentId, debit: String(balance) });
      }

      // inventory_transactions.document_line_id is ON DELETE RESTRICT, so old
      // movements must go before the lines they point at can be replaced.
      const oldLines = await tx.select({ id: documentLines.id }).from(documentLines).where(eq(documentLines.documentId, documentId));
      if (oldLines.length > 0) {
        await tx.delete(inventoryTransactions).where(inArray(inventoryTransactions.documentLineId, oldLines.map((l) => l.id)));
      }
      await tx.delete(documentLines).where(eq(documentLines.documentId, documentId));
      const lineRows = await resolveLineRows(tx, companyId, validLines, shopLocationId);
      const insertedLines = await tx
        .insert(documentLines)
        .values(lineRows.map((l) => ({ ...l, companyId, documentId })))
        .returning({ id: documentLines.id });

      const stockLines = lineRows.map((l, i) => ({ l, lineId: insertedLines[i].id })).filter(({ l }) => l.itemId);
      if (stockLines.length > 0) {
        await tx.insert(inventoryTransactions).values(
          stockLines.map(({ l, lineId }) => ({
            companyId,
            documentLineId: lineId,
            movement: -1,
            quantity: l.quantity,
            baseQuantity: l.baseQuantity,
            unitCost: l.unitPrice,
            totalCost: l.lineTotal,
          })),
        );
      }
    });

    // A sale can create items and contacts on the fly (resolve-refs.ts), so their
    // cached option lists are stale — without this a product typed into a sale is
    // missing from the item picker (and the products/stock pages) for the 5-minute
    // TTL, even though its stock movement is already recorded.
    invalidateLookups(CACHE.documentTypes, CACHE.cheques, CACHE.items, CACHE.contacts);
    revalidatePath("/sales");
    revalidatePath("/inventory/products");
    revalidatePath("/inventory/stock");
    revalidatePath("/ledger");
    await recordAudit({ action: "update", entity: "sale", entityId: documentId, summary: existingDoc.number, companyId, detail: `Total ${grandTotal}` });
    return { success: true };
  });
}

export async function deleteSale(_prevState: ActionResult | undefined, formData: FormData) {
  const session = await getSession();
  requirePermission(session, "sales", "delete");

  const documentId = String(formData.get("documentId") ?? "");

  const [existingDoc] = await db
    .select({
      number: documents.number,
      companyId: documents.companyId,
      grandTotal: documents.grandTotal,
      paidAmount: documents.paidAmount,
      bankAccountId: documents.bankAccountId,
      cashAccountId: documents.cashAccountId,
    })
    .from(documents)
    .where(eq(documents.id, documentId))
    .limit(1);
  if (!existingDoc) return { error: "Sale not found." };
  const [existingCheque] = await db.select({ id: chequeRegister.id }).from(chequeRegister).where(eq(chequeRegister.documentId, documentId)).limit(1);

  try {
    await db.transaction(async (tx) => {
      // Give back exactly what came in — the part payment, not the whole total.
      if (Number(existingDoc.paidAmount) > 0) {
        await adjustSettlementBalance(
          tx,
          "in",
          existingDoc.paidAmount,
          existingDoc.bankAccountId,
          existingDoc.cashAccountId,
          existingCheque?.id ?? null,
          -1,
        );
      }
      // Unlinked whatever the paid amount was: cheque_register.document_id is ON
      // DELETE NO ACTION, so a cheque still pointing here fails the delete. This
      // used to sit inside the branch above, which meant a cheque left attached to
      // a sale showing nothing paid made the sale undeletable.
      if (existingCheque) {
        await tx.update(chequeRegister).set({ documentId: null }).where(eq(chequeRegister.id, existingCheque.id));
      }
      const oldLines = await tx.select({ id: documentLines.id }).from(documentLines).where(eq(documentLines.documentId, documentId));
      if (oldLines.length > 0) {
        await tx.delete(inventoryTransactions).where(inArray(inventoryTransactions.documentLineId, oldLines.map((l) => l.id)));
      }
      // ledger_entries.document_id is ON DELETE NO ACTION, so the receivable row
      // has to go before the document it points at.
      await tx.delete(ledgerEntries).where(eq(ledgerEntries.documentId, documentId));
      await tx.delete(documents).where(eq(documents.id, documentId));
    });
  } catch (e) {
    return { error: describeDbError(e, "Can't delete — this sale is still referenced elsewhere.") };
  }

  // A sale can create items and contacts on the fly (resolve-refs.ts), so their
  // cached option lists are stale — without this a product typed into a sale is
  // missing from the item picker (and the products/stock pages) for the 5-minute
  // TTL, even though its stock movement is already recorded.
  invalidateLookups(CACHE.documentTypes, CACHE.cheques, CACHE.items, CACHE.contacts);
  revalidatePath("/sales");
  revalidatePath("/inventory/products");
  revalidatePath("/inventory/stock");
  revalidatePath("/ledger");
  await recordAudit({
    action: "delete",
    entity: "sale",
    entityId: documentId,
    summary: existingDoc.number,
    companyId: existingDoc.companyId,
    detail: `Total ${existingDoc.grandTotal}`,
  });
  return { success: true };
}
