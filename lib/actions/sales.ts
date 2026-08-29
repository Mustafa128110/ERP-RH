"use server";

import { and, desc, eq, getTableColumns, gte, ilike, inArray, lte, ne, sql } from "drizzle-orm";
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
  settings,
  paymentAllocations,
  marketPurchaseRequests,
} from "@/lib/db/schema";
import { getLiveSession, getSession } from "@/lib/auth/session";
import { requirePermission } from "@/lib/auth/permissions";
import { companyInPermissionScope, companyInScope, getScopeCompanyIds } from "@/lib/auth/scope";
import { CACHE, getAvailableCheques, invalidateLookups, invalidateReads, READ_DOMAIN } from "@/lib/queries/lookups";
import { ensureDocumentType, nextDocumentNumber } from "@/lib/actions/document-numbering";
import { adjustSettlementBalance, SettlementScopeError, type SettlementType } from "@/lib/actions/settlement";
import { financialDocumentError, itemBearingLines } from "@/lib/financial-input";
import { resolveContactId, resolveItemIds, resolveUnitIds } from "@/lib/actions/resolve-refs";
import { recomputeParty, releaseInvoiceAllocations } from "@/lib/actions/payment-allocation";
import { changeSummary } from "@/lib/audit-constants";
import { DEFAULT_SALE_TYPE, isSaleType } from "@/lib/sale-constants";
import { round1 } from "@/lib/format";
import { guard, describeDbError, type ActionResult } from "@/lib/actions/guard";
import { recordAudit } from "@/lib/actions/audit";
import { claimOperation, readOperationId, DuplicateOperationError } from "@/lib/actions/operation-id";
import { ChequeUnavailableError, linkCheque } from "@/lib/actions/cheque-link";
import { cachedPageRead, stableReadKey } from "@/lib/read-cache";
import { resolveBaseQuantities, MissingUnitConversionError } from "@/lib/queries/unit-conversion";
import { resolveDocumentTax, TaxConfigurationError } from "@/lib/queries/document-tax";

// A sale writes the invoice, the stock it took out, the customer's ledger and
// whatever settled it. `purchases` is deliberately absent — this file names no
// PURCHASE_INVOICE, so the purchase list cannot show anything it wrote — and
// `accounts` is present because adjustSettlementBalance moves a balance in raw
// SQL that no ORM write here reveals.
const READS = [
  READ_DOMAIN.sales,
  READ_DOMAIN.ledger,
  READ_DOMAIN.products,
  READ_DOMAIN.stock,
  READ_DOMAIN.payments,
  READ_DOMAIN.expenses,
  READ_DOMAIN.accounts,
] as const;

export interface SaleItemRow {
  itemName: string;
  quantity: string;
  unitPrice: string;
  lineTotal: string;
  unitName: string | null;
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
    await companyInPermissionScope(documents.companyId, session, "sales"),
    filters.from ? gte(documents.documentDate, filters.from) : undefined,
    filters.to ? lte(documents.documentDate, filters.to) : undefined,
    filters.saleType && isSaleType(filters.saleType) ? eq(documents.saleType, filters.saleType) : undefined,
  );
  const cacheScope = (await getScopeCompanyIds()).sort().join(",");

  return cachedPageRead(READ_DOMAIN.sales, `${session.userId}:sales:${cacheScope}:${stableReadKey(filters)}`, async () => {

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
        status: documents.status,
        subtotal: documents.subtotal,
        grandTotal: documents.grandTotal,
        isPaid: documents.isPaid,
        paidAmount: documents.paidAmount,
        discountTotal: documents.discountTotal,
        taxTotal: documents.taxTotal,
        shippingTotal: documents.shippingTotal,
        saleType: documents.saleType,
        customer: contacts.displayName,
        company: sql<string>`coalesce(${companies.shortName}, ${companies.name})`,
      })
      .from(documents)
      .innerJoin(documentTypes, eq(documentTypes.id, documents.documentTypeId))
      .innerJoin(companies, eq(companies.id, documents.companyId))
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
        unitName: units.name,
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
    arr.push({ itemName: l.itemName, quantity: l.quantity, unitPrice: l.unitPrice, lineTotal: l.lineTotal, unitName: l.unitName, unitSymbol: l.unitSymbol });
    linesByDoc.set(l.documentId, arr);
  }

  return docs.map((d) => ({ ...d, items: linesByDoc.get(d.id) ?? [] }));
  });
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
// opening-balance entry posted from the Ledger screen. It used to sum
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
// Sign follows the statement/list convention (debit - credit, positive = they
// owe us). A contact who is also
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
        await companyInPermissionScope(ledgerEntries.companyId, session, "sales"),
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
    db
      .select(getTableColumns(documents))
      .from(documents)
      .innerJoin(documentTypes, eq(documentTypes.id, documents.documentTypeId))
      .where(and(eq(documents.id, documentId), eq(documents.status, "posted"), eq(documentTypes.code, "SALES_INVOICE"), await companyInPermissionScope(documents.companyId, session, "sales")))
      .limit(1),
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
    taxId: doc.taxId,
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
      marketPurchase: l.marketPurchase,
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
        contactId: documents.contactId,
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
        invoiceFooter: settings.value,
      })
      .from(documents)
      .innerJoin(documentTypes, eq(documentTypes.id, documents.documentTypeId))
      .innerJoin(companies, eq(companies.id, documents.companyId))
      .leftJoin(contacts, eq(contacts.id, documents.contactId))
      .leftJoin(settings, and(eq(settings.companyId, documents.companyId), eq(settings.key, "invoice_footer")))
      .where(and(eq(documents.id, documentId), eq(documentTypes.code, "SALES_INVOICE"), await companyInPermissionScope(documents.companyId, session, "sales")))
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

  // Previous balance: what this customer still owes from earlier invoices,
  // excluding this one. A new customer or one who has settled up shows 0.
  let previousBalance = 0;
  if (doc.contactId) {
    const [bal] = await db
      .select({
        owed: sql<string>`coalesce(sum(${ledgerEntries.debit} - ${ledgerEntries.credit}), 0)`,
      })
      .from(ledgerEntries)
      .innerJoin(documents, eq(documents.id, ledgerEntries.documentId))
      .where(
        and(
          eq(documents.contactId, doc.contactId),
          ne(documents.id, documentId),
          await companyInPermissionScope(ledgerEntries.companyId, session, "sales"),
        ),
      );
    previousBalance = Math.max(0, Math.round(Number(bal?.owed ?? 0) * 10) / 10);
  }

  return { ...doc, previousBalance, lines: lineRows };
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
  marketPurchase?: boolean;
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
  return itemBearingLines(lines);
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
async function resolveLineRows(
  tx: SaleTx,
  companyId: string,
  lines: SaleLineInput[],
  locationId: string | null,
  tax: { taxable: boolean[]; lineTaxAmounts: number[] },
) {
  const itemIds = await resolveItemIds(tx, lines.map((line) => ({ companyId, itemId: line.itemId || null, itemName: line.itemName || null })));
  const unitIds = await resolveUnitIds(tx, lines.map((line) => ({ unitId: line.unitId || null, unitName: line.unitName || null })));
  // "assume-base": a sale is never refused over a conversion nobody has entered
  // yet. A line whose unit has no multiplier to the item's base unit counts its
  // quantity as base units — the same thing this resolver already does for an item
  // with no base unit — so the invoice, the ledger and the customer are correct
  // and only the stock figure is approximate. Entering the conversion on the
  // products page and re-saving the sale puts that right.
  const baseQuantities = await resolveBaseQuantities(
    tx,
    lines.map((line, index) => ({ itemId: itemIds[index] ?? null, unitId: unitIds[index] ?? null, quantity: Number(line.quantity) })),
    "assume-base",
  );
  return lines.map((l, i) => {
    const quantity = Number(l.quantity);
    const unitPrice = Number(l.unitPrice) || 0;
    return {
      lineNo: i + 1,
      sortOrder: i,
      itemId: itemIds[i] ?? null,
      locationId,
      unitId: unitIds[i] ?? null,
      quantity: String(quantity),
      baseQuantity: String(baseQuantities[i]),
      unitPrice: String(unitPrice),
      unitCost: l.unitCost ? String(Number(l.unitCost)) : null,
      marketPurchase: Boolean(l.marketPurchase),
      lineTotal: String(quantity * unitPrice),
      taxable: tax.taxable[i] ?? false,
      taxAmount: String(tax.lineTaxAmounts[i] ?? 0),
      stockMovement: -1,
    };
  });
}

async function createMarketPurchaseRequests(
  tx: SaleTx,
  companyId: string,
  saleDocumentId: string,
  lines: Awaited<ReturnType<typeof resolveLineRows>>,
  insertedLines: { id: string }[],
) {
  const requests = lines
    .map((line, index) => ({ line, lineId: insertedLines[index]?.id }))
    .filter(({ line, lineId }) => line.marketPurchase && line.itemId && lineId);
  if (requests.length === 0) return;
  await tx.insert(marketPurchaseRequests).values(
    requests.map(({ line, lineId }) => ({
      companyId,
      saleDocumentId,
      saleLineId: lineId!,
      itemId: line.itemId!,
      unitId: line.unitId,
      quantity: line.quantity,
      baseQuantity: line.baseQuantity,
    })),
  );
}

export async function createSale(_prevState: (ActionResult & { id?: string }) | undefined, formData: FormData): Promise<ActionResult & { id?: string }> {
  return guard("Couldn't create the sale.", async () => {
  const session = await getLiveSession();

  const companyId = String(formData.get("companyId") ?? "");
  const documentDate = String(formData.get("documentDate") ?? "");
  if (!companyId) return { error: "Company is required." };
  if (!documentDate) return { error: "Document date is required." };
  // Scoped to the submitted company: the user must both belong to it and hold
  // sales.create there — a permission held in some other company, or a company
  // access revoked since the form was filled, is refused rather than written
  // into. (sales.create anywhere used to pass and the company was never checked.)
  requirePermission(session, "sales", "create", { companyId });

  const validLines = readLines(formData);
  if (validLines.length === 0) return { error: "Add at least one item." };

  const contactId = opt(formData, "contactId");
  const contactName = opt(formData, "contactName");
  if (!contactId && !contactName) return { error: "Customer is required." };
  const discountTotal = num(formData, "discountTotal", "0");
  const shippingTotal = num(formData, "shippingTotal", "0");
  const financialError = financialDocumentError(validLines, [
    { label: "Discount", value: discountTotal },
    { label: "Shipping", value: shippingTotal },
  ]);
  if (financialError) return { error: financialError };
  // Unrecognised (or absent) falls back to counter rather than erroring — it is
  // the answer for the overwhelming majority of sales, and a rejected invoice
  // over a dropdown nobody touched helps nobody.
  const saleTypeRaw = String(formData.get("saleType") ?? "");
  const saleType = isSaleType(saleTypeRaw) ? saleTypeRaw : DEFAULT_SALE_TYPE;

  const subtotal = round1(validLines.reduce((sum, l) => sum + Number(l.quantity) * (Number(l.unitPrice) || 0), 0));
  let tax;
  try {
    tax = await resolveDocumentTax(
      companyId,
      opt(formData, "taxId"),
      validLines.map((line) => ({ itemId: line.itemId || null, lineTotal: Number(line.quantity) * (Number(line.unitPrice) || 0) })),
      Number(discountTotal),
      Number(shippingTotal),
    );
  } catch (error) {
    if (error instanceof TaxConfigurationError) return { error: error.message };
    throw error;
  }
  const taxTotal = String(tax.taxTotal);
  const grandTotal = tax.grandTotal;

  // Read after the total is known — a part payment is only meaningful against it.
  const payment = readPayment(formData, grandTotal);
  const payErr = paymentError(payment);
  if (payErr) return { error: payErr };
  const { paidAmount, isPaid, settles, bankAccountId, cashAccountId, chequeId } = payment;
  const balance = grandTotal - paidAmount;

  const documentType = await getOrCreateSalesDocumentType(companyId);
  const shopLocationId = await getShopLocationId();
  // Minted by the form when it opened; claimed inside the transaction below so a
  // replayed submit of a committed sale is refused instead of posted twice.
  const operationId = readOperationId(formData);

  let createdId: string;
  let createdNumber = "";
  try {
    createdId = await db.transaction(async (tx) => {
      // First statement: claim the operation id, or abort as a duplicate.
      if (!(await claimOperation(tx, operationId))) throw new DuplicateOperationError();
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
          taxId: tax.taxId,
          taxRate: String(tax.taxRate),
          taxInclusive: tax.taxInclusive,
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

      const lineRows = await resolveLineRows(tx, companyId, validLines, shopLocationId, tax);
      const insertedLines = await tx
        .insert(documentLines)
        .values(lineRows.map((l) => ({ ...l, companyId, documentId: doc.id })))
        .returning({ id: documentLines.id });
      await createMarketPurchaseRequests(tx, companyId, doc.id, lineRows, insertedLines);

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
            unitCost: String(l.unitCost ? Number(l.unitCost) * Number(l.quantity) / Number(l.baseQuantity) : 0),
            totalCost: String((Number(l.unitCost) || 0) * Number(l.quantity)),
          })),
        );
      }

      await tx.insert(documentNumberLedger).values({ companyId, documentTypeId: documentType.id, number, documentId: doc.id });

      // What was paid settles immediately: credit the chosen account with the
      // money that came in, which for a part payment is the amount paid, not the
      // grand total.
      if (settles && paidAmount > 0) {
        if (chequeId) {
          await linkCheque(tx, chequeId, doc.id, "in", companyId);
        }
        await adjustSettlementBalance(tx, "in", String(paidAmount), bankAccountId, cashAccountId, chequeId, 1, companyId);
      }

      // Whatever is left owing goes on the customer's ledger as a debit — the
      // ledger reads credit as "we owe the contact" (unpaid purchases) and debit
      // as the other direction, so a part-paid sale's balance lands under the
      // contact's name in the ledger's owed-to-us column. The contact isn't
      // stored on the entry: it hangs off the document, same as the payable side.
      if (balance > 0) {
        await tx.insert(ledgerEntries).values({ companyId, documentId: doc.id, debit: String(balance) });
      }

      // A customer who has paid ahead has money sitting on their account with
      // nowhere to go. This invoice is somewhere for it to go: recomputing the
      // queue lets the standing advance settle against it the moment it exists,
      // instead of leaving an invoice reading "outstanding" next to a receipt
      // reading "unapplied".
      await recomputeParty(tx, companyId, resolvedContactId);

      return doc.id;
    });
  } catch (e) {
    if (e instanceof DuplicateOperationError) return { error: e.message };
    if (e instanceof ChequeUnavailableError) return { error: e.message };
    if (e instanceof SettlementScopeError) return { error: e.message };
    if (e instanceof MissingUnitConversionError) return { error: e.message };
    return { error: describeDbError(e, "Can't create — document number already in use for this company/type.") };
  }

  // A sale can create items and contacts on the fly (resolve-refs.ts), so their
  // cached option lists are stale — without this a product typed into a sale is
  // missing from the item picker (and the products/stock pages) for the 5-minute
  // TTL, even though its stock movement is already recorded.
  await invalidateLookups(CACHE.documentTypes, CACHE.cheques, CACHE.items, CACHE.contacts);
  await invalidateReads(...READS);
  // /sales is the entry form — the page you are standing on when a sale saves.
  // The list the sale has to appear in is /sales/invoices, a different route.
  revalidatePath("/sales");
  revalidatePath("/sales/invoices");
  revalidatePath("/inventory/products");
  revalidatePath("/inventory/stock");
  // An outstanding balance lands on the customer's ledger row.
  revalidatePath("/ledger");
  await recordAudit({ action: "create", entity: "sale", entityId: createdId, summary: createdNumber, companyId, detail: `Total ${grandTotal}` });
  return { success: true, id: createdId };
  });
}

export async function updateSale(documentId: string, _prevState: ActionResult | undefined, formData: FormData): Promise<ActionResult> {
  return guard("Couldn't save the sale.", async () => {
    const session = await getLiveSession();

    const companyId = String(formData.get("companyId") ?? "");
    const documentDate = String(formData.get("documentDate") ?? "");
    if (!companyId) return { error: "Company is required." };
    if (!documentDate) return { error: "Document date is required." };
    // Scoped to the submitted company — membership and per-company permission,
    // so a forged or stale companyId can't steer an edit into another set of
    // books. The record itself is also read scoped below.
    requirePermission(session, "sales", "edit", { companyId });

    const validLines = readLines(formData);
    if (validLines.length === 0) return { error: "Add at least one item." };

    const contactId = opt(formData, "contactId");
    const contactName = opt(formData, "contactName");
    if (!contactId && !contactName) return { error: "Customer is required." };
    const discountTotal = num(formData, "discountTotal", "0");
    const shippingTotal = num(formData, "shippingTotal", "0");
    const financialError = financialDocumentError(validLines, [
      { label: "Discount", value: discountTotal },
      { label: "Shipping", value: shippingTotal },
    ]);
    if (financialError) return { error: financialError };
    // Unrecognised (or absent) falls back to counter rather than erroring — it is
    // the answer for the overwhelming majority of sales, and a rejected invoice
    // over a dropdown nobody touched helps nobody.
    const saleTypeRaw = String(formData.get("saleType") ?? "");
    const saleType = isSaleType(saleTypeRaw) ? saleTypeRaw : DEFAULT_SALE_TYPE;

    const subtotal = round1(validLines.reduce((sum, l) => sum + Number(l.quantity) * (Number(l.unitPrice) || 0), 0));
    let tax;
    try {
      tax = await resolveDocumentTax(
        companyId,
        opt(formData, "taxId"),
        validLines.map((line) => ({ itemId: line.itemId || null, lineTotal: Number(line.quantity) * (Number(line.unitPrice) || 0) })),
        Number(discountTotal),
        Number(shippingTotal),
      );
    } catch (error) {
      if (error instanceof TaxConfigurationError) return { error: error.message };
      throw error;
    }
    const taxTotal = String(tax.taxTotal);
    const grandTotal = tax.grandTotal;

    const payment = readPayment(formData, grandTotal);
    const payErr = paymentError(payment);
    if (payErr) return { error: payErr };
    const { paidAmount, isPaid, settles, bankAccountId, cashAccountId, chequeId } = payment;
    const balance = grandTotal - paidAmount;
    const shopLocationId = await getShopLocationId();

    // Read scoped: a guessed id must never resolve to a document in a company
    // the user can't act on — outside the scope it simply doesn't exist.
    const [existingDoc] = await db
      .select({
        number: documents.number,
        companyId: documents.companyId,
        contactId: documents.contactId,
        grandTotal: documents.grandTotal,
        documentDate: documents.documentDate,
        paidAmount: documents.paidAmount,
        bankAccountId: documents.bankAccountId,
        cashAccountId: documents.cashAccountId,
      })
      .from(documents)
      .innerJoin(documentTypes, eq(documentTypes.id, documents.documentTypeId))
      .where(and(eq(documents.id, documentId), eq(documents.status, "posted"), eq(documentTypes.code, "SALES_INVOICE"), await companyInScope(documents.companyId)))
      .limit(1);
    if (!existingDoc) return { error: "Sale not found." };
    const [postedReturn] = await db
      .select({ id: documents.id })
      .from(documents)
      .innerJoin(documentTypes, eq(documentTypes.id, documents.documentTypeId))
      .where(and(eq(documents.sourceDocumentId, documentId), eq(documents.status, "posted"), eq(documentTypes.code, "SALES_RETURN")))
      .limit(1);
    // Return lines retain the original invoice's line numbers and prices. Editing
    // that source afterwards would make the return's audit trail ambiguous, so
    // correct the return first instead of silently changing its foundation.
    if (postedReturn) return { error: "This sale has a posted sales return. Cancel that return before editing the sale." };
    const [confirmedMarketPurchase] = await db
      .select({ id: marketPurchaseRequests.id })
      .from(marketPurchaseRequests)
      .where(and(eq(marketPurchaseRequests.saleDocumentId, documentId), eq(marketPurchaseRequests.status, "confirmed")))
      .limit(1);
    if (confirmedMarketPurchase) return { error: "This sale has a confirmed market purchase. Cancel that market purchase before editing the sale." };
    // Receipts already allocated to this invoice no longer block the edit. They
    // are released below, the edit is applied, and FIFO is rebuilt for the whole
    // party — so an invoice edited down hands its excess to the next outstanding
    // one instead of asking the user to unpick the receipts by hand.
    //
    // The one case that still needs a word first is the one where money has to
    // move: an invoice reduced below what is already settled against it. The
    // caller confirms by listing the affected receipts (previewSaleEdit) and
    // sending them back with `confirmAllocations`.
    const [allocated] = await db
      .select({ amount: sql<string>`coalesce(sum(${paymentAllocations.amount}), 0)` })
      .from(paymentAllocations)
      .where(eq(paymentAllocations.invoiceDocumentId, documentId));
    const allocatedAmount = Number(allocated?.amount ?? 0);
    const releasedByEdit = Number((allocatedAmount - Math.max(0, balance)).toFixed(2));
    if (releasedByEdit > 0 && String(formData.get("confirmAllocations") ?? "") !== "1") {
      return { needsConfirmation: true, error: `This invoice already has ${allocatedAmount.toFixed(2)} settled against it, and the new total leaves room for less. Confirm the change to release ${releasedByEdit.toFixed(2)} to the customer's next outstanding invoice.` };
    }
    if (existingDoc.companyId !== companyId) return { error: "A posted sale can't be moved to another company. Delete it and enter it in the correct company." };
    let vanishedDuringSave = false;

    await db.transaction(async (tx) => {
      const [lockedDoc] = await tx
        .select({
          paidAmount: documents.paidAmount,
          bankAccountId: documents.bankAccountId,
          cashAccountId: documents.cashAccountId,
        })
        .from(documents)
        .where(and(eq(documents.id, documentId), eq(documents.companyId, companyId), eq(documents.status, "posted")))
        .limit(1)
        .for("update");
      if (!lockedDoc) {
        vanishedDuringSave = true;
        return;
      }
      const [existingCheque] = await tx
        .select({ id: chequeRegister.id })
        .from(chequeRegister)
        .where(eq(chequeRegister.documentId, documentId))
        .limit(1)
        .for("update");
      // Hand back the receipts before anything reads paid_amount. What is left is
      // the part payment taken at the counter, which is the only piece that came
      // through this invoice's own bank or cash account — the allocated piece
      // arrived through separate payment documents that are still posted, and
      // refunding it here would credit the same money twice.
      const { released } = await releaseInvoiceAllocations(tx, [documentId]);
      const tillPaid = Math.max(0, Number(lockedDoc.paidAmount) - released);
      // Reverse whatever was settled before applying the new figure — handles a
      // changed total, a changed part payment, and paid/unpaid flips in one pass.
      // Keyed on the amount rather than the is_paid flag, so a part payment gets
      // its actual amount back rather than nothing.
      if (tillPaid > 0) {
        await adjustSettlementBalance(
          tx,
          "in",
          tillPaid.toFixed(2),
          lockedDoc.bankAccountId,
          lockedDoc.cashAccountId,
          existingCheque?.id ?? null,
          -1,
          companyId,
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
          taxId: tax.taxId,
          taxRate: String(tax.taxRate),
          taxInclusive: tax.taxInclusive,
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
          await linkCheque(tx, chequeId, documentId, "in", companyId);
        }
        await adjustSettlementBalance(tx, "in", String(paidAmount), bankAccountId, cashAccountId, chequeId, 1, companyId);
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
      await tx.delete(marketPurchaseRequests).where(and(eq(marketPurchaseRequests.saleDocumentId, documentId), eq(marketPurchaseRequests.status, "pending")));
      if (oldLines.length > 0) {
        await tx.delete(inventoryTransactions).where(inArray(inventoryTransactions.documentLineId, oldLines.map((l) => l.id)));
      }
      await tx.delete(documentLines).where(eq(documentLines.documentId, documentId));
      const lineRows = await resolveLineRows(tx, companyId, validLines, shopLocationId, tax);
      const insertedLines = await tx
        .insert(documentLines)
        .values(lineRows.map((l) => ({ ...l, companyId, documentId })))
        .returning({ id: documentLines.id });
      await createMarketPurchaseRequests(tx, companyId, documentId, lineRows, insertedLines);

      const stockLines = lineRows.map((l, i) => ({ l, lineId: insertedLines[i].id })).filter(({ l }) => l.itemId);
      if (stockLines.length > 0) {
        await tx.insert(inventoryTransactions).values(
          stockLines.map(({ l, lineId }) => ({
            companyId,
            documentLineId: lineId,
            movement: -1,
            quantity: l.quantity,
            baseQuantity: l.baseQuantity,
            unitCost: String(l.unitCost ? Number(l.unitCost) * Number(l.quantity) / Number(l.baseQuantity) : 0),
            totalCost: String((Number(l.unitCost) || 0) * Number(l.quantity)),
          })),
        );
      }

      // Settlement is rebuilt from scratch for the party, in date order, rather
      // than patched: this edit may have changed the amount, the date or the
      // customer, and all three move the invoice's place in the queue. Both
      // parties when the customer changed — the invoice has left one account and
      // joined another, and each has to be re-run.
      await recomputeParty(tx, companyId, resolvedContactId);
      if (existingDoc.contactId && existingDoc.contactId !== resolvedContactId) {
        await recomputeParty(tx, existingDoc.companyId, existingDoc.contactId);
      }
    });
    if (vanishedDuringSave) return { error: "Sale not found — it may already have been deleted." };

    // A sale can create items and contacts on the fly (resolve-refs.ts), so their
    // cached option lists are stale — without this a product typed into a sale is
    // missing from the item picker (and the products/stock pages) for the 5-minute
    // TTL, even though its stock movement is already recorded.
    await invalidateLookups(CACHE.documentTypes, CACHE.cheques, CACHE.items, CACHE.contacts);
    await invalidateReads(...READS);
    revalidatePath("/sales");
    revalidatePath("/sales/invoices");
    revalidatePath("/inventory/products");
    revalidatePath("/inventory/stock");
    revalidatePath("/ledger");
    await recordAudit({
      action: "update",
      entity: "sale",
      entityId: documentId,
      summary: existingDoc.number,
      companyId,
      // Field level, old → new: this is the trail a correction leaves. Falls back
      // to the total when nothing tracked moved, so the entry is never blank.
      detail: changeSummary([
        ["Total", existingDoc.grandTotal, grandTotal.toFixed(2)],
        ["Date", existingDoc.documentDate, documentDate],
        ["Paid", existingDoc.paidAmount, paidAmount.toFixed(2)],
        ["Customer", existingDoc.contactId, contactId || contactName],
      ]) || `Total ${grandTotal}`,
    });
    return { success: true };
  });
}

export async function deleteSale(_prevState: ActionResult | undefined, formData: FormData): Promise<ActionResult> {
  return guard("Couldn't cancel the sale.", async () => {
  const session = await getLiveSession();
  requirePermission(session, "sales", "delete");

  const documentId = String(formData.get("documentId") ?? "");

  // Read scoped: a guessed id from an unauthorized company is "not found", and
  // the delete permission is then checked against the row's own company.
  const [existingDoc] = await db
    .select({
      number: documents.number,
      companyId: documents.companyId,
      contactId: documents.contactId,
      grandTotal: documents.grandTotal,
      paidAmount: documents.paidAmount,
      bankAccountId: documents.bankAccountId,
      cashAccountId: documents.cashAccountId,
    })
    .from(documents)
    .innerJoin(documentTypes, eq(documentTypes.id, documents.documentTypeId))
    .where(and(eq(documents.id, documentId), eq(documents.status, "posted"), eq(documentTypes.code, "SALES_INVOICE"), await companyInScope(documents.companyId)))
    .limit(1);
  if (!existingDoc) return { error: "Sale not found." };
  const [postedReturn] = await db
    .select({ id: documents.id })
    .from(documents)
    .innerJoin(documentTypes, eq(documentTypes.id, documents.documentTypeId))
    .where(and(eq(documents.sourceDocumentId, documentId), eq(documents.status, "posted"), eq(documentTypes.code, "SALES_RETURN")))
    .limit(1);
  if (postedReturn) return { error: "This sale has a posted sales return. Cancel that return before cancelling the sale." };
  const [confirmedMarketPurchase] = await db
    .select({ id: marketPurchaseRequests.id })
    .from(marketPurchaseRequests)
    .where(and(eq(marketPurchaseRequests.saleDocumentId, documentId), eq(marketPurchaseRequests.status, "confirmed")))
    .limit(1);
  if (confirmedMarketPurchase) return { error: "Cancel the confirmed market purchase before cancelling this sale." };
  // Allocated receipts no longer stop the cancellation. They are released below
  // and FIFO is rebuilt for the customer, so the receipts land on whatever is
  // still outstanding rather than having to be cancelled and re-entered.
  //
  // A confirmation is still required, because this moves other people's money
  // around: the caller lists the affected receipts (previewLedgerRowDelete) and
  // sends `confirmAllocations` back.
  const [allocated] = await db
    .select({ amount: sql<string>`coalesce(sum(${paymentAllocations.amount}), 0)` })
    .from(paymentAllocations)
    .where(eq(paymentAllocations.invoiceDocumentId, documentId));
  const allocatedAmount = Number(allocated?.amount ?? 0);
  if (allocatedAmount > 0 && String(formData.get("confirmAllocations") ?? "") !== "1") {
    return { needsConfirmation: true, error: `This invoice has ${allocatedAmount.toFixed(2)} of receipts settled against it. Confirm the cancellation to release them to the customer's other outstanding invoices.` };
  }
  requirePermission(session, "sales", "delete", { companyId: existingDoc.companyId });
  let vanishedDuringDelete = false;

  try {
    await db.transaction(async (tx) => {
      const [lockedDoc] = await tx
        .select({
          paidAmount: documents.paidAmount,
          bankAccountId: documents.bankAccountId,
          cashAccountId: documents.cashAccountId,
        })
        .from(documents)
        .where(and(eq(documents.id, documentId), eq(documents.companyId, existingDoc.companyId), eq(documents.status, "posted")))
        .limit(1)
        .for("update");
      if (!lockedDoc) {
        vanishedDuringDelete = true;
        return;
      }
      const [existingCheque] = await tx
        .select({ id: chequeRegister.id })
        .from(chequeRegister)
        .where(eq(chequeRegister.documentId, documentId))
        .limit(1)
        .for("update");
      // Hand back the receipts before anything reads paid_amount. What is left is
      // the part payment taken at this invoice's own counter, and that is the only
      // piece this invoice's bank or cash account should be credited back — the
      // allocated piece arrived through separate payment documents that are still
      // posted, and refunding it here would credit the same money twice.
      const { released } = await releaseInvoiceAllocations(tx, [documentId]);
      const tillPaid = Math.max(0, Number(lockedDoc.paidAmount) - released);
      if (tillPaid > 0) {
        await adjustSettlementBalance(
          tx,
          "in",
          tillPaid.toFixed(2),
          lockedDoc.bankAccountId,
          lockedDoc.cashAccountId,
          existingCheque?.id ?? null,
          -1,
          existingDoc.companyId,
        );
      }
      // Unlinked whatever the paid amount was: cheque_register.document_id is ON
      // DELETE NO ACTION, so a cheque still pointing here fails the delete. This
      // used to sit inside the branch above, which meant a cheque left attached to
      // a sale showing nothing paid made the sale undeletable.
      if (existingCheque) {
        await tx.update(chequeRegister).set({ documentId: null }).where(eq(chequeRegister.id, existingCheque.id));
      }
      await tx.execute(sql`
        INSERT INTO inventory_transactions
          (company_id, document_line_id, movement, quantity, base_quantity, unit_cost, total_cost)
        SELECT it.company_id, it.document_line_id, -it.movement, it.quantity,
               it.base_quantity, it.unit_cost, it.total_cost
        FROM inventory_transactions it
        JOIN document_lines dl ON dl.id = it.document_line_id
        WHERE dl.document_id = ${documentId}::uuid
      `);
      await tx
        .update(marketPurchaseRequests)
        .set({ status: "cancelled" })
        .where(and(eq(marketPurchaseRequests.saleDocumentId, documentId), eq(marketPurchaseRequests.status, "pending")));
      await tx.execute(sql`
        INSERT INTO ledger_entries (company_id, document_id, debit, credit)
        SELECT company_id, document_id, credit, debit
        FROM ledger_entries
        WHERE document_id = ${documentId}::uuid
      `);
      await tx.update(documents).set({ status: "cancelled", cancelledBy: session.userId, cancelledAt: new Date(), updatedAt: new Date() }).where(and(eq(documents.id, documentId), eq(documents.status, "posted")));
      // The invoice is gone from the queue, so every receipt on this customer's
      // account has to be walked again from the oldest item forward. Receipts that
      // were sitting on this invoice move to whatever is still outstanding, and any
      // remainder becomes an advance rather than vanishing with the invoice.
      await recomputeParty(tx, existingDoc.companyId, existingDoc.contactId);
    });
  } catch (e) {
    return { error: describeDbError(e, "Can't cancel this sale.") };
  }
  if (vanishedDuringDelete) return { error: "Sale not found — it may already have been deleted." };

  // A sale can create items and contacts on the fly (resolve-refs.ts), so their
  // cached option lists are stale — without this a product typed into a sale is
  // missing from the item picker (and the products/stock pages) for the 5-minute
  // TTL, even though its stock movement is already recorded.
  await invalidateLookups(CACHE.documentTypes, CACHE.cheques, CACHE.items, CACHE.contacts);
  await invalidateReads(...READS);
  revalidatePath("/sales");
  revalidatePath("/sales/invoices");
  revalidatePath("/inventory/products");
  revalidatePath("/inventory/stock");
  revalidatePath("/ledger");
  await recordAudit({
    action: "cancel",
    entity: "sale",
    entityId: documentId,
    summary: existingDoc.number,
    companyId: existingDoc.companyId,
    detail: allocatedAmount > 0
      ? `Total ${existingDoc.grandTotal}; released ${allocatedAmount.toFixed(2)} of settled receipts`
      : `Total ${existingDoc.grandTotal}`,
  });
  return { success: true };
  });
}
