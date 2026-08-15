"use server";

import { and, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { ledgerEntries, documents, documentTypes, documentNumberLedger, contacts, companies } from "@/lib/db/schema";
import { getSession } from "@/lib/auth/session";
import { requirePermission } from "@/lib/auth/permissions";
import { companyInScope } from "@/lib/auth/scope";
import { CACHE, invalidateLookups } from "@/lib/queries/lookups";
import { ensureDocumentType, nextDocumentNumber } from "@/lib/actions/document-numbering";
import { resolveContactId } from "@/lib/actions/resolve-refs";
import { guard, DUPLICATE, type ActionResult } from "@/lib/actions/guard";
import { claimOperation, readOperationId, DuplicateOperationError } from "@/lib/actions/operation-id";
import { recordAudit } from "@/lib/actions/audit";

export interface ContactPayment {
  date: string;
  number: string;
  amount: string;
  direction: "made" | "received";
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
}

// Ledger entries carry no contactId directly — they hang off the document,
// which carries the contact, so a sale's balance shows up under the customer's
// name for free.
//
// Credit = money owed to the contact (an unpaid purchase). Debit = the other
// direction: money paid back out, or what a customer still owes on a part-paid
// sale. balance = credit - debit, so a positive balance is a payable and a
// negative one is a receivable.
export async function listLedgerBalances(): Promise<ContactLedgerBalance[]> {
  const session = await getSession();
  requirePermission(session, "purchases", "view");

  // Neither query depends on the other's rows, so they share one round trip.
  const [rows, paymentRows] = await Promise.all([
    db
      .select({
        contactId: contacts.id,
        displayName: contacts.displayName,
        companyId: ledgerEntries.companyId,
        company: companies.name,
        credit: ledgerEntries.credit,
        debit: ledgerEntries.debit,
      })
      .from(ledgerEntries)
      .innerJoin(documents, eq(documents.id, ledgerEntries.documentId))
      .innerJoin(companies, eq(companies.id, ledgerEntries.companyId))
      .leftJoin(contacts, eq(contacts.id, documents.contactId))
      // This used to read every company's entries regardless of who was signed in
      // or what the topbar was set to — the only list in the app that didn't scope.
      .where(await companyInScope(ledgerEntries.companyId)),

    // Every payment against a contact, newest first — sliced to five per contact
    // below. Both directions: a contact can be owed money on one invoice and owe
    // it on another, and "what has moved between us lately" is the question.
    db
      .select({
        companyId: documents.companyId,
        contactId: documents.contactId,
        date: documents.documentDate,
        number: documents.number,
        amount: documents.grandTotal,
        code: documentTypes.code,
      })
      .from(documents)
      .innerJoin(documentTypes, eq(documentTypes.id, documents.documentTypeId))
      .where(
        and(
          inArray(documentTypes.code, ["PAYMENT_MADE", "PAYMENT_RECEIVED"]),
          isNotNull(documents.contactId),
          await companyInScope(documents.companyId),
        ),
      )
      .orderBy(desc(documents.documentDate), desc(documents.createdAt)),
  ]);

  const paymentsByContact = new Map<string, ContactPayment[]>();
  for (const p of paymentRows) {
    const key = `${p.companyId}:${p.contactId}`;
    const list = paymentsByContact.get(key) ?? [];
    if (list.length < 5) {
      list.push({
        date: p.date,
        number: p.number,
        amount: p.amount,
        direction: p.code === "PAYMENT_MADE" ? "made" : "received",
      });
    }
    paymentsByContact.set(key, list);
  }

  // Keyed by company as well as contact: a contact belongs to one company, but
  // the same supplier is often set up in both, and their balances are separate
  // sets of books that must not be summed into one row.
  const byContact = new Map<string, ContactLedgerBalance>();
  for (const r of rows) {
    const key = `${r.companyId}:${r.contactId ?? "unknown"}`;
    const entry = byContact.get(key) ?? {
      contactId: r.contactId ?? "unknown",
      displayName: r.displayName ?? "Unknown Contact",
      companyId: r.companyId,
      company: r.company,
      credit: 0,
      debit: 0,
      balance: 0,
      recentPayments: paymentsByContact.get(key) ?? [],
    };
    entry.credit += Number(r.credit ?? 0);
    entry.debit += Number(r.debit ?? 0);
    byContact.set(key, entry);
  }

  // A-Z by contact. Sorted by balance before, which made a name impossible to
  // find without scanning the whole list — the balance is what you read once
  // you're on the row, not how you get to it.
  return Array.from(byContact.values())
    .map((e) => ({ ...e, balance: e.credit - e.debit }))
    .sort((a, b) => a.displayName.localeCompare(b.displayName) || a.company.localeCompare(b.company));
}

// A balance that didn't come from a sale or a purchase — an opening balance
// carried over from the old books, a correction, a settlement agreed off-invoice.
//
// ledger_entries.document_id is NOT NULL: every entry hangs off a document, which
// is where its contact and date come from. So a manual entry is a JOURNAL_ENTRY
// document (the universal model already has the type and the JE series) plus its
// one ledger row — no schema change, and it shows up wherever documents do.
// Shared by both writers. Only the fields both of them post are validated here —
// editing a contact's balance identifies the company and the contact by the row
// that was clicked, not by form fields, so those two are checked by
// createLedgerEntry, which is the only caller that actually collects them.
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

// Writes one journal entry: the document, its single ledger row, and the number.
// `signedAmount` follows the balance convention — positive is a credit (we owe
// the contact), negative a debit (they owe us) — so a caller that computed a
// difference can hand it straight over without re-deciding which column it is.
//
// Shared by "+ Add Entry" and by saving a contact's balance.
async function writeJournalEntry(
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
    name: "Journal Entry",
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
        ? { companyId: input.companyId, documentId: doc.id, credit: magnitude }
        : { companyId: input.companyId, documentId: doc.id, debit: magnitude },
    );

    await tx.insert(documentNumberLedger).values({ companyId: input.companyId, documentTypeId: documentType.id, number, documentId: doc.id });
  });
}

export async function createLedgerEntry(_prevState: ActionResult | undefined, formData: FormData): Promise<ActionResult> {
  return guard(
    "Couldn't add the ledger entry.",
    async () => {
      const session = await getSession();
      // There is no `ledger` module in the permission catalog and no ledger.create.
      // accounts.create is the nearest finance-write permission — Admin holds it,
      // Salesman doesn't, which is the intended split.
      requirePermission(session, "accounts", "create");

      const { companyId, documentDate, contactId, contactName, direction, amount, note, error } = readEntryForm(formData);
      if (!companyId) return { error: "Company is required." };
      if (!contactId && !contactName) return { error: "Pick a contact or type a new name." };
      if (error) return { error };

      await writeJournalEntry(
        {
          companyId,
          documentDate,
          contactId: contactId || null,
          contactName: contactName || null,
          signedAmount: direction === "we_owe" ? amount : -amount,
          note,
          userId: session.userId,
        },
        readOperationId(formData),
      );

      // A typed-in contact is a new contact.
      invalidateLookups(CACHE.documentTypes, CACHE.contacts, CACHE.cheques);
      revalidatePath("/ledger");
      await recordAudit({ action: "create", entity: "ledger entry", summary: contactName || contactId, companyId, detail: `${direction} ${amount}${note ? ` — ${note}` : ""}` });
      return { success: true };
    },
    { [DUPLICATE]: "Can't add — a journal entry number is already in use for this company." },
  );
}

// Saving a contact's row from the ledger table. The balance shown is the sum of
// everything on that contact's books — sales, purchases, payments, earlier
// journal entries — so it can't be "updated" in place; there is no single row
// holding it.
//
// What's saved instead is the difference: whatever number is typed becomes the
// balance, by posting one journal entry for the gap. Nothing already recorded is
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
      const session = await getSession();
      requirePermission(session, "accounts", "create");

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

      const current = Number(totals?.credit ?? 0) - Number(totals?.debit ?? 0);
      const desired = direction === "we_owe" ? amount : -amount;
      const delta = Number((desired - current).toFixed(2));
      // Saving without changing the number is not an error, it just has nothing
      // to post — and a zero-value ledger row would fail the table's CHECK anyway.
      if (delta === 0) return { success: true };

      await writeJournalEntry(
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

      invalidateLookups(CACHE.documentTypes, CACHE.cheques);
      revalidatePath("/ledger");
      return { success: true };
    },
    { [DUPLICATE]: "Can't save — a journal entry number is already in use for this company." },
  );
}
