"use server";

import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import {
  bankAccounts,
  cashAccounts,
  companies,
  documents,
  documentTypes,
  documentLines,
  documentNumberLedger,
  contacts,
  items,
  locations,
  units,
  ledgerEntries,
  chequeRegister,
  inventoryTransactions,
} from "@/lib/db/schema";
import { getSession } from "@/lib/auth/session";
import { requirePermission } from "@/lib/auth/permissions";
import { companyInScope } from "@/lib/auth/scope";
import { ensureDocumentType, nextDocumentNumber } from "@/lib/actions/document-numbering";
import { adjustSettlementBalance, type SettlementType } from "@/lib/actions/settlement";
import {
  CACHE,
  getAvailableCheques,
  getBankAccountOptions,
  getCashAccountOptions,
  getCompanies,
  getItemOptions,
  getLocations,
  getSuppliers,
  getUnits,
  invalidateLookups,
} from "@/lib/queries/lookups";
import { resolveContactId, resolveItemId, resolveLocationId, resolveUnitId } from "@/lib/actions/resolve-refs";
import { csvBool, csvErrorText } from "@/lib/csv";
import { inCompany } from "@/lib/contact-scope";
import { formatDate, landedUnitCost, perUnitShare, resolveAdjustment, round1, toISODate } from "@/lib/format";
import { bankAccountLabel } from "@/lib/account-label";
import { guard, describeDbError, type ActionResult } from "@/lib/actions/guard";
import { recordAudit } from "@/lib/actions/audit";

export interface StockPurchaseItemRow {
  itemName: string;
  quantity: string;
  unitPrice: string;
  // What the piece cost landed — the price plus its share of the delivery's
  // shipping, discount and tax, worked out when the purchase was saved. Null on
  // lines written before drizzle/0049, which the list shows as the price alone.
  unitCost: string | null;
  lineTotal: string;
  unitSymbol: string | null;
}

// `companyId` narrows to one company on top of the scope, driven by the list's
// company filter — companyInScope() still gates every row, so it can only ever
// show less than the scope, never more.
export async function listStockPurchases(companyId?: string) {
  const session = await getSession();
  requirePermission(session, "purchases", "view");
  const scope = and(await companyInScope(documents.companyId), companyId ? eq(documents.companyId, companyId) : undefined);

  // Same shape as listSales: selecting lines by document type rather than by a
  // list of ids drops the dependency between the two queries, so they overlap
  // instead of costing a round trip each.
  const [docs, lineRows] = await Promise.all([
    db
      .select({
        id: documents.id,
        number: documents.number,
        documentDate: documents.documentDate,
        subtotal: documents.subtotal,
        grandTotal: documents.grandTotal,
        isPaid: documents.isPaid,
        discountTotal: documents.discountTotal,
        taxTotal: documents.taxTotal,
        shippingTotal: documents.shippingTotal,
        supplier: contacts.displayName,
        // The short name, not the full one: on this list the company is a tag
        // saying which set of books a row belongs to, and "Royal Hardware
        // (Private) Limited" spends a column saying it. Falls back to the full
        // name for a company that hasn't got a short one.
        company: sql<string>`coalesce(${companies.shortName}, ${companies.name})`,
      })
      .from(documents)
      .innerJoin(documentTypes, eq(documentTypes.id, documents.documentTypeId))
      .innerJoin(companies, eq(companies.id, documents.companyId))
      .leftJoin(contacts, eq(contacts.id, documents.contactId))
      .where(and(eq(documentTypes.code, "PURCHASE_INVOICE"), scope))
      .orderBy(desc(documents.documentDate)),
    db
      .select({
        documentId: documentLines.documentId,
        itemName: items.name,
        quantity: documentLines.quantity,
        unitPrice: documentLines.unitPrice,
        unitCost: documentLines.unitCost,
        lineTotal: documentLines.lineTotal,
        unitSymbol: units.symbol,
      })
      .from(documentLines)
      .innerJoin(documents, eq(documents.id, documentLines.documentId))
      .innerJoin(documentTypes, eq(documentTypes.id, documents.documentTypeId))
      .innerJoin(items, eq(items.id, documentLines.itemId))
      .leftJoin(units, eq(units.id, documentLines.unitId))
      .where(and(eq(documentTypes.code, "PURCHASE_INVOICE"), scope))
      .orderBy(documentLines.lineNo),
  ]);

  const linesByDoc = new Map<string, StockPurchaseItemRow[]>();
  for (const l of lineRows) {
    const arr = linesByDoc.get(l.documentId) ?? [];
    arr.push({
      itemName: l.itemName,
      quantity: l.quantity,
      unitPrice: l.unitPrice,
      unitCost: l.unitCost,
      lineTotal: l.lineTotal,
      unitSymbol: l.unitSymbol,
    });
    linesByDoc.set(l.documentId, arr);
  }

  return docs.map((d) => ({ ...d, items: linesByDoc.get(d.id) ?? [] }));
}

export async function getStockPurchase(documentId: string) {
  const session = await getSession();
  requirePermission(session, "purchases", "view");

  // Three independent lookups keyed on the id we were handed — run them together
  // rather than one after another.
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
    bankAccountId: doc.bankAccountId,
    cashAccountId: doc.cashAccountId,
    chequeId: linkedCheque?.id ?? null,
    settlementType,
    // Every line of a purchase carries the same location — it's a header field on
    // the form — so the first line speaks for the document.
    locationId: lineRows[0]?.locationId ?? "",
    lines: lineRows.map((l) => ({
      itemId: l.itemId ?? "",
      unitId: l.unitId ?? "",
      quantity: l.quantity,
      unitPrice: l.unitPrice,
      unitCost: l.unitCost ?? "",
    })),
  };
}

// Cheques available to settle a purchase: unlinked everywhere, plus (when
// editing) the one already linked to this purchase. Kept as an action because
// StockPurchaseManager re-fetches it from the browser.
export async function listChequesForPurchases(currentDocumentId?: string) {
  return getAvailableCheques(currentDocumentId);
}

interface PurchaseLineInput {
  itemId: string;
  itemName: string;
  unitId: string;
  unitName: string;
  quantity: string;
  unitPrice: string;
  unitCost: string;
}

type PurchaseTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

// Resolve each line's item and unit inside the transaction — a typed-but-unpicked
// name creates the record on the fly (see resolve-refs.ts).
async function resolvePurchaseLineRows(
  tx: PurchaseTx,
  companyId: string,
  lines: PurchaseLineInput[],
  location: { locationId: string; locationName: string },
) {
  // One delivery arrives in one place, so the location is a header field and is
  // resolved once rather than per line — a typed name that did not match creates
  // the location, the same as the item and unit on each line.
  const locationId = await resolveLocationId(tx, location.locationId || null, location.locationName || null);
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

function num(formData: FormData, key: string, fallback: string) {
  const v = String(formData.get(key) ?? "").trim();
  return v === "" ? fallback : v;
}

function opt(formData: FormData, key: string) {
  const v = String(formData.get(key) ?? "").trim();
  return v === "" ? null : v;
}

export async function createStockPurchase(_prevState: ActionResult | undefined, formData: FormData) {
  const session = await getSession();
  requirePermission(session, "purchases", "create");

  const companyId = String(formData.get("companyId") ?? "");
  const documentDate = String(formData.get("documentDate") ?? "");
  if (!companyId) return { error: "Company is required." };
  if (!documentDate) return { error: "Document date is required." };

  let lines: PurchaseLineInput[];
  try {
    lines = JSON.parse(String(formData.get("linesJson") ?? "[]"));
  } catch (e) {
    return { error: describeDbError(e, "Invalid line items.") };
  }
  const locationId = String(formData.get("locationId") ?? "");
  const locationName = String(formData.get("locationName") ?? "").trim();

  // --- document_types: use an existing row, or create a new one from the
  // form's Document Type fields ---
  const documentTypeMode = String(formData.get("documentTypeMode") ?? "existing");
  let documentType: typeof documentTypes.$inferSelect;

  if (documentTypeMode === "new") {
    const code = String(formData.get("dtCode") ?? "");
    const name = String(formData.get("dtName") ?? "").trim();
    const series = String(formData.get("dtSeries") ?? "");
    if (!code) return { error: "Document type code is required." };
    if (!name) return { error: "Document type name is required." };
    if (!series) return { error: "Document type series is required." };

    const positiveStockRaw = String(formData.get("dtPositiveStock") ?? "");
    try {
      [documentType] = await db
        .insert(documentTypes)
        .values({
          companyId,
          code: code as (typeof documentTypes.$inferInsert)["code"],
          name,
          series: series as (typeof documentTypes.$inferInsert)["series"],
          affectsInventory: formData.get("dtAffectsInventory") === "on",
          affectsAccounting: formData.get("dtAffectsAccounting") === "on",
          affectsReceivable: formData.get("dtAffectsReceivable") === "on",
          affectsPayable: formData.get("dtAffectsPayable") === "on",
          positiveStock: positiveStockRaw === "" ? null : positiveStockRaw === "true",
          active: formData.get("dtActive") === "on",
        })
        .returning();
    } catch (e) {
      return { error: describeDbError(e, "Can't create document type — code or series already in use.") };
    }
  } else {
    const documentTypeId = Number(formData.get("documentTypeId") ?? "");
    if (!documentTypeId) return { error: "Document type is required." };
    const [existing] = await db.select().from(documentTypes).where(eq(documentTypes.id, documentTypeId)).limit(1);
    if (!existing) return { error: "Selected document type not found." };
    documentType = existing;
  }

  // A purchase invoice is goods arriving, so a line means nothing without a
  // quantity. A document type that books no payable is the rate-recording kind
  // (product edit's stock receipt), where "this is what it costs now" is a
  // complete statement on its own — those keep priced lines with no quantity,
  // which is what puts the price in rate_list without moving stock.
  const ratesOnly = !documentType.affectsPayable;
  const validLines = lines.filter(
    (l) => (l.itemId || l.itemName?.trim()) && (Number(l.quantity) > 0 || (ratesOnly && Number(l.unitPrice) > 0)),
  );
  if (validLines.length === 0) return { error: "Add at least one item." };
  // Goods arrive somewhere. Left blank the line books stock that is on hand but
  // nowhere, which the Stock page can only show as Unassigned and nobody can go
  // and count. A document with no quantity on any line moves nothing, so it
  // needs no location.
  const movesStock = validLines.some((l) => Number(l.quantity) > 0);
  if (movesStock && !locationId && !locationName) return { error: "Pick the location the goods arrived at." };

  // --- documents: every user-facing header field ---
  const contactId = opt(formData, "contactId");
  const contactName = opt(formData, "contactName");
  if (!contactId && !contactName) return { error: "Supplier is required." };
  const discountTotal = num(formData, "discountTotal", "0");
  const taxTotal = num(formData, "taxTotal", "0");
  const shippingTotal = num(formData, "shippingTotal", "0");
  const manualNumber = opt(formData, "number");
  // A document type that doesn't touch the payable ledger has no paid/unpaid
  // state to be in: nothing is owed either way, so there is nothing to settle.
  // That's what separates a stock receipt (goods and a rate, no money) from a
  // purchase invoice, and it's read off the type rather than asked for again.
  const isPaid = documentType.affectsPayable && formData.get("isPaid") === "yes";
  const settlementType = String(formData.get("settlementType") ?? "") as SettlementType;
  const bankAccountId = isPaid && settlementType === "account" ? opt(formData, "bankAccountId") : null;
  const cashAccountId = isPaid && settlementType === "cash" ? opt(formData, "cashAccountId") : null;
  const chequeId = isPaid && settlementType === "cheque" ? opt(formData, "chequeId") : null;
  if (isPaid && !bankAccountId && !cashAccountId && !chequeId) return { error: "Select an account, cash account, or cheque." };

  const subtotal = round1(validLines.reduce((sum, l) => sum + Number(l.quantity) * (Number(l.unitPrice) || 0), 0));
  const grandTotal = round1(subtotal - Number(discountTotal) + Number(taxTotal) + Number(shippingTotal));

  let createdNumber = "";
  let createdId = "";
  try {
    await db.transaction(async (tx) => {
      // Allocated inside the transaction so a failure gives the number back. A
      // manually entered number bypasses the counter entirely — the unique
      // constraint on (company, type, number) is what stops it colliding.
      const number = manualNumber ?? (await nextDocumentNumber(documentType.series, tx));
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
          grandTotal: String(grandTotal),
          isPaid,
          // Purchases are still all-or-nothing (part payment is a sales feature so
          // far), so the amount tracks the flag rather than sitting at 0 and
          // making a paid purchase look unsettled to anything reading the column.
          paidAmount: isPaid ? String(grandTotal) : "0",
          bankAccountId,
          cashAccountId,
          createdBy: session.userId,
        })
        .returning();
      createdId = doc.id;

      const lineRows = await resolvePurchaseLineRows(tx, companyId, validLines, { locationId, locationName });
      const insertedLines = await tx
        .insert(documentLines)
        .values(
          lineRows.map((l) => ({
            ...l,
            companyId,
            documentId: doc.id,
          })),
        )
        .returning({ id: documentLines.id });

      // Purchases add stock — one +1 inventory movement per line, valued at
      // its own unit price. Not at documentLines.unitCost, which since
      // drizzle/0049 is the landed cost: moving stock in at a freight-inclusive
      // value would restate every stock figure the day this shipped, which is a
      // decision about the books, not a display change. A rate-only line
      // carries no quantity and gets no movement: a row of zero would be a
      // stock event that never happened.
      const stockRows = lineRows
        .map((l, i) => ({ l, lineId: insertedLines[i].id }))
        .filter(({ l }) => Number(l.quantity) > 0);
      if (documentType.affectsInventory && stockRows.length > 0) {
        await tx.insert(inventoryTransactions).values(
          stockRows.map(({ l, lineId }) => ({
            companyId,
            documentLineId: lineId,
            movement: 1,
            quantity: l.quantity,
            baseQuantity: l.baseQuantity,
            unitCost: l.unitPrice,
            totalCost: l.lineTotal,
          })),
        );
      }

      await tx.insert(documentNumberLedger).values({
        companyId,
        documentTypeId: documentType.id,
        number,
        documentId: doc.id,
      });

      // Unpaid purchase = money owed to the supplier — record it as a credit.
      // Paid purchases settle immediately instead: deduct the settling
      // account and skip the payable ledger row. A type that doesn't affect the
      // payable does neither — it moved stock, not money.
      if (!documentType.affectsPayable) {
        // nothing to book
      } else if (!isPaid) {
        await tx.insert(ledgerEntries).values({ companyId, documentId: doc.id, credit: String(grandTotal) });
      } else {
        if (chequeId) {
          await tx.update(chequeRegister).set({ documentId: doc.id }).where(eq(chequeRegister.id, chequeId));
        }
        await adjustSettlementBalance(tx, "out", String(grandTotal), bankAccountId, cashAccountId, chequeId, 1);
      }
    });
  } catch (e) {
    return { error: describeDbError(e, "Can't create — document number already in use for this company/type.") };
  }

  // A purchase can create items and contacts on the fly (resolve-refs.ts), and it
  // always moves stock and touches the payable ledger — so the cached option lists
  // and every page reading them are stale, not just the purchase list. Without the
  // stock/products lines, deleting a purchase reversed the movement in the
  // database while the Stock page kept showing the old quantity.
  invalidateLookups(CACHE.documentTypes, CACHE.cheques, CACHE.items, CACHE.contacts);
  revalidatePath("/purchases/stock");
  revalidatePath("/inventory/stock");
  revalidatePath("/inventory/products");
  revalidatePath("/ledger");
  await recordAudit({ action: "create", entity: "purchase", entityId: createdId, summary: createdNumber, companyId, detail: `Total ${grandTotal}` });
  return { success: true };
}

export async function updateStockPurchase(
  documentId: string,
  _prevState: ActionResult | undefined,
  formData: FormData,
) {
  const session = await getSession();
  requirePermission(session, "purchases", "edit");

  const companyId = String(formData.get("companyId") ?? "");
  const documentDate = String(formData.get("documentDate") ?? "");
  if (!companyId) return { error: "Company is required." };
  if (!documentDate) return { error: "Document date is required." };

  let lines: PurchaseLineInput[];
  try {
    lines = JSON.parse(String(formData.get("linesJson") ?? "[]"));
  } catch (e) {
    return { error: describeDbError(e, "Invalid line items.") };
  }
  const validLines = lines.filter((l) => (l.itemId || l.itemName?.trim()) && Number(l.quantity) > 0);
  if (validLines.length === 0) return { error: "Add at least one item." };
  // Purchased goods arrive somewhere. Left blank the line books stock that is
  // on hand but nowhere, which the Stock page can only show as Unassigned and
  // nobody can go and count.
  // Purchased goods arrive somewhere. Left blank the purchase books stock that is
  // on hand but nowhere, which the Stock page can only show as Unassigned and
  // nobody can go and count.
  const locationId = String(formData.get("locationId") ?? "");
  const locationName = String(formData.get("locationName") ?? "").trim();
  if (!locationId && !locationName) return { error: "Pick the location the goods arrived at." };

  const contactId = opt(formData, "contactId");
  const contactName = opt(formData, "contactName");
  if (!contactId && !contactName) return { error: "Supplier is required." };
  const discountTotal = num(formData, "discountTotal", "0");
  const taxTotal = num(formData, "taxTotal", "0");
  const shippingTotal = num(formData, "shippingTotal", "0");

  const subtotal = round1(validLines.reduce((sum, l) => sum + Number(l.quantity) * (Number(l.unitPrice) || 0), 0));
  const grandTotal = round1(subtotal - Number(discountTotal) + Number(taxTotal) + Number(shippingTotal));

  const [existingDoc] = await db
    .select({
      number: documents.number,
      documentTypeId: documents.documentTypeId,
      isPaid: documents.isPaid,
      grandTotal: documents.grandTotal,
      bankAccountId: documents.bankAccountId,
      cashAccountId: documents.cashAccountId,
    })
    .from(documents)
    .where(eq(documents.id, documentId))
    .limit(1);
  if (!existingDoc) return { error: "Purchase not found." };
  const [documentType] = await db.select().from(documentTypes).where(eq(documentTypes.id, existingDoc.documentTypeId)).limit(1);

  // Read after the type, for the same reason as in createStockPurchase: a
  // document that doesn't touch the payable has no paid/unpaid state.
  const isPaid = Boolean(documentType?.affectsPayable) && formData.get("isPaid") === "yes";
  const settlementType = String(formData.get("settlementType") ?? "") as SettlementType;
  const bankAccountId = isPaid && settlementType === "account" ? opt(formData, "bankAccountId") : null;
  const cashAccountId = isPaid && settlementType === "cash" ? opt(formData, "cashAccountId") : null;
  const chequeId = isPaid && settlementType === "cheque" ? opt(formData, "chequeId") : null;
  if (isPaid && !bankAccountId && !cashAccountId && !chequeId) return { error: "Select an account, cash account, or cheque." };
  const [existingCheque] = await db.select({ id: chequeRegister.id }).from(chequeRegister).where(eq(chequeRegister.documentId, documentId)).limit(1);

  await db.transaction(async (tx) => {
    // Reverse the old settlement (if it was paid) before applying the new
    // one — handles amount changes and paid/unpaid flips in one pass.
    if (existingDoc.isPaid) {
      await adjustSettlementBalance(
        tx,
        "out",
        existingDoc.grandTotal,
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
        grandTotal: String(grandTotal),
        isPaid,
        paidAmount: isPaid ? String(grandTotal) : "0",
        bankAccountId,
        cashAccountId,
        updatedAt: new Date(),
      })
      .where(eq(documents.id, documentId));

    if (isPaid) {
      if (chequeId) {
        await tx.update(chequeRegister).set({ documentId }).where(eq(chequeRegister.id, chequeId));
      }
      await adjustSettlementBalance(tx, "out", String(grandTotal), bankAccountId, cashAccountId, chequeId, 1);
    }

    // inventory_transactions.document_line_id is ON DELETE RESTRICT, so old
    // movements must go before the lines they point at can be replaced.
    const oldLines = await tx.select({ id: documentLines.id }).from(documentLines).where(eq(documentLines.documentId, documentId));
    if (oldLines.length > 0) {
      await tx.delete(inventoryTransactions).where(
        inArray(inventoryTransactions.documentLineId, oldLines.map((l) => l.id)),
      );
    }
    await tx.delete(documentLines).where(eq(documentLines.documentId, documentId));
    const lineRows = await resolvePurchaseLineRows(tx, companyId, validLines, { locationId, locationName });
    const insertedLines = await tx
      .insert(documentLines)
      .values(
        lineRows.map((l) => ({
          ...l,
          companyId,
          documentId,
        })),
      )
      .returning({ id: documentLines.id });

    if (documentType?.affectsInventory) {
      await tx.insert(inventoryTransactions).values(
        lineRows.map((l, i) => ({
          companyId,
          documentLineId: insertedLines[i].id,
          movement: 1,
          quantity: l.quantity,
          baseQuantity: l.baseQuantity,
          unitCost: l.unitPrice,
          totalCost: l.lineTotal,
        })),
      );
    }

    // Re-sync the payable credit: drop whatever was there and re-add only if
    // still unpaid, so flipping paid/unpaid on edit doesn't leave stale rows. A
    // type that doesn't affect the payable never has one.
    await tx.delete(ledgerEntries).where(eq(ledgerEntries.documentId, documentId));
    if (!isPaid && documentType?.affectsPayable) {
      await tx.insert(ledgerEntries).values({ companyId, documentId, credit: String(grandTotal) });
    }
  });

  // A purchase can create items and contacts on the fly (resolve-refs.ts), and it
  // always moves stock and touches the payable ledger — so the cached option lists
  // and every page reading them are stale, not just the purchase list. Without the
  // stock/products lines, deleting a purchase reversed the movement in the
  // database while the Stock page kept showing the old quantity.
  invalidateLookups(CACHE.documentTypes, CACHE.cheques, CACHE.items, CACHE.contacts);
  revalidatePath("/purchases/stock");
  revalidatePath("/inventory/stock");
  revalidatePath("/inventory/products");
  revalidatePath("/ledger");
  await recordAudit({ action: "update", entity: "purchase", entityId: documentId, summary: existingDoc.number, companyId, detail: `Total ${grandTotal}` });
  return { success: true };
}

export async function deleteStockPurchase(_prevState: ActionResult | undefined, formData: FormData) {
  const session = await getSession();
  requirePermission(session, "purchases", "delete");

  const documentId = String(formData.get("documentId") ?? "");

  const [existingDoc] = await db
    .select({
      number: documents.number,
      companyId: documents.companyId,
      isPaid: documents.isPaid,
      grandTotal: documents.grandTotal,
      bankAccountId: documents.bankAccountId,
      cashAccountId: documents.cashAccountId,
    })
    .from(documents)
    .where(eq(documents.id, documentId))
    .limit(1);
  if (!existingDoc) return { error: "Purchase not found." };
  const [existingCheque] = await db.select({ id: chequeRegister.id }).from(chequeRegister).where(eq(chequeRegister.documentId, documentId)).limit(1);

  try {
    await db.transaction(async (tx) => {
      if (existingDoc.isPaid) {
        await adjustSettlementBalance(
          tx,
          "out",
          existingDoc.grandTotal,
          existingDoc.bankAccountId,
          existingDoc.cashAccountId,
          existingCheque?.id ?? null,
          -1,
        );
      }
      // Unlinked regardless of the paid flag: cheque_register.document_id is ON
      // DELETE NO ACTION, so a cheque still pointing here fails the delete.
      if (existingCheque) {
        await tx.update(chequeRegister).set({ documentId: null }).where(eq(chequeRegister.id, existingCheque.id));
      }
      const oldLines = await tx.select({ id: documentLines.id }).from(documentLines).where(eq(documentLines.documentId, documentId));
      if (oldLines.length > 0) {
        await tx.delete(inventoryTransactions).where(
          inArray(inventoryTransactions.documentLineId, oldLines.map((l) => l.id)),
        );
      }
      // ledger_entries.document_id is ON DELETE NO ACTION, so an unpaid
      // purchase's payable row has to go before the document. Without this,
      // deleting one failed the FK and reported "still referenced elsewhere".
      await tx.delete(ledgerEntries).where(eq(ledgerEntries.documentId, documentId));
      await tx.delete(documents).where(eq(documents.id, documentId));
    });
  } catch (e) {
    return { error: describeDbError(e, "Can't delete — this purchase is still referenced elsewhere.") };
  }

  // A purchase can create items and contacts on the fly (resolve-refs.ts), and it
  // always moves stock and touches the payable ledger — so the cached option lists
  // and every page reading them are stale, not just the purchase list. Without the
  // stock/products lines, deleting a purchase reversed the movement in the
  // database while the Stock page kept showing the old quantity.
  invalidateLookups(CACHE.documentTypes, CACHE.cheques, CACHE.items, CACHE.contacts);
  revalidatePath("/purchases/stock");
  revalidatePath("/inventory/stock");
  revalidatePath("/inventory/products");
  revalidatePath("/ledger");
  await recordAudit({
    action: "delete",
    entity: "purchase",
    entityId: documentId,
    summary: existingDoc.number,
    companyId: existingDoc.companyId,
    detail: `Total ${existingDoc.grandTotal}`,
  });
  return { success: true };
}

// --- Merge ---------------------------------------------------------------

// One delivery often gets entered as several purchases — a few items now, the
// rest when the remaining paperwork turns up, or the same note keyed twice.
// Merging gathers every line onto one invoice and drops the others, so the
// supplier ledger shows one payable for one delivery instead of four.

export interface PurchaseMergeCandidate {
  id: string;
  number: string;
  documentDate: string;
  companyId: string;
  company: string;
  // NULL when the purchase was entered with no supplier; two of those merge with
  // each other but not with a named one.
  contactId: string | null;
  supplier: string | null;
  grandTotal: string;
  isPaid: boolean;
  paidAmount: string;
  lines: number;
}

export async function listPurchaseMergeCandidates(): Promise<PurchaseMergeCandidate[]> {
  const session = await getSession();
  requirePermission(session, "purchases", "view");

  const rows = await db
    .select({
      id: documents.id,
      number: documents.number,
      documentDate: documents.documentDate,
      companyId: documents.companyId,
      company: companies.name,
      contactId: documents.contactId,
      supplier: contacts.displayName,
      grandTotal: documents.grandTotal,
      isPaid: documents.isPaid,
      paidAmount: documents.paidAmount,
      lines: sql<number>`(select count(*) from ${documentLines} dl where dl.document_id = ${documents.id})`,
    })
    .from(documents)
    .innerJoin(documentTypes, eq(documentTypes.id, documents.documentTypeId))
    .innerJoin(companies, eq(companies.id, documents.companyId))
    .leftJoin(contacts, eq(contacts.id, documents.contactId))
    .where(and(eq(documentTypes.code, "PURCHASE_INVOICE"), await companyInScope(documents.companyId)))
    .orderBy(desc(documents.documentDate));

  return rows.map((r) => ({ ...r, lines: Number(r.lines) }));
}

export async function mergeStockPurchases(
  _prevState: ActionResult | undefined,
  formData: FormData,
): Promise<{ error?: string; success?: boolean }> {
  const session = await getSession();
  // Rewrites one purchase and destroys the others, so it needs both.
  requirePermission(session, "purchases", "edit");
  requirePermission(session, "purchases", "delete");

  const survivorId = String(formData.get("survivorId") ?? "");
  let documentIds: string[];
  try {
    documentIds = JSON.parse(String(formData.get("documentIds") ?? "[]"));
  } catch (e) {
    return { error: describeDbError(e, "Nothing to merge.") };
  }

  if (documentIds.length < 2) return { error: "Pick at least two purchases to merge." };
  if (!survivorId || !documentIds.includes(survivorId)) return { error: "Pick which purchase number survives the merge." };

  const docs = await db
    .select({
      id: documents.id,
      number: documents.number,
      companyId: documents.companyId,
      contactId: documents.contactId,
      discountTotal: documents.discountTotal,
      taxTotal: documents.taxTotal,
      shippingTotal: documents.shippingTotal,
      paidAmount: documents.paidAmount,
      isPaid: documents.isPaid,
    })
    .from(documents)
    .where(and(inArray(documents.id, documentIds), await companyInScope(documents.companyId)));
  if (docs.length !== documentIds.length) return { error: "One of these purchases no longer exists, or isn't in your company scope." };

  // Books are per company and so is stock — the same rule mergeProducts follows.
  if (new Set(docs.map((d) => d.companyId)).size > 1) return { error: "These purchases belong to different companies — merge within one company." };
  // An invoice has one supplier, and an unpaid one is a payable against that
  // contact. Folding two suppliers together would move money owed from one to the
  // other with nothing recording that it happened.
  if (new Set(docs.map((d) => d.contactId ?? "")).size > 1) {
    return { error: "These purchases have different suppliers — merge one supplier at a time." };
  }
  // A settled purchase has already moved money out of an account, or is holding a
  // cheque. Unpicking that correctly is a different job from gathering lines, so
  // this refuses rather than guessing at it.
  if (docs.some((d) => d.isPaid || Number(d.paidAmount) > 0)) {
    return { error: "One of these is already paid — merge unpaid purchases only, or unsettle them first." };
  }

  const loserIds = documentIds.filter((id) => id !== survivorId);
  const companyId = docs[0].companyId;
  // The charges are per document, so the merged invoice carries their sum — the
  // shipping on two deliveries really was paid twice.
  const discountTotal = docs.reduce((sum, d) => sum + Number(d.discountTotal), 0);
  const taxTotal = docs.reduce((sum, d) => sum + Number(d.taxTotal), 0);
  const shippingTotal = docs.reduce((sum, d) => sum + Number(d.shippingTotal), 0);

  try {
    await db.transaction(async (tx) => {
      // inventory_transactions hang off document_lines, so repointing the lines
      // carries the stock movements with them untouched — on-hand and valuation
      // come out identical, just under one document.
      //
      // Renumbered on the way over: document_lines is UNIQUE(document_id, line_no)
      // and every invoice starts at 1.
      // One statement, not one per line. Renumbering used to loop an UPDATE per
      // moved line inside the transaction, and every statement in a transaction
      // is its own round trip to a database ~170ms away — merging four invoices
      // of thirty lines each was a hundred and twenty of them, twenty seconds of
      // pure waiting. row_number() does the numbering in the database instead.
      const [{ taken }] = await tx
        .select({ taken: sql<number>`count(*)::int` })
        .from(documentLines)
        .where(eq(documentLines.documentId, survivorId));

      await tx.execute(sql`
        UPDATE document_lines AS dl
        SET document_id = ${survivorId}::uuid,
            line_no     = ${taken} + renumbered.n,
            sort_order  = ${taken} + renumbered.n - 1
        FROM (
          SELECT id, row_number() OVER (ORDER BY document_id, line_no) AS n
          FROM document_lines
          WHERE document_id IN (${sql.join(loserIds.map((id) => sql`${id}::uuid`), sql`, `)})
        ) AS renumbered
        WHERE dl.id = renumbered.id
      `);

      // Totals come from what the survivor now holds rather than from adding up
      // the old headers, so they agree with the lines even if a header had drifted
      // away from them.
      const [totals] = await tx
        .select({ subtotal: sql<string>`coalesce(sum(${documentLines.lineTotal}), 0)` })
        .from(documentLines)
        .where(eq(documentLines.documentId, survivorId));
      const subtotal = Number(totals?.subtotal ?? 0);
      const grandTotal = round1(subtotal - discountTotal + taxTotal + shippingTotal);

      await tx
        .update(documents)
        .set({
          subtotal: String(subtotal),
          discountTotal: String(discountTotal),
          taxTotal: String(taxTotal),
          shippingTotal: String(shippingTotal),
          grandTotal: String(grandTotal),
          updatedAt: new Date(),
        })
        .where(eq(documents.id, survivorId));

      // ledger_entries.document_id is ON DELETE NO ACTION, so the losers' payable
      // rows have to go before their documents can. The survivor's is rewritten to
      // the combined total — one delivery, one amount owed.
      await tx.delete(ledgerEntries).where(inArray(ledgerEntries.documentId, documentIds));
      await tx.insert(ledgerEntries).values({ companyId, documentId: survivorId, credit: String(grandTotal) });

      // The dropped numbers are never reissued: document_number_ledger.document_id
      // is ON DELETE SET NULL, so each row stays behind as a tombstone recording
      // that PI-0007 was once handed out.
      await tx.delete(documents).where(inArray(documents.id, loserIds));
    });
  } catch (e) {
    return { error: describeDbError(e, "Can't merge — one of these purchases is still referenced elsewhere.") };
  }

  // Same set of views a create or delete invalidates: the merge moves stock
  // between documents and rewrites a payable.
  invalidateLookups(CACHE.documentTypes, CACHE.cheques, CACHE.items, CACHE.contacts);
  revalidatePath("/purchases/stock");
  revalidatePath("/inventory/stock");
  revalidatePath("/inventory/products");
  revalidatePath("/ledger");
  await recordAudit({
    action: "merge",
    entity: "purchase",
    entityId: survivorId,
    summary: docs.find((d) => d.id === survivorId)?.number ?? "",
    companyId: docs[0]?.companyId,
    detail: `${loserIds.length} other purchase(s) folded in`,
  });
  return { success: true };
}

// --- CSV import / export ---------------------------------------------------

// Columns and headings: lib/csv-columns.ts (PURCHASE_CSV_COLUMNS). A purchase is
// a header plus lines and a spreadsheet is flat, so the file carries one row per
// line item and rows sharing a Purchase Ref become one document — its header
// fields read from the first row of the group.
//
// Names, never ids. An unmatched supplier, item, unit or location is created on
// save, exactly as typing one into the purchase form does; a company or an
// account is not, since those can't be invented from a typo.

export async function exportStockPurchasesCsv(companyId?: string): Promise<Record<string, string>[]> {
  const session = await getSession();
  requirePermission(session, "purchases", "view");
  const scope = and(await companyInScope(documents.companyId), companyId ? eq(documents.companyId, companyId) : undefined);

  const [rows, cheques] = await Promise.all([
    db
      .select({
        documentId: documents.id,
        number: documents.number,
        documentDate: documents.documentDate,
        discountTotal: documents.discountTotal,
        taxTotal: documents.taxTotal,
        shippingTotal: documents.shippingTotal,
        isPaid: documents.isPaid,
        bankAccountId: documents.bankAccountId,
        cashAccountId: documents.cashAccountId,
        company: companies.name,
        supplier: contacts.displayName,
        location: locations.name,
        item: items.name,
        unit: units.name,
        quantity: documentLines.quantity,
        unitPrice: documentLines.unitPrice,
        bankName: bankAccounts.bankName,
        branchName: bankAccounts.branchName,
        accountTitle: bankAccounts.accountTitle,
        cashName: cashAccounts.name,
      })
      .from(documentLines)
      .innerJoin(documents, eq(documents.id, documentLines.documentId))
      .innerJoin(documentTypes, eq(documentTypes.id, documents.documentTypeId))
      .innerJoin(companies, eq(companies.id, documents.companyId))
      .leftJoin(contacts, eq(contacts.id, documents.contactId))
      .leftJoin(locations, eq(locations.id, documentLines.locationId))
      .leftJoin(items, eq(items.id, documentLines.itemId))
      .leftJoin(units, eq(units.id, documentLines.unitId))
      .leftJoin(bankAccounts, eq(bankAccounts.id, documents.bankAccountId))
      .leftJoin(cashAccounts, eq(cashAccounts.id, documents.cashAccountId))
      .where(and(eq(documentTypes.code, "PURCHASE_INVOICE"), scope))
      .orderBy(desc(documents.documentDate), documents.number, documentLines.lineNo),
    // A cheque points at the document, not the other way round, so it can't be
    // joined off documents — one pass over the register instead.
    db
      .select({ documentId: chequeRegister.documentId, chequeNumber: chequeRegister.chequeNumber })
      .from(chequeRegister)
      .where(await companyInScope(chequeRegister.companyId)),
  ]);

  const chequeByDoc = new Map(cheques.filter((c) => c.documentId).map((c) => [c.documentId as string, c.chequeNumber]));

  return rows.map((r) => {
    const cheque = chequeByDoc.get(r.documentId);
    const settlementType = r.bankAccountId ? "account" : r.cashAccountId ? "cash" : cheque ? "cheque" : "";
    const settlementAccount = r.bankAccountId
      ? bankAccountLabel({ bankName: r.bankName ?? "", branchName: r.branchName, accountTitle: r.accountTitle })
      : r.cashAccountId
        ? (r.cashName ?? "")
        : (cheque ?? "");
    return {
      company: r.company,
      documentDate: formatDate(r.documentDate),
      supplier: r.supplier ?? "",
      location: r.location ?? "",
      item: r.item ?? "",
      unit: r.unit ?? "",
      quantity: r.quantity,
      unitPrice: r.unitPrice,
      // Header figures, repeated on every line of the document — the import reads
      // them off the first row of the group and ignores the rest.
      discountTotal: r.discountTotal,
      taxTotal: r.taxTotal,
      shippingTotal: r.shippingTotal,
      paid: r.isPaid ? "yes" : "no",
      settlementType,
      settlementAccount,
    };
  });
}

// DD-MM-YYYY, which is what the template asks for and what everything in the app
// displays — but written with slashes or dots as readily as dashes, because a
// spreadsheet reformats a date column without being asked. Year-first (the ISO a
// spreadsheet may also hand back) is accepted for the same reason.
//
// "" for anything else, which the caller reports as a bad date rather than
// guessing at it. Note what is *not* accepted: 12/25/2026. Day-first is the
// house format, and silently reading an American file the other way round would
// file a delivery seven months out with nothing on screen to show for it.
function csvDate(value: string): string {
  const v = value.trim().replace(/[/.]/g, "-");
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(v);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;
  return toISODate(v);
}

export async function importStockPurchasesCsv(
  rows: Record<string, string>[],
): Promise<{ error?: string; created?: number }> {
  return guard("Couldn't import the purchases.", async () => {
    const session = await getSession();
    requirePermission(session, "purchases", "create");
    if (rows.length === 0) return { error: "That file has no rows." };

    // Everything the file's names resolve against, fetched once for the whole
    // import rather than per row.
    //
    // This is where the time went. resolve-refs.ts looks a name up inside the
    // document's transaction — fine for a form, where it's two lookups for a line
    // someone typed by hand, but a 300-line file was 600 round trips to a database
    // ~170ms away, each waiting on the one before. These lists are the cached
    // lookups the pickers already use, so a name that matches arrives as an id and
    // the transaction does no lookup at all. A name that matches nothing still
    // goes down as text and is created inside the transaction, exactly as before.
    const [companyRows, bankOptions, cashOptions, chequeOptions, itemRows, unitRows, locationRows, supplierRows] = await Promise.all([
      getCompanies(),
      getBankAccountOptions(),
      getCashAccountOptions(),
      getAvailableCheques(),
      getItemOptions(),
      getUnits(),
      getLocations(),
      getSuppliers(),
    ]);
    const companyByName = new Map(companyRows.map((c) => [c.name.trim().toLowerCase(), c.id]));
    const byName = (list: { id: string; name: string }[], name: string) =>
      list.find((o) => o.name.trim().toLowerCase() === name.trim().toLowerCase());

    const key = (s: string) => s.trim().toLowerCase();
    // Items and contacts are per company (a contact with no company is global and
    // serves every one of them); units and locations are shared.
    const itemByName = new Map(itemRows.map((i) => [`${i.companyId}|${key(i.name)}`, i.id]));
    const unitByName = new Map(unitRows.map((u) => [key(u.name), u.id]));
    const locationByName = new Map(locationRows.map((l) => [key(l.name), l.id]));
    const supplierId = (companyId: string, name: string) => {
      const matches = supplierRows.filter((s) => key(s.displayName) === key(name) && inCompany(companyId)(s));
      return (matches.find((s) => s.companyId === companyId) ?? matches[0])?.id ?? "";
    };

    // What makes several rows one purchase: same supplier, same date. Everything
    // bought from Lucky Cement on the 25th is one document with all its items on
    // it, however many rows the file spends on them; the same day's delivery from
    // another supplier is its own. Company is in the key because a document belongs
    // to one set of books — the same supplier on the same day in Royal Hardware and
    // in M52 is two purchases, not one.
    //
    // Location is not: it's a header field, so the group's first row says where the
    // goods arrived and the rest follow. Case and spacing are normalised so "lucky
    // cement" and "Lucky Cement" don't split into two.
    const groupKey = (row: Record<string, string>) =>
      [row.company, row.supplier, csvDate(row.documentDate ?? "")].map((v) => (v ?? "").trim().toLowerCase()).join("|");

    const groups = new Map<string, { row: Record<string, string>; index: number }[]>();
    rows.forEach((row, index) => {
      const key = groupKey(row);
      groups.set(key, [...(groups.get(key) ?? []), { row, index }]);
    });

    const errors: string[] = [];
    // +2, not +1: row 1 of the file is the heading.
    const label = (index: number) => `Row ${index + 2}`;
    const forms: { name: string; form: FormData }[] = [];

    for (const group of groups.values()) {
      const { row: head, index } = group[0];
      const at = label(index);

      const company = (head.company ?? "").trim();
      const companyId = companyByName.get(company.toLowerCase());
      if (!company) errors.push(`${at}: Company is required.`);
      else if (!companyId) errors.push(`${at}: no company named "${company}" — check the spelling.`);

      const rawDate = (head.documentDate ?? "").trim();
      const documentDate = csvDate(rawDate);
      if (!rawDate) errors.push(`${at}: Document Date is required.`);
      else if (!documentDate) errors.push(`${at}: "${rawDate}" is not a date — use DD-MM-YYYY.`);

      if (!(head.supplier ?? "").trim()) errors.push(`${at}: Supplier is required.`);
      if (!(head.location ?? "").trim()) errors.push(`${at}: Location is required — goods have to arrive somewhere.`);

      // Settlement is only read when the purchase says it was paid — the same rule
      // the form follows, where the account picker only appears for a paid one.
      const paid = csvBool(head.paid ?? "", false);
      const settlementType = (head.settlementType ?? "").trim().toLowerCase() as SettlementType | "";
      const settlementAccount = (head.settlementAccount ?? "").trim();
      let settlementId = "";
      if (paid) {
        if (!settlementType) {
          errors.push(`${at}: Paid is yes, so Settlement Type must be account, cash or cheque.`);
        } else if (!["account", "cash", "cheque"].includes(settlementType)) {
          errors.push(`${at}: "${head.settlementType}" is not a settlement type — use account, cash or cheque.`);
        } else if (!settlementAccount) {
          errors.push(`${at}: Paid is yes, so name the ${settlementType === "cheque" ? "cheque" : "account"} that settled it.`);
        } else if (settlementType === "cheque") {
          // Cheque options are labelled "0001234 (50000)"; the file carries the
          // number on its own.
          const hit = chequeOptions.find((c) => c.name === settlementAccount || c.name.startsWith(`${settlementAccount} (`));
          if (!hit) errors.push(`${at}: cheque "${settlementAccount}" is not in the register, or is already settling something else.`);
          else settlementId = hit.id;
        } else {
          const hit = byName(settlementType === "account" ? bankOptions : cashOptions, settlementAccount);
          if (!hit) errors.push(`${at}: no ${settlementType === "account" ? "bank" : "cash"} account named "${settlementAccount}".`);
          else settlementId = hit.id;
        }
      }

      const lines = [];
      for (const { row, index: lineIndex } of group) {
        const lineAt = label(lineIndex);
        const item = (row.item ?? "").trim();
        const quantity = (row.quantity ?? "").trim();
        const unitPrice = (row.unitPrice ?? "").trim();
        if (!item) errors.push(`${lineAt}: Item is required.`);
        if (!quantity) errors.push(`${lineAt}: Quantity is required.`);
        else if (!(Number(quantity) > 0)) errors.push(`${lineAt}: Quantity has to be a number above zero.`);
        if (!unitPrice) errors.push(`${lineAt}: Unit Price is required.`);
        else if (Number.isNaN(Number(unitPrice))) errors.push(`${lineAt}: Unit Price has to be a number.`);
        const unit = (row.unit ?? "").trim();
        lines.push({
          // Id when the name is one we already have, text when it isn't — a name
          // that matches nothing is created on save, the same as typing a new one
          // into the popup (lib/actions/resolve-refs.ts). The id is what saves the
          // round trip; the text is what makes the create possible.
          itemId: companyId ? (itemByName.get(`${companyId}|${key(item)}`) ?? "") : "",
          itemName: item,
          unitId: unitByName.get(key(unit)) ?? "",
          unitName: unit,
          quantity,
          unitPrice,
          // Filled in below: it needs the shipping and every line of this
          // purchase, and neither is in hand yet.
          unitCost: "",
        });
      }

      if (!companyId || errors.length > 0) continue;

      // Discount and tax take rupees or a percentage of the subtotal ("250" or
      // "5%"), the same as the boxes in the popup — which post the resolved amount,
      // never the percentage, so the resolving happens here too.
      const subtotal = round1(lines.reduce((sum, l) => sum + (Number(l.quantity) || 0) * (Number(l.unitPrice) || 0), 0));
      const discount = resolveAdjustment(head.discountTotal ?? "", subtotal);
      const tax = resolveAdjustment(head.taxTotal ?? "", subtotal);

      // The landed cost the popup shows in its Unit Cost column — shipping,
      // discount and tax spread over every unit that came in the delivery. All
      // three are per-purchase figures in the file, and the discount and tax can
      // be percentages of the subtotal, so a line's share can only be worked out
      // once every line has been read and those two resolved.
      const perUnit = perUnitShare(
        (Number((head.shippingTotal ?? "").trim()) || 0) - discount + tax,
        lines.reduce((sum, l) => sum + (Number(l.quantity) || 0), 0),
      );
      for (const l of lines) l.unitCost = String(landedUnitCost(Number(l.unitPrice) || 0, perUnit));

      const form = new FormData();
      form.set("companyId", companyId);
      form.set("documentDate", documentDate);
      form.set("documentTypeMode", "existing");
      // Filled in below: always Purchase Invoice, exactly as the popup hard-wires
      // it, and created for the company if it hasn't got one yet.
      form.set("documentTypeId", "");
      const supplier = (head.supplier ?? "").trim();
      const location = (head.location ?? "").trim();
      form.set("contactId", supplierId(companyId, supplier));
      form.set("contactName", supplier);
      form.set("locationId", locationByName.get(key(location)) ?? "");
      form.set("locationName", location);
      form.set("discountTotal", String(discount));
      form.set("taxTotal", String(tax));
      form.set("shippingTotal", (head.shippingTotal ?? "").trim());
      form.set("isPaid", paid ? "yes" : "no");
      if (paid) {
        form.set("settlementType", settlementType);
        form.set(
          settlementType === "account" ? "bankAccountId" : settlementType === "cash" ? "cashAccountId" : "chequeId",
          settlementId,
        );
      }
      form.set("linesJson", JSON.stringify(lines));
      // Names the purchase in any error message — there is no ref column to quote,
      // so it's the delivery itself: who it came from and when.
      forms.push({ name: `${(head.supplier ?? "").trim()} on ${(head.documentDate ?? "").trim()}`, form });
    }

    if (errors.length > 0) return { error: csvErrorText(errors) };

    // Each document is its own transaction: createStockPurchase is what allocates
    // the number, writes the lines and posts the stock movements, and reusing it is
    // the only way an imported purchase and a typed one stay the same thing.
    //
    // Four at a time, not one: a document is ~8 round trips of its own and they
    // don't depend on each other, so waiting for one before starting the next made
    // a 40-purchase file a minute of pure latency. Four is what the connection pool
    // has room for (max 6, and the page the user is looking at still needs one).
    // The number sequence is a single atomic statement, so concurrent documents
    // can't collide over it.
    //
    // A failure stops the run rather than ploughing on, and the message says how
    // many were already committed — the ones in flight beside it may commit too,
    // which is why it counts rather than promising a number.
    const CONCURRENCY = 4;
    let created = 0;
    let failure: string | null = null;
    const queue = [...forms];

    async function worker() {
      while (!failure) {
        const next = queue.shift();
        if (!next) return;
        const { name, form } = next;
        if (!form.get("documentTypeId")) {
          const documentType = await ensureDocumentType({
            companyId: String(form.get("companyId")),
            code: "PURCHASE_INVOICE",
            name: "Purchase Invoice",
            series: "PI",
            affectsInventory: true,
            affectsPayable: true,
            active: true,
          });
          form.set("documentTypeId", String(documentType.id));
        }
        const result = await createStockPurchase(undefined, form);
        if (result.error) {
          failure ??= `The purchase from ${name} failed: ${result.error}`;
          return;
        }
        created++;
      }
    }

    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker));

    if (failure) return { error: `${failure}${created > 0 ? ` ${created} purchase(s) were saved before it.` : ""}` };
    return { created };
  });
}

