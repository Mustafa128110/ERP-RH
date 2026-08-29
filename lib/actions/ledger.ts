"use server";

import { and, desc, eq, inArray, isNotNull, or, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { ledgerEntries, documents, documentTypes, documentNumberLedger, contacts, companies, documentLines, items, units, bankAccounts, cashAccounts, chequeRegister, contactOpeningBalances, paymentAllocations, auditLogs } from "@/lib/db/schema";
import { getLiveSession, getSession } from "@/lib/auth/session";
import { requirePermission, PermissionError } from "@/lib/auth/permissions";
import { companyInPermissionScope, getScopeCompanyIds } from "@/lib/auth/scope";
import { CACHE, invalidateLookups, invalidateReads, READ_DOMAIN, getPurchaseFormOptions, getCompanies, getContactOptions, getBankAccountOptions, getCashAccountOptions, getAvailableCheques } from "@/lib/queries/lookups";
import { ensureDocumentType, nextDocumentNumber } from "@/lib/actions/document-numbering";
import { resolveContactId } from "@/lib/actions/resolve-refs";
import { guard, DUPLICATE, type ActionResult } from "@/lib/actions/guard";
import { claimOperation, readOperationId, DuplicateOperationError } from "@/lib/actions/operation-id";
import { recordAudit, type AuditRow } from "@/lib/actions/audit";
import { recomputeParty, releaseInvoiceAllocations } from "@/lib/actions/payment-allocation";
import { changeSummary } from "@/lib/audit-constants";
import { cachedPageRead } from "@/lib/read-cache";
import {
  codeToLedgerType,
  closingBalance,
  describeImpacts,
  impactOfChange,
  settlementState,
  type DescribedImpact,
  type ImpactRef,
  type LedgerChange,
  type LedgerEntryType,
  type SettlementState,
} from "@/lib/ledger-constants";
import { isOpeningBalanceDirection, openingLedgerSide, openingStatementAmount } from "@/lib/ledger-opening-constants";
import { readPartySettlement, settleableAfterEdit } from "@/lib/queries/party-ledger";

// This file edits documents and ledger entries on both sides of the book and
// re-settles what they were paid with, so a write here can change every list that
// shows an invoice, a payment or a balance. `accounts` is in the set because
// adjustSettlementBalance moves an account balance in raw SQL.
const READS = [
  READ_DOMAIN.sales,
  READ_DOMAIN.purchases,
  READ_DOMAIN.payments,
  READ_DOMAIN.ledger,
  READ_DOMAIN.products,
  READ_DOMAIN.accounts,
] as const;

export interface ContactPayment {
  date: string;
  number: string;
  amount: string;
  direction: "made" | "received";
}

export interface ContactDocumentItem {
  itemName: string;
  quantity: string;
  unitPrice: string;
  lineTotal: string;
}

export interface ContactDocument {
  id: string;
  number: string;
  status: string;
  grandTotal: string;
  paidAmount: string;
  isPaid: boolean;
  items: ContactDocumentItem[];
}

export interface ContactLedgerBalance {
  contactId: string;
  displayName: string;
  companyId: string;
  company: string;
  credit: number;
  debit: number;
  balance: number;
  // The most recent few, newest first — what the hover panel on the contact name
  // shows, so "have we paid them lately?" is answered without leaving the page.
  recentPayments: ContactPayment[];
  // Last 6 sales invoices for "Owes Us" hover, and last 6 purchases for "We Owe" hover.
  recentInvoices: ContactDocument[];
  recentPurchases: ContactDocument[];
}

// Ledger entries carry no contactId directly — they hang off the document,
// which carries the contact, so a sale's balance shows up under the customer's
// name for free.
//
// Debit means the party owes us and credit means we owe them. `balance` uses the
// statement convention (debit - credit), so the list value is exactly the
// individual sheet's closing balance: positive receivable, negative payable.
export async function listLedgerBalances(): Promise<ContactLedgerBalance[]> {
  const session = await getSession();
  requirePermission(session, "accounts", "view");
  return loadLedgerBalances(session, "accounts");
}

export async function listPaymentLedgerBalances(): Promise<ContactLedgerBalance[]> {
  const session = await getSession();
  requirePermission(session, "payments", "view");
  return loadLedgerBalances(session, "payments");
}

async function loadLedgerBalances(
  session: NonNullable<Awaited<ReturnType<typeof getSession>>>,
  permissionModule: "accounts" | "payments",
): Promise<ContactLedgerBalance[]> {
  const cacheScope = (await getScopeCompanyIds()).sort().join(",");

  return cachedPageRead(READ_DOMAIN.ledger, `${session.userId}:ledger:${permissionModule}:${cacheScope}`, async () => {

  // Neither query depends on the other's rows, so they share one round trip.
  const docScope = await companyInPermissionScope(documents.companyId, session, permissionModule);
  const [rows, paymentRows, invoiceHeaders, purchaseHeaders] = await Promise.all([
    db
      .select({
        contactId: contacts.id,
        displayName: contacts.displayName,
        companyId: ledgerEntries.companyId,
        company: sql<string>`coalesce(${companies.shortName}, ${companies.name})`,
        credit: ledgerEntries.credit,
        debit: ledgerEntries.debit,
        code: documentTypes.code,
        bankAccountId: documents.bankAccountId,
        cashAccountId: documents.cashAccountId,
        bankCompanyId: bankAccounts.companyId,
        cashCompanyId: cashAccounts.companyId,
        chequeCompanyId: chequeRegister.companyId,
      })
      .from(ledgerEntries)
      .innerJoin(documents, eq(documents.id, ledgerEntries.documentId))
      .innerJoin(documentTypes, eq(documentTypes.id, documents.documentTypeId))
      .innerJoin(companies, eq(companies.id, ledgerEntries.companyId))
      .leftJoin(contacts, eq(contacts.id, documents.contactId))
      .leftJoin(bankAccounts, eq(bankAccounts.id, documents.bankAccountId))
      .leftJoin(cashAccounts, eq(cashAccounts.id, documents.cashAccountId))
      .leftJoin(chequeRegister, eq(chequeRegister.documentId, documents.id))
      // This used to read every company's entries regardless of who was signed in
      // or what the topbar was set to — the only list in the app that didn't scope.
      .where(await companyInPermissionScope(ledgerEntries.companyId, session, permissionModule)),

    // Every payment against a contact, newest first — sliced to five per contact
    // below. Both directions: a contact can be owed money on one invoice and owe
    // it on another, and "what has moved between us lately" is the question.
    // Filter out payments with invalid settlement accounts (wrong company).
    db
      .select({
        companyId: documents.companyId,
        contactId: documents.contactId,
        date: documents.documentDate,
        number: documents.number,
        amount: documents.grandTotal,
        code: documentTypes.code,
        bankAccountId: documents.bankAccountId,
        cashAccountId: documents.cashAccountId,
        bankCompanyId: bankAccounts.companyId,
        cashCompanyId: cashAccounts.companyId,
      })
      .from(documents)
      .innerJoin(documentTypes, eq(documentTypes.id, documents.documentTypeId))
      .leftJoin(bankAccounts, eq(bankAccounts.id, documents.bankAccountId))
      .leftJoin(cashAccounts, eq(cashAccounts.id, documents.cashAccountId))
      .where(
        and(
          inArray(documentTypes.code, ["PAYMENT_MADE", "PAYMENT_RECEIVED"]),
          eq(documents.status, "posted"),
          isNotNull(documents.contactId),
          await companyInPermissionScope(documents.companyId, session, permissionModule),
        ),
      )
      .orderBy(desc(documents.documentDate), desc(documents.createdAt)),

    // Last 6 sales invoices per contact for "Owes Us" hover.
    db
      .select({
        companyId: documents.companyId,
        contactId: documents.contactId,
        id: documents.id,
        number: documents.number,
        status: documents.status,
        grandTotal: documents.grandTotal,
        paidAmount: documents.paidAmount,
        isPaid: documents.isPaid,
        documentDate: documents.documentDate,
        createdAt: documents.createdAt,
      })
      .from(documents)
      .innerJoin(documentTypes, eq(documentTypes.id, documents.documentTypeId))
      .where(and(
        eq(documentTypes.code, "SALES_INVOICE"),
        eq(documents.status, "posted"),
        isNotNull(documents.contactId),
        docScope,
      ))
      .orderBy(desc(documents.documentDate), desc(documents.createdAt)),

    // Last 6 purchases per contact for "We Owe" hover.
    db
      .select({
        companyId: documents.companyId,
        contactId: documents.contactId,
        id: documents.id,
        number: documents.number,
        status: documents.status,
        grandTotal: documents.grandTotal,
        paidAmount: documents.paidAmount,
        isPaid: documents.isPaid,
        documentDate: documents.documentDate,
        createdAt: documents.createdAt,
      })
      .from(documents)
      .innerJoin(documentTypes, eq(documentTypes.id, documents.documentTypeId))
      .where(and(
        eq(documentTypes.code, "PURCHASE_INVOICE"),
        eq(documents.status, "posted"),
        isNotNull(documents.contactId),
        docScope,
      ))
      .orderBy(desc(documents.documentDate), desc(documents.createdAt)),
  ]);

  // Filter out payments with invalid settlement accounts (wrong company).
  // Mirrors adjustSettlementBalancesBatch validation:
  // - bank accounts: global (company_id IS NULL) or matching document's company
  // - cash accounts: must match document's company
  // - cheques: validated on delete (rare, and we don't have documentId here)
  const validPaymentRows = paymentRows.filter((p) => {
    if (p.bankAccountId) {
      if (p.bankCompanyId !== null && p.bankCompanyId !== p.companyId) return false;
    } else if (p.cashAccountId) {
      if (p.cashCompanyId !== p.companyId) return false;
    }
    return true;
  });

  // Split payments into made/received, 6 per direction per contact.
  const paymentsMadeByContact = new Map<string, ContactPayment[]>();
  const paymentsReceivedByContact = new Map<string, ContactPayment[]>();
  for (const p of validPaymentRows) {
    const key = `${p.companyId}:${p.contactId}`;
    const dir = p.code === "PAYMENT_MADE" ? "made" : "received";
    const map = dir === "made" ? paymentsMadeByContact : paymentsReceivedByContact;
    const list = map.get(key) ?? [];
    if (list.length < 6) {
      list.push({ date: p.date, number: p.number, amount: p.amount, direction: dir });
    }
    map.set(key, list);
  }

  // Apply the same settlement-ownership rule as the individual statement and
  // FIFO engine. A malformed historical payment cannot affect one surface while
  // being correctly excluded from the other.
  const validBalanceRows = rows.filter((r) => {
    if (r.code !== "PAYMENT_MADE" && r.code !== "PAYMENT_RECEIVED") return true;
    if (r.bankAccountId) return r.bankCompanyId === null || r.bankCompanyId === r.companyId;
    if (r.cashAccountId) return r.cashCompanyId === r.companyId;
    return r.chequeCompanyId === r.companyId;
  });

  // Keyed by company as well as contact: a contact belongs to one company, but
  // the same supplier is often set up in both, and their balances are separate
  // sets of books that must not be summed into one row.
  const byContact = new Map<string, ContactLedgerBalance>();
  for (const r of validBalanceRows) {
    const key = `${r.companyId}:${r.contactId ?? "unknown"}`;
    const entry = byContact.get(key) ?? {
      contactId: r.contactId ?? "unknown",
      displayName: r.displayName ?? "Unknown Contact",
      companyId: r.companyId,
      company: r.company,
      credit: 0,
      debit: 0,
      balance: 0,
      recentPayments: [...(paymentsMadeByContact.get(key) ?? []), ...(paymentsReceivedByContact.get(key) ?? [])],
      recentInvoices: [],
      recentPurchases: [],
    };
    entry.credit += Number(r.credit ?? 0);
    entry.debit += Number(r.debit ?? 0);
    byContact.set(key, entry);
  }

  // One sign everywhere: the list and statement both use debit - credit.
  const balances = Array.from(byContact.values())
    .map((e) => ({ ...e, balance: closingBalance(0, e.debit, e.credit) }))
    .sort((a, b) => a.displayName.localeCompare(b.displayName) || a.company.localeCompare(b.company));

  // Group invoice headers by contact, top 6 per contact.
  const invoicesByContact = new Map<string, typeof invoiceHeaders>();
  for (const h of invoiceHeaders) {
    const key = `${h.companyId}:${h.contactId}`;
    const list = invoicesByContact.get(key) ?? [];
    if (list.length < 6) list.push(h);
    invoicesByContact.set(key, list);
  }

  // Group purchase headers by contact, top 6 per contact.
  const purchasesByContact = new Map<string, typeof purchaseHeaders>();
  for (const h of purchaseHeaders) {
    const key = `${h.companyId}:${h.contactId}`;
    const list = purchasesByContact.get(key) ?? [];
    if (list.length < 6) list.push(h);
    purchasesByContact.set(key, list);
  }

  // Collect all document ids that need line items.
  const allDocIds = [
    ...invoiceHeaders.map((h) => h.id),
    ...purchaseHeaders.map((h) => h.id),
  ];

  // Fetch line items for all invoices and purchases in one query.
  const lineRows = allDocIds.length > 0 ? await db
    .select({
      documentId: documentLines.documentId,
      itemName: items.name,
      quantity: documentLines.quantity,
      unitPrice: documentLines.unitPrice,
      lineTotal: documentLines.lineTotal,
      unitSymbol: units.symbol,
    })
    .from(documentLines)
    .innerJoin(items, eq(items.id, documentLines.itemId))
    .leftJoin(units, eq(units.id, documentLines.unitId))
    .where(inArray(documentLines.documentId, allDocIds))
    .orderBy(documentLines.lineNo) : [];

  // Group items by document.
  const itemsByDoc = new Map<string, ContactDocumentItem[]>();
  for (const l of lineRows) {
    const arr = itemsByDoc.get(l.documentId) ?? [];
    arr.push({ itemName: l.itemName, quantity: String(l.quantity), unitPrice: String(l.unitPrice), lineTotal: String(l.lineTotal) });
    itemsByDoc.set(l.documentId, arr);
  }

  // Build recentInvoices and recentPurchases per contact.
  for (const [key, docs] of invoicesByContact) {
    const entry = byContact.get(key);
    if (entry) entry.recentInvoices = docs.map((d) => ({ id: d.id, number: d.number, status: d.status, grandTotal: String(d.grandTotal), paidAmount: String(d.paidAmount), isPaid: d.isPaid, items: itemsByDoc.get(d.id) ?? [] }));
  }
  for (const [key, docs] of purchasesByContact) {
    const entry = byContact.get(key);
    if (entry) entry.recentPurchases = docs.map((d) => ({ id: d.id, number: d.number, status: d.status, grandTotal: String(d.grandTotal), paidAmount: String(d.paidAmount), isPaid: d.isPaid, items: itemsByDoc.get(d.id) ?? [] }));
  }

  // A-Z by contact.
  return balances;
  });
}

// A balance that didn't come from a sale or a purchase — an opening balance
// carried over from the old books, a correction, a settlement agreed off-invoice.
//
// ledger_entries.document_id is NOT NULL: every opening-balance entry hangs off
// a document, which supplies its contact and date. Legacy storage uses the
// JOURNAL_ENTRY code and JE number series, but every party-facing surface calls
// it Opening Balance.
// Shared by both writers. Only the fields both of them post are validated here —
// editing a contact's balance identifies the company and the contact by the row
// that was clicked, not by form fields, so those two are checked by
// createOpeningBalanceEntry, which is the only caller that collects them.
function readEntryForm(formData: FormData) {
  const companyId = String(formData.get("companyId") ?? "");
  const documentDate = String(formData.get("documentDate") ?? "");
  const contactId = String(formData.get("contactId") ?? "").trim();
  const contactName = String(formData.get("contactName") ?? "").trim();
  const direction = String(formData.get("direction") ?? "");
  const amount = Number(String(formData.get("amount") ?? "").trim());
  const note = String(formData.get("note") ?? "").trim();

  const error = !documentDate
    ? "Date is required."
    : direction !== "owes_us" && direction !== "we_owe"
      ? "Pick which way the balance runs."
      : // The table's own CHECK rejects a zero row (one side must be > 0), so
        // this catches it here with a sentence rather than a failed insert.
        !Number.isFinite(amount) || amount <= 0
        ? "Enter an amount greater than zero."
        : null;

  return { companyId, documentDate, contactId, contactName, direction, amount, note, error };
}

// Writes one contact opening-balance entry: the document, its single ledger row,
// and the number. `signedAmount` uses the statement convention: debit - credit,
// so positive means they owe us and negative means we owe them.
//
// Shared by "+ Add Opening Balance" and by saving a contact's balance.
async function writeOpeningBalanceEntry(
  input: {
    companyId: string;
    documentDate: string;
    contactId: string | null;
    contactName: string | null;
    signedAmount: number;
    note: string;
    userId: string;
  },
  operationId: string,
) {
  const documentType = await ensureDocumentType({
    companyId: input.companyId,
    code: "JOURNAL_ENTRY",
    name: "Opening Balance",
    series: "JE",
    affectsAccounting: true,
    active: true,
  });
  const magnitude = Math.abs(input.signedAmount).toFixed(2);

  await db.transaction(async (tx) => {
    // First statement: claim the operation id, or abort as a duplicate.
    if (!(await claimOperation(tx, operationId))) throw new DuplicateOperationError();
    const number = await nextDocumentNumber(documentType.series, tx);
    const resolvedContactId = await resolveContactId(tx, input.companyId, input.contactId, input.contactName);
    const [doc] = await tx
      .insert(documents)
      .values({
        companyId: input.companyId,
        documentTypeId: documentType.id,
        number,
        status: "posted",
        documentDate: input.documentDate,
        contactId: resolvedContactId,
        subtotal: magnitude,
        grandTotal: magnitude,
        reason: input.note || null,
        createdBy: input.userId,
      })
      .returning({ id: documents.id });

    await tx.insert(ledgerEntries).values(
      input.signedAmount > 0
        ? { companyId: input.companyId, documentId: doc.id, debit: magnitude }
        : { companyId: input.companyId, documentId: doc.id, credit: magnitude },
    );

    await tx.insert(documentNumberLedger).values({ companyId: input.companyId, documentTypeId: documentType.id, number, documentId: doc.id });
    // An advance payment already sitting on the account must immediately settle
    // this new entry; otherwise it would wait until some unrelated later edit.
    await recomputeParty(tx, input.companyId, resolvedContactId);
  });
}

export async function createOpeningBalanceEntry(_prevState: ActionResult | undefined, formData: FormData): Promise<ActionResult> {
  return guard(
    "Couldn't add the opening balance.",
    async () => {
      const session = await getLiveSession();

      const { companyId, documentDate, contactId, contactName, direction, amount, note, error } = readEntryForm(formData);
      if (!companyId) return { error: "Company is required." };
      if (!contactId && !contactName) return { error: "Pick a contact or type a new name." };
      if (error) return { error };
      // There is no `ledger` module in the permission catalog and no ledger.create.
      // accounts.create is the nearest finance-write permission — Admin holds it,
      // Salesman doesn't, which is the intended split. Scoped to the submitted
      // company, so a forged companyId can't post into a set of books the user
      // can't act on.
      requirePermission(session, "accounts", "create", { companyId });

      await writeOpeningBalanceEntry(
        {
          companyId,
          documentDate,
          contactId: contactId || null,
          contactName: contactName || null,
          signedAmount: direction === "owes_us" ? amount : -amount,
          note,
          userId: session.userId,
        },
        readOperationId(formData),
      );

      // A typed-in contact is a new contact.
      await invalidateLookups(CACHE.documentTypes, CACHE.contacts, CACHE.cheques);
      await invalidateReads(...READS);
      revalidatePath("/ledger");
      await recordAudit({ action: "create", entity: "opening balance", summary: contactName || contactId, companyId, detail: `${direction} ${amount}${note ? ` — ${note}` : ""}` });
      return { success: true };
    },
    { [DUPLICATE]: "Can't add — an opening balance number is already in use for this company." },
  );
}

// Saving a contact's row from the ledger table. The balance shown is the sum of
// everything on that contact's books — sales, purchases, payments, earlier
// opening-balance entries — so it can't be "updated" in place; there is no single row
// holding it.
//
// What's saved instead is the difference: whatever number is typed becomes the
// balance, by posting one opening-balance entry for the gap. Nothing already recorded is
// touched, so the invoices behind the balance keep saying what they said, and a
// correction leaves a dated, noted trail of its own.
export async function setContactBalance(
  companyId: string,
  contactId: string,
  _prevState: ActionResult | undefined,
  formData: FormData,
): Promise<ActionResult> {
  return guard(
    "Couldn't save the balance.",
    async () => {
      const session = await getLiveSession();
      // Scoped to the company this balance lives in — membership + per-company
      // permission, so a stale or forged company id can't post a correction
      // into another set of books.
      requirePermission(session, "accounts", "create", { companyId });

      const { documentDate, direction, amount, note, error } = readEntryForm(formData);
      if (error) return { error };

      // Summed in the database rather than by pulling every entry back and
      // adding them up in JS. A contact with a few thousand movements was
      // shipping a few thousand rows across the wire to produce one number.
      const [totals] = await db
        .select({
          credit: sql<string>`coalesce(sum(${ledgerEntries.credit}), 0)`,
          debit: sql<string>`coalesce(sum(${ledgerEntries.debit}), 0)`,
        })
        .from(ledgerEntries)
        .innerJoin(documents, eq(documents.id, ledgerEntries.documentId))
        .where(and(eq(ledgerEntries.companyId, companyId), eq(documents.contactId, contactId)));

      const current = Number(totals?.debit ?? 0) - Number(totals?.credit ?? 0);
      const desired = direction === "owes_us" ? amount : -amount;
      const delta = Number((desired - current).toFixed(2));
      // Saving without changing the number is not an error, it just has nothing
      // to post — and a zero-value ledger row would fail the table's CHECK anyway.
      if (delta === 0) return { success: true };

      await writeOpeningBalanceEntry(
        {
          companyId,
          documentDate,
          contactId,
          contactName: null,
          signedAmount: delta,
          note: note || "Balance correction",
          userId: session.userId,
        },
        readOperationId(formData),
      );

      await invalidateLookups(CACHE.documentTypes, CACHE.cheques);
      await invalidateReads(...READS);
      revalidatePath("/ledger");
      await recordAudit({
        action: "update",
        entity: "contact balance",
        entityId: contactId,
        summary: `Balance set to ${direction === "we_owe" ? amount : -amount}`,
        companyId,
        detail: note || "Balance correction",
      });
      return { success: true };
    },
    { [DUPLICATE]: "Can't save — an opening balance number is already in use for this company." },
  );
}

// ---------------------------------------------------------------------------
// Party Ledger — detailed statement of account for one contact
// ---------------------------------------------------------------------------

export type PartyLedgerLineItem = {
  itemName: string;
  quantity: string;
  rate: string;
  lineTotal: string;
  unitSymbol: string | null;
};

export type PartyLedgerEntry = {
  id: string; // ledger entry id
  documentId: string; // document id (for deletion)
  date: string;
  type: LedgerEntryType;
  code: string | null; // document type code (e.g. SALES_INVOICE) for routing
  documentStatus: string;
  reference: string | null;
  debit: number;
  credit: number;
  // Nested detail: line items for sales/purchases, payment method for payments.
  lineItems?: PartyLedgerLineItem[];
  paymentMethod?: string | null;
  // How much of this entry FIFO has settled, and what that reads as. Present
  // only for the entries that carry a settleable balance — a sales invoice, a
  // purchase invoice, opening-balance entry, or payment.
  settledAmount?: number;
  settlement?: SettlementState;
  // Which invoices a payment went to, or which payments settled an invoice.
  // This is the second invariant made visible: the settlement state sits
  // underneath the running balance, not instead of it.
  settledAgainst?: PartyLedgerSettlementLink[];
  // True for the opening-balance row, which is rendered as the first line of the
  // statement rather than folded into a summary card. The running balance starts
  // from zero here (not from the opening figure) so the row reads as itself.
  isOpeningBalance?: boolean;
};

// One side of a FIFO allocation, named the way a person reads it.
export type PartyLedgerSettlementLink = {
  documentId: string;
  reference: string | null;
  date: string;
  type: LedgerEntryType;
  amount: number;
};

export type PartyLedgerResult = {
  contactId: string;
  displayName: string;
  companyName: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  city: string | null;
  entries: PartyLedgerEntry[];
  // The party's stored opening balance, signed the way the statement reads:
  // positive means the party owes us. It is not one of `entries` — it is the
  // figure the running balance starts from, and the statement already has a card
  // for it.
  openingBalance: number;
  // The document behind that figure, when there is one. Null when the opening
  // balance has never been set, or was set back to zero.
  openingBalanceDocumentId: string | null;
  // Money received (or paid out) beyond everything currently outstanding on that
  // side. Held on the party's account, and absorbed automatically by the next
  // invoice that lands in the same queue.
  advanceReceived: number;
  advancePaid: number;
};

export async function getPartyLedger(
  contactId: string,
  companyId?: string,
): Promise<PartyLedgerResult | null> {
  const session = await getSession();
  requirePermission(session, "accounts", "view");
  if (!contactId) return null;

  const [contactRows, docScope] = await Promise.all([
    db
      .select({
        id: contacts.id,
        displayName: contacts.displayName,
        companyName: contacts.companyName,
        phone: contacts.phone,
        email: contacts.email,
        address: contacts.address,
        city: contacts.city,
      })
      .from(contacts)
      .where(eq(contacts.id, contactId))
      .limit(1),
    // Fetch all ledger entries for this contact, newest-first for slicing,
    // then we reverse to chronological for the running balance.
    companyInPermissionScope(documents.companyId, session, "accounts"),
  ]);

  const [contact] = contactRows;
  if (!contact) return null;

  const rows = await db
    .select({
      ledgerId: ledgerEntries.id,
      documentId: documents.id,
      date: documents.documentDate,
      code: documentTypes.code,
      documentStatus: documents.status,
      number: documents.number,
      debit: ledgerEntries.debit,
      credit: ledgerEntries.credit,
      bankAccountId: documents.bankAccountId,
      cashAccountId: documents.cashAccountId,
      bankCompanyId: bankAccounts.companyId,
      cashCompanyId: cashAccounts.companyId,
      companyId: ledgerEntries.companyId,
    })
    .from(ledgerEntries)
    .innerJoin(documents, eq(documents.id, ledgerEntries.documentId))
    .innerJoin(documentTypes, eq(documentTypes.id, documents.documentTypeId))
    .leftJoin(bankAccounts, eq(bankAccounts.id, documents.bankAccountId))
    .leftJoin(cashAccounts, eq(cashAccounts.id, documents.cashAccountId))
    .where(and(eq(documents.contactId, contactId), companyId ? eq(ledgerEntries.companyId, companyId) : undefined, docScope))
    .orderBy(desc(documents.documentDate), desc(documents.createdAt));

  // Filter out payments with invalid settlement accounts (wrong company).
  // This mirrors the validation in adjustSettlementBalancesBatch:
  // - bank accounts: global (company_id IS NULL) or matching document's company
  // - cash accounts: must match document's company
  // - cheques: validated separately below
  const validRows = rows.filter((r) => {
    if (r.code === "PAYMENT_MADE" || r.code === "PAYMENT_RECEIVED") {
      if (r.bankAccountId) {
        // Bank account must be global or match the document's company
        if (r.bankCompanyId !== null && r.bankCompanyId !== r.companyId) return false;
      } else if (r.cashAccountId) {
        // Cash account must match the document's company
        if (r.cashCompanyId !== r.companyId) return false;
      } else {
        // Cheque payment - will be validated when fetching cheque details
        // For now, include it; cheque validation happens in deletePayment
      }
    }
    return true;
  });

  // Validate cheque payments: fetch cheque details and filter out invalid ones
  const chequeDocIds = validRows
    .filter((r) => (r.code === "PAYMENT_MADE" || r.code === "PAYMENT_RECEIVED") && !r.bankAccountId && !r.cashAccountId)
    .map((r) => r.documentId);

  const validChequeDocIds = new Set<string>();
  if (chequeDocIds.length > 0) {
    const chequeRows = await db
      .select({ documentId: chequeRegister.documentId, companyId: chequeRegister.companyId })
      .from(chequeRegister)
      .where(inArray(chequeRegister.documentId, chequeDocIds));
    // Index the payment rows by document id once, so validating each cheque is
    // O(1) instead of the nested find that made this loop O(rows x cheques).
    const byDocId = new Map(validRows.map((r) => [r.documentId, r]));
    for (const c of chequeRows) {
      const matchingRow = c.documentId ? byDocId.get(c.documentId) : null;
      if (matchingRow && c.companyId === matchingRow.companyId && c.documentId) {
        validChequeDocIds.add(c.documentId);
      }
    }
  }

  const filteredRows = validRows.filter((r) => {
    if (r.code === "PAYMENT_MADE" || r.code === "PAYMENT_RECEIVED") {
      if (!r.bankAccountId && !r.cashAccountId) {
        // Cheque payment - must have valid cheque
        return validChequeDocIds.has(r.documentId);
      }
    }
    return true;
  });

  // Fetch line items for all documents that have them (sales/purchases).
  const docIds = filteredRows.map((r) => r.documentId);
  const lineRows = docIds.length > 0
    ? await db
        .select({
          documentId: documentLines.documentId,
          itemName: items.name,
          quantity: documentLines.quantity,
          unitPrice: documentLines.unitPrice,
          lineTotal: documentLines.lineTotal,
          unitSymbol: units.symbol,
        })
        .from(documentLines)
        .innerJoin(items, eq(items.id, documentLines.itemId))
        .leftJoin(units, eq(units.id, documentLines.unitId))
        .where(inArray(documentLines.documentId, docIds))
        .orderBy(documentLines.lineNo)
    : [];

  // Group line items by document.
  const linesByDoc = new Map<string, typeof lineRows>();
  for (const l of lineRows) {
    const arr = linesByDoc.get(l.documentId) ?? [];
    arr.push(l);
    linesByDoc.set(l.documentId, arr);
  }

  // Fetch payment method names for payment documents.
  const bankIds = [...new Set(filteredRows.filter((r) => r.bankAccountId).map((r) => r.bankAccountId!))];
  const cashIds = [...new Set(filteredRows.filter((r) => r.cashAccountId).map((r) => r.cashAccountId!))];

  const [bankRows, cashRows] = await Promise.all([
    bankIds.length > 0 ? db.select({ id: bankAccounts.id, label: bankAccounts.accountTitle }).from(bankAccounts).where(inArray(bankAccounts.id, bankIds)) : [],
    cashIds.length > 0 ? db.select({ id: cashAccounts.id, label: cashAccounts.name }).from(cashAccounts).where(inArray(cashAccounts.id, cashIds)) : [],
  ]);

  const bankNameById = new Map(bankRows.map((r) => [r.id, r.label]));
  const cashNameById = new Map(cashRows.map((r) => [r.id, r.label]));

  // Build entries — one per ledger row, with nested detail.
  const entries: PartyLedgerEntry[] = [];
  // Lifted out of the rows as they go past: the opening balance is the figure
  // the running balance starts from, not a movement in it, and the statement
  // already has a card for it.
  let openingBalance = 0;
  const openingDocumentIds: string[] = [];
  for (const r of filteredRows) {
    const type = codeToLedgerType(r.code);
    const debit = Number(r.debit ?? 0);
    const credit = Number(r.credit ?? 0);

    if (type === "opening_balance") {
      // Debit means the party owes us, which is the direction the statement
      // reads as positive. Summed across companies for a multi-company view.
      openingBalance += debit - credit;
      openingDocumentIds.push(r.documentId);
      // Render as the first chronological line of the statement rather than
      // only as a summary card: it is a real posting on the account, and hiding
      // it makes the running balance jump without a visible cause.
      const entry: PartyLedgerEntry = {
        id: r.ledgerId,
        documentId: r.documentId,
        date: r.date,
        type,
        code: r.code,
        documentStatus: r.documentStatus,
        reference: r.number,
        debit,
        credit,
        isOpeningBalance: true,
      };
      entries.push(entry);
      continue;
    }

    const lines = linesByDoc.get(r.documentId);

    const entry: PartyLedgerEntry = {
      id: r.ledgerId,
      documentId: r.documentId,
      date: r.date,
      type,
      code: r.code,
      documentStatus: r.documentStatus,
      reference: r.number,
      debit,
      credit,
    };

    if (lines && lines.length > 0 && (type === "item_sold" || type === "item_bought")) {
      entry.lineItems = lines.map((l) => ({
        itemName: l.itemName,
        quantity: String(l.quantity),
        rate: String(l.unitPrice),
        lineTotal: String(l.lineTotal),
        unitSymbol: l.unitSymbol,
      }));
    }

    if (type === "payment_received" || type === "payment_made") {
      if (r.bankAccountId) entry.paymentMethod = `Bank: ${bankNameById.get(r.bankAccountId) ?? "Account"}`;
      else if (r.cashAccountId) entry.paymentMethod = `Cash: ${cashNameById.get(r.cashAccountId) ?? "Account"}`;
      else entry.paymentMethod = "Cheque";
    }

    entries.push(entry);
  }

  // Chronological order (oldest first) for the running balance.
  // entries are already in desc order from the query, so reverse.
  entries.reverse();

  // Settlement — the ledger's second invariant, made visible. It is read off the
  // allocations rather than stored on the rows, so it cannot disagree with the
  // FIFO engine that wrote them.
  //
  // Only inside one company: payment_allocations is company-keyed, and there is
  // no such thing as a receipt in one company settling an invoice in another. A
  // statement not narrowed to a company still gets its running balance and its
  // opening figure — it just carries no paid/partial marks.
  let advanceReceived = 0;
  let advancePaid = 0;
  if (companyId) {
    const settlement = await readPartySettlement(db, companyId, contactId);
    const docById = new Map(settlement.documents.map((d) => [d.id, d]));
    const linksByDocument = new Map<string, PartyLedgerSettlementLink[]>();
    const push = (from: string, toId: string, amount: number) => {
      const to = docById.get(toId);
      if (!to) return;
      const list = linksByDocument.get(from) ?? [];
      list.push({ documentId: to.id, reference: to.number, date: to.date, type: to.type, amount });
      linksByDocument.set(from, list);
    };
    for (const a of settlement.allocations) {
      // Both directions from the one row: an invoice shows which payments closed
      // it, a payment shows where it went.
      push(a.itemId, a.paymentId, a.amount);
      push(a.paymentId, a.itemId, a.amount);
    }

    for (const entry of entries) {
      const doc = docById.get(entry.documentId);
      if (!doc) continue; // credit/debit notes and market purchases
      // An invoice settled at the counter is settled; a payment is "settled" once
      // all of it has found an invoice to sit against.
      const settled = entry.type === "payment_received" || entry.type === "payment_made"
        ? doc.allocated
        : doc.tillPaid + doc.allocated;
      entry.settledAmount = settled;
      entry.settlement = settlementState(doc.grandTotal, settled);
      const links = linksByDocument.get(entry.documentId);
      if (links && links.length > 0) entry.settledAgainst = links;
    }

    // What a payment could not place is an advance on the party's account — not
    // an error, and not handed back. The next invoice on that side absorbs it.
    for (const payment of settlement.payments) {
      const doc = docById.get(payment.id);
      if (!doc) continue;
      const unplaced = Math.max(0, doc.grandTotal - doc.allocated);
      if (payment.side === "receivable") advanceReceived += unplaced;
      else advancePaid += unplaced;
    }
  }

  return {
    contactId: contact.id,
    displayName: contact.displayName,
    companyName: contact.companyName,
    phone: contact.phone,
    email: contact.email,
    address: contact.address,
    city: contact.city,
    entries,
    openingBalance,
    // Only when there is exactly one to point at — an all-companies statement can
    // be summing several, and editing "the" opening balance then has no meaning.
    openingBalanceDocumentId: openingDocumentIds.length === 1 ? openingDocumentIds[0] : null,
    advanceReceived,
    advancePaid,
  };
}

// Cancel a document behind a ledger row. Delegates to the owning module's
// delete logic so inventory, settlements, cheques and allocations are all
// reversed correctly. Journal entries are handled directly here.
//
// `confirmed` carries the answer to the settlement confirmation. Each delegate
// refuses a delete that would move other documents' settlement until it is set,
// and returns a sentence saying what would move; the caller reads the full list
// from previewLedgerRowDelete first. Defaulted to false so an existing caller
// keeps the safe behaviour.
export async function deleteLedgerRow(documentId: string, confirmed = false): Promise<ActionResult> {
  return guard(
    "Couldn't delete this entry.",
    async () => {
      const session = await getLiveSession();
      // The ledger screen itself is accounts.view-gated. Establish that baseline
      // before building the company-scoped document query below; the journal
      // branch separately requires accounts.delete for the row's company.
      requirePermission(session, "accounts", "view");

      const [doc] = await db
        .select({
          id: documents.id,
          number: documents.number,
          status: documents.status,
          companyId: documents.companyId,
          contactId: documents.contactId,
          code: documentTypes.code,
        })
        .from(documents)
        .innerJoin(documentTypes, eq(documentTypes.id, documents.documentTypeId))
        .where(
          and(
            eq(documents.id, documentId),
            await companyInPermissionScope(documents.companyId, session, "accounts"),
          ),
        )
        .limit(1);

      if (!doc) return { error: "Entry not found." };
      if (doc.status === "cancelled") return { error: "Already cancelled." };

      // Build a FormData the way the module-specific delete functions expect it.
      const fd = new FormData();
      fd.set("documentId", documentId);
      if (confirmed) fd.set("confirmAllocations", "1");

      switch (doc.code) {
        case "JOURNAL_ENTRY": {
          // A contact opening-balance entry is handled here instead of by one of
          // the commerce modules, so it establishes its own scoped delete right.
          requirePermission(session, "accounts", "delete", { companyId: doc.companyId });
          const [allocated] = await db
            .select({ amount: sql<string>`coalesce(sum(${paymentAllocations.amount}), 0)` })
            .from(paymentAllocations)
            .where(eq(paymentAllocations.invoiceDocumentId, documentId));
          const allocatedAmount = Number(allocated?.amount ?? 0);
          if (allocatedAmount > 0 && !confirmed) {
            return {
              needsConfirmation: true,
              error: `This opening balance has ${allocatedAmount.toFixed(2)} settled against it. Confirm cancellation to release and reapply that payment by FIFO.`,
            };
          }
          let cancelled = false;
          await db.transaction(async (tx) => {
            // Claim the posted entry before writing a reversal. Two requests
            // that race here cannot both add the opposite entry.
            const [claimed] = await tx
              .update(documents)
              .set({
                status: "cancelled",
                cancelledBy: session.userId,
                cancelledAt: new Date(),
                updatedAt: new Date(),
              })
              .where(
                and(
                  eq(documents.id, documentId),
                  eq(documents.companyId, doc.companyId),
                  eq(documents.status, "posted"),
                ),
              )
              .returning({ id: documents.id });
            if (!claimed) return;
            cancelled = true;
            await releaseInvoiceAllocations(tx, [documentId]);
            // Financial history is immutable: retain the source rows and add
            // one linked-by-document opposite entry rather than hard deleting.
            await tx.execute(sql`
              INSERT INTO ledger_entries (company_id, document_id, debit, credit)
              SELECT company_id, document_id, credit, debit
              FROM ledger_entries
              WHERE document_id = ${documentId}::uuid
            `);
            await recomputeParty(tx, doc.companyId, doc.contactId);
          });
          if (!cancelled) return { error: "Already cancelled." };
          break;
        }
        // The opening balance is not deleted from the sheet — it is a standing
        // figure, and the way to remove it is to set it to zero, which keeps the
        // one document per party the settlement queues sort against.
        case "OPENING_BALANCE":
          return { error: "Set the opening balance to zero instead of deleting it." };
        case "SALES_INVOICE": {
          const { deleteSale } = await import("@/lib/actions/sales");
          const result = await deleteSale(undefined, fd);
          if (result?.error) return result;
          break;
        }
        case "PURCHASE_INVOICE":
        case "MARKET_PURCHASE": {
          const { deleteStockPurchase } = await import("@/lib/actions/purchases");
          const result = await deleteStockPurchase(undefined, fd);
          if (result?.error) return result;
          break;
        }
        case "PAYMENT_RECEIVED":
        case "PAYMENT_MADE": {
          const { deletePayment } = await import("@/lib/actions/payments");
          fd.set("paymentId", documentId);
          const result = await deletePayment(undefined, fd);
          if (result?.error) return result;
          break;
        }
        default:
          return { error: `Cannot cancel ${doc.code} from here.` };
      }

      revalidatePath("/ledger");
      await recordAudit({
        action: "cancel",
        entity: "ledger row",
        entityId: documentId,
        summary: doc.number,
        companyId: doc.companyId,
        detail: `${doc.code}${confirmed ? " — settlement confirmed" : ""}`,
      });
      return { success: true };
    },
  );
}

// ---------------------------------------------------------------------------
// Opening balance
// ---------------------------------------------------------------------------

// What the party's account started at, before anything in this system happened.
//
// It is one editable figure per party, and it settles: a party who owed us 40,000
// when the books were carried over has a 40,000 receivable, and the next receipt
// pays it off before it touches any invoice. That is why it is a real document
// rather than a column on `contacts` — payment_allocations.invoice_document_id is
// a NOT NULL foreign key to documents, so a figure that can be settled has to be
// one.
export type PartyOpeningBalance = {
  // Null before it has ever been set. Non-null afterwards, including when it has
  // been set back to zero: the document is kept as the anchor the FIFO queues sort
  // against, and it is the *ledger row* that comes and goes.
  documentId: string | null;
  // Positive means the party owes us — the statement's own convention (debit less
  // credit), which is the opposite sign to `writeJournalEntry`.
  signedAmount: number;
  date: string | null;
  note: string | null;
};

const OPENING_BALANCE_TYPE = {
  code: "OPENING_BALANCE",
  name: "Opening Balance",
  series: "OB",
} as const;

export async function getPartyOpeningBalance(companyId: string, contactId: string): Promise<PartyOpeningBalance> {
  const session = await getSession();
  requirePermission(session, "accounts", "view");
  const empty: PartyOpeningBalance = { documentId: null, signedAmount: 0, date: null, note: null };
  if (!companyId || !contactId) return empty;

  const [row] = await db
    .select({
      documentId: documents.id,
      date: documents.documentDate,
      note: documents.reason,
      debit: ledgerEntries.debit,
      credit: ledgerEntries.credit,
    })
    .from(contactOpeningBalances)
    .innerJoin(documents, eq(documents.id, contactOpeningBalances.documentId))
    // Left, not inner: a balance set back to zero has no ledger row, and the row
    // it does have is the one holding the sign.
    .leftJoin(ledgerEntries, eq(ledgerEntries.documentId, documents.id))
    .where(
      and(
        eq(contactOpeningBalances.companyId, companyId),
        eq(contactOpeningBalances.contactId, contactId),
        await companyInPermissionScope(documents.companyId, session, "accounts"),
      ),
    )
    .limit(1);

  if (!row) return empty;
  return {
    documentId: row.documentId,
    signedAmount: Number(row.debit ?? 0) - Number(row.credit ?? 0),
    date: row.date,
    note: row.note,
  };
}

// Reads the opening-balance form. Zero is valid here, unlike readEntryForm:
// clearing the figure is how a party's opening balance is removed, and refusing
// zero would leave no way to do it.
function readOpeningForm(formData: FormData) {
  const documentDate = String(formData.get("documentDate") ?? "");
  const direction = String(formData.get("direction") ?? "");
  const amount = Number(String(formData.get("amount") ?? "").trim());
  const note = String(formData.get("note") ?? "").trim();
  const validDirection = isOpeningBalanceDirection(direction);

  const error = !documentDate
    ? "Date is required."
    : !validDirection
      ? "Pick which way the balance runs."
      : !Number.isFinite(amount) || amount < 0
        ? "Enter an amount of zero or more."
        : null;

  const signedAmount = validDirection ? openingStatementAmount(direction, amount) : 0;
  return { documentDate, direction, amount, note, signedAmount, error };
}

// Sets (or clears) the party's opening balance, then rebuilds their settlement.
//
// Editing this figure is the widest change on the statement: every balance after
// it shifts, and the sign decides which queue it settles in, so raising it can
// pull receipts off invoices and flipping it can move the whole thing from the
// receivable queue to the payable one. All of which is why the recompute at the
// end is a full re-run rather than a patch.
export async function setPartyOpeningBalance(
  companyId: string,
  contactId: string,
  _prevState: ActionResult | undefined,
  formData: FormData,
): Promise<ActionResult> {
  return guard(
    "Couldn't save the opening balance.",
    async () => {
      const session = await getLiveSession();
      if (!companyId || !contactId) return { error: "Company and contact are required." };
      // Same permission as every other ledger write — see createLedgerEntry for
      // why accounts.create is the one that applies.
      requirePermission(session, "accounts", "create", { companyId });

      const { documentDate, note, signedAmount, error } = readOpeningForm(formData);
      if (error) return { error };

      const existing = await getPartyOpeningBalance(companyId, contactId);
      if (existing.signedAmount === signedAmount && existing.date === documentDate && (existing.note ?? "") === note) {
        return { success: true };
      }

      // Reducing the figure, or flipping its sign, takes settled money off the
      // items it was covering. Confirmed the same way an invoice edit is, with the
      // list coming from previewPartyOpeningBalance.
      const [allocated] = existing.documentId
        ? await db
            .select({ amount: sql<string>`coalesce(sum(${paymentAllocations.amount}), 0)` })
            .from(paymentAllocations)
            .where(eq(paymentAllocations.invoiceDocumentId, existing.documentId))
        : [undefined];
      const allocatedAmount = Number(allocated?.amount ?? 0);
      // Room left for those allocations after the change: none at all if the sign
      // flipped, since the figure leaves that queue entirely.
      const roomAfter = Math.sign(signedAmount) === Math.sign(existing.signedAmount) ? Math.abs(signedAmount) : 0;
      const releasedByEdit = Number((allocatedAmount - roomAfter).toFixed(2));
      if (releasedByEdit > 0 && String(formData.get("confirmAllocations") ?? "") !== "1") {
        return {
          needsConfirmation: true,
          error: `${allocatedAmount.toFixed(2)} is already settled against this opening balance, and the new figure leaves room for less. Confirm to release ${releasedByEdit.toFixed(2)} to the party's next outstanding item.`,
        };
      }

      const documentType = await ensureDocumentType({
        companyId,
        ...OPENING_BALANCE_TYPE,
        affectsAccounting: true,
        active: true,
      });
      const magnitude = Math.abs(signedAmount).toFixed(2);

      await db.transaction(async (tx) => {
        let documentId = existing.documentId;
        if (documentId) {
          // Hand back what was settled against the old figure before the new one
          // is written, for the reason releaseInvoiceAllocations documents: the
          // payments holding those allocations are separate posted documents.
          await releaseInvoiceAllocations(tx, [documentId]);
          await tx
            .update(documents)
            .set({
              documentDate,
              subtotal: magnitude,
              grandTotal: magnitude,
              // paid_amount goes back to zero along with the released
              // allocations: an opening balance has no counter payment of its
              // own, so everything settled against it came through FIFO.
              paidAmount: "0",
              isPaid: signedAmount === 0,
              reason: note || null,
              updatedAt: new Date(),
            })
            .where(eq(documents.id, documentId));
        } else {
          const number = await nextDocumentNumber(documentType.series, tx);
          const [doc] = await tx
            .insert(documents)
            .values({
              companyId,
              documentTypeId: documentType.id,
              number,
              status: "posted",
              documentDate,
              contactId,
              subtotal: magnitude,
              grandTotal: magnitude,
              paidAmount: "0",
              isPaid: signedAmount === 0,
              reason: note || null,
              createdBy: session.userId,
            })
            .returning({ id: documents.id });
          documentId = doc.id;
          await tx.insert(documentNumberLedger).values({ companyId, documentTypeId: documentType.id, number, documentId });
          // The pointer that makes "one opening balance per party" an invariant
          // the database holds rather than a rule this function remembers.
          await tx.insert(contactOpeningBalances).values({ companyId, contactId, documentId });
        }

        if (!documentId) throw new Error("Opening-balance document could not be created.");

        // Drop and re-add rather than update: the sign lives in which column is
        // filled, and a cleared balance has no row at all — ledger_entries' CHECK
        // requires one side to be greater than zero. `signedAmount` is statement
        // signed (debit minus credit), so a positive receivable is a debit.
        await tx.delete(ledgerEntries).where(eq(ledgerEntries.documentId, documentId));
        const side = openingLedgerSide(signedAmount);
        if (side) {
          await tx.insert(ledgerEntries).values(
            side === "debit"
              ? { companyId, documentId, debit: magnitude }
              : { companyId, documentId, credit: magnitude },
          );
        }
        await recomputeParty(tx, companyId, contactId);
      });

      await invalidateLookups(CACHE.documentTypes, CACHE.contacts);
      await invalidateReads(...READS);
      revalidatePath("/ledger");
      await recordAudit({
        action: existing.documentId ? "update" : "create",
        entity: "opening balance",
        entityId: contactId,
        summary: `Opening balance ${signedAmount.toFixed(2)}`,
        companyId,
        detail: changeSummary([
          ["Amount", existing.documentId ? existing.signedAmount.toFixed(2) : null, signedAmount.toFixed(2)],
          ["Date", existing.date, documentDate],
          ["Note", existing.note, note],
        ]) || `Opening balance ${signedAmount.toFixed(2)}`,
      });
      return { success: true };
    },
    { [DUPLICATE]: "Can't save — an opening balance number is already in use for this company." },
  );
}

// ---------------------------------------------------------------------------
// What a change would disturb, before it is made
// ---------------------------------------------------------------------------

// The confirmation dialogs' data: which payments and which invoices a pending
// edit or delete would move, named the way a person reads them.
//
// Every one of these re-runs the same FIFO engine the write runs, on a projection
// of the queues, and diffs the result against what is recorded. Nothing here
// guesses at what "might" be affected, and nothing here writes.
export type LedgerImpactPreview = {
  impacts: DescribedImpact[];
  // The amount that stops being settled and becomes an advance on the party's
  // account. Zero when the change only moves allocations between items.
  released: number;
};

// Shared tail: resolve the scope, read the party's settlement, project, diff.
async function previewImpact(companyId: string, contactId: string, change: LedgerChange): Promise<LedgerImpactPreview> {
  const settlement = await readPartySettlement(db, companyId, contactId);
  const impacts = impactOfChange(settlement, change);
  const refs = new Map<string, ImpactRef>(
    settlement.documents.map((d) => [d.id, { documentId: d.id, number: d.number, date: d.date, type: d.type }]),
  );
  const released = impacts.reduce((sum, i) => sum + Math.max(0, i.before - i.after), 0);
  return { impacts: describeImpacts(impacts, refs), released: Number(released.toFixed(2)) };
}

// Scope check for the preview actions: they read one party's whole account, so
// the document being previewed has to be one this session can act on.
async function previewScope(documentId: string): Promise<{ companyId: string; contactId: string } | { error: string }> {
  const session = await getSession();
  requirePermission(session, "accounts", "view");
  const [doc] = await db
    .select({ companyId: documents.companyId, contactId: documents.contactId })
    .from(documents)
    .where(
      and(
        eq(documents.id, documentId),
        eq(documents.status, "posted"),
        await companyInPermissionScope(documents.companyId, session, "accounts"),
      ),
    )
    .limit(1);
  if (!doc) return { error: "Entry not found." };
  if (!doc.contactId) return { error: "This entry is not on a party's account." };
  return { companyId: doc.companyId, contactId: doc.contactId };
}

// §6: what cancelling this row would do to the settlement. An empty `impacts` is
// the case that needs no confirmation — the row settles nothing and is settled by
// nothing, so only the running balance moves.
export async function previewLedgerRowDelete(documentId: string): Promise<LedgerImpactPreview | { error: string }> {
  const scope = await previewScope(documentId);
  if ("error" in scope) return scope;
  return previewImpact(scope.companyId, scope.contactId, { kind: "remove", documentId });
}

// §4: what changing this document's amount would do. `newGrandTotal` is the
// figure being typed, gross — the part already taken at the counter is subtracted
// here, because only the remainder was ever in the queue.
export async function previewLedgerRowAmount(
  documentId: string,
  newGrandTotal: number,
): Promise<LedgerImpactPreview | { error: string }> {
  const scope = await previewScope(documentId);
  if ("error" in scope) return scope;
  const settlement = await readPartySettlement(db, scope.companyId, scope.contactId);
  const doc = settlement.documents.find((d) => d.id === documentId);
  if (!doc) return { error: "Entry not found on this party's account." };
  // A payment offers its whole value to the queue; an invoice offers what is left
  // after the till.
  const amount = doc.type === "payment_received" || doc.type === "payment_made"
    ? Math.max(0, newGrandTotal)
    : settleableAfterEdit(doc, newGrandTotal);
  return previewImpact(scope.companyId, scope.contactId, { kind: "amount", documentId, amount });
}

// §4: what moving this document's date would do. A date change reorders the
// queue, so it can hand an older invoice a payment that a newer one was holding
// without any amount changing at all.
export async function previewLedgerRowDate(
  documentId: string,
  newDate: string,
): Promise<LedgerImpactPreview | { error: string }> {
  const scope = await previewScope(documentId);
  if ("error" in scope) return scope;
  return previewImpact(scope.companyId, scope.contactId, { kind: "date", documentId, date: newDate });
}

// §4: what setting the opening balance to this figure would do. Signed the
// statement's way — positive means the party owes us.
export async function previewPartyOpeningBalance(
  companyId: string,
  contactId: string,
  signedAmount: number,
): Promise<LedgerImpactPreview | { error: string }> {
  const session = await getSession();
  requirePermission(session, "accounts", "view");
  if (!companyId || !contactId) return { error: "Company and contact are required." };
  const existing = await getPartyOpeningBalance(companyId, contactId);
  return previewImpact(companyId, contactId, { kind: "opening", documentId: existing.documentId, signedAmount });
}

// ---------------------------------------------------------------------------
// §7 — the trail for one party
// ---------------------------------------------------------------------------

// Every edit and delete recorded against this party's opening balance, invoices,
// payments and opening-balance entries, oldest last.
//
// The audit log keys on the document id, so the party's documents are collected
// first and matched in one `IN` — two statements, not one per row. The contact id
// is matched as well, because the opening balance and the balance correction are
// logged against the party rather than against a document.
export async function getPartyAuditTrail(contactId: string, companyId?: string): Promise<AuditRow[]> {
  const session = await getSession();
  requirePermission(session, "accounts", "view");
  if (!contactId) return [];
  // The audit log has its own permission, and it gates a wider view than the
  // statement does. A user who can read the statement but not the audit log gets
  // an empty history rather than an error, so the panel simply has nothing in it.
  try {
    requirePermission(session, "audit", "view");
  } catch (e) {
    if (e instanceof PermissionError) return [];
    throw e;
  }

  const docs = await db
    .select({ id: documents.id })
    .from(documents)
    .where(
      and(
        eq(documents.contactId, contactId),
        companyId ? eq(documents.companyId, companyId) : undefined,
        await companyInPermissionScope(documents.companyId, session, "accounts"),
      ),
    );

  const ids = docs.map((d) => d.id);
  return db
    .select({
      id: auditLogs.id,
      createdAt: auditLogs.createdAt,
      userName: auditLogs.userName,
      action: auditLogs.action,
      entity: auditLogs.entity,
      entityId: auditLogs.entityId,
      summary: auditLogs.summary,
      detail: auditLogs.detail,
    })
    .from(auditLogs)
    .where(
      and(
        await companyInPermissionScope(auditLogs.companyId, session, "audit"),
        ids.length > 0
          ? or(inArray(auditLogs.entityId, ids), eq(auditLogs.entityId, contactId))
          : eq(auditLogs.entityId, contactId),
      ),
    )
    .orderBy(desc(auditLogs.createdAt))
    .limit(200);
}

// The inline edit popups on the statement (PartyLedgerDialog) open the same forms
// the Payments and Stock Purchase pages do, so they need the same option sets.
// This bundles both in one call — the payment set is fetched inline below because
// it isn't exposed as a single getter — so a ref click costs one round trip rather
// than six. Reuses the existing cached lookups, so nothing is re-read.
export async function getLedgerInlineOptions(): Promise<{
  paymentOptions: {
    companyOptions: { id: string; name: string }[];
    contactOptions: { id: string; name: string; companyId: string }[];
    bankAccountOptions: { id: string; name: string; companyId: string | null }[];
    cashAccountOptions: { id: string; name: string; companyId: string | null; isDefault: boolean }[];
    chequeOptions: { id: string; name: string; companyId: string | null }[];
  };
  purchaseOptions: Awaited<ReturnType<typeof getPurchaseFormOptions>>;
}> {
  const session = await getSession();
  requirePermission(session, "accounts", "view");

  const [companyRows, contactRows, bank, cash, cheques, purchase] = await Promise.all([
    getCompanies(),
    getContactOptions(),
    getBankAccountOptions(),
    getCashAccountOptions(),
    getAvailableCheques(),
    getPurchaseFormOptions(),
  ]);

  return {
    paymentOptions: {
      companyOptions: companyRows.map((c) => ({ id: c.id, name: c.name })),
      contactOptions: contactRows.map((c) => ({ id: c.id, name: c.displayName, companyId: c.companyId ?? "" })),
      bankAccountOptions: bank,
      cashAccountOptions: cash,
      chequeOptions: cheques,
    },
    purchaseOptions: purchase,
  };
}
