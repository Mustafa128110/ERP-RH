import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  codeToLedgerType,
  openingQueueSide,
  type FifoAllocation,
  type LedgerEntryType,
  type SettlementSnapshot,
  type SettleableItem,
  type SettlingPayment,
} from "@/lib/ledger-constants";

// Reads where one party's settlement stands, in the shape the FIFO engine in
// lib/ledger-constants.ts takes.
//
// Split out of lib/actions/ledger.ts for the reason lib/queries/reports.ts is:
// that file is "use server", so every export becomes an HTTP endpoint. Nothing
// here reads a session — the caller resolves the company scope first — which is
// also what lets lib/queries/party-ledger.check.ts run these statements against
// a real database without a login.

type Runner = Pick<typeof db, "execute">;

// One document on the party's account, with enough on it to name in a
// confirmation dialog.
export type SettlementDocument = {
  id: string;
  code: string;
  type: LedgerEntryType;
  number: string;
  date: string;
  grandTotal: number;
  // Money settled *outside* the FIFO queues: taken at the counter when the
  // document was raised. It is never offered to the queue, so an invoice with a
  // part payment at the till only queues its remainder.
  tillPaid: number;
  // Currently allocated by FIFO — against this invoice, or out of this payment.
  allocated: number;
};

export type PartySettlement = SettlementSnapshot & {
  items: SettleableItem[];
  payments: SettlingPayment[];
  allocations: FifoAllocation[];
  documents: SettlementDocument[];
  // The opening balance document, when the party has one.
  openingDocumentId: string | null;
  // Signed the way the statement reads it: positive means the party owes us.
  openingSigned: number;
};

type Row = {
  id: string;
  code: string;
  number: string;
  date: string;
  created_at: string;
  grand_total: number;
  paid_amount: number;
  entry_debit: number;
  entry_credit: number;
  allocated: number;
};

const ITEM_SIDE = { SALES_INVOICE: "receivable", PURCHASE_INVOICE: "payable" } as const;
const PAYMENT_SIDE = { PAYMENT_RECEIVED: "receivable", PAYMENT_MADE: "payable" } as const;

export async function readPartySettlement(
  runner: Runner,
  companyId: string,
  contactId: string,
): Promise<PartySettlement> {
  // Two statements, not one per document: this runs inside the same transaction
  // as the write that follows it, where every round trip is ~170ms.
  const rows = await runner.execute<Row>(sql`
    SELECT d.id::text AS id,
           dt.code::text AS code,
           d.number,
           d.document_date::text AS date,
           d.created_at::text AS created_at,
           d.grand_total::float8 AS grand_total,
           d.paid_amount::float8 AS paid_amount,
           coalesce(party_entry.debit, 0)::float8 AS entry_debit,
           coalesce(party_entry.credit, 0)::float8 AS entry_credit,
           a.amount::float8 AS allocated
    FROM documents d
    JOIN document_types dt ON dt.id = d.document_type_id
    LEFT JOIN bank_accounts b ON b.id = d.bank_account_id
    LEFT JOIN cash_accounts c ON c.id = d.cash_account_id
    LEFT JOIN ledger_entries party_entry
      ON party_entry.document_id = d.id
     AND dt.code IN ('OPENING_BALANCE', 'JOURNAL_ENTRY')
    -- Two index lookups rather than one OR: a document is either a payment or an
    -- invoice, never both, so summing across both columns cannot double count.
    LEFT JOIN LATERAL (
      SELECT coalesce(sum(amount), 0) AS amount FROM (
        SELECT pa.amount FROM payment_allocations pa WHERE pa.invoice_document_id = d.id
        UNION ALL
        SELECT pa.amount FROM payment_allocations pa WHERE pa.payment_document_id = d.id
      ) both_sides
    ) a ON true
    WHERE d.company_id = ${companyId}::uuid
      AND d.contact_id = ${contactId}::uuid
      AND d.status = 'posted'
      AND dt.code IN ('SALES_INVOICE', 'PURCHASE_INVOICE', 'OPENING_BALANCE', 'JOURNAL_ENTRY', 'PAYMENT_RECEIVED', 'PAYMENT_MADE')
      AND (
        dt.code NOT IN ('PAYMENT_RECEIVED', 'PAYMENT_MADE')
        OR (d.bank_account_id IS NOT NULL AND (b.company_id IS NULL OR b.company_id = d.company_id))
        OR (d.cash_account_id IS NOT NULL AND c.company_id = d.company_id)
        OR (d.bank_account_id IS NULL AND d.cash_account_id IS NULL AND EXISTS (
          SELECT 1 FROM cheque_register q
          WHERE q.document_id = d.id AND q.company_id = d.company_id
        ))
      )
    ORDER BY d.document_date, d.created_at, d.id
  `);

  const allocationRows = await runner.execute<{ payment_id: string; item_id: string; amount: number }>(sql`
    SELECT pa.payment_document_id::text AS payment_id,
           pa.invoice_document_id::text AS item_id,
           pa.amount::float8 AS amount
    FROM payment_allocations pa
    JOIN documents pd ON pd.id = pa.payment_document_id
    WHERE pd.company_id = ${companyId}::uuid
      AND pd.contact_id = ${contactId}::uuid
  `);

  const items: SettleableItem[] = [];
  const payments: SettlingPayment[] = [];
  const documents: SettlementDocument[] = [];
  let openingDocumentId: string | null = null;
  let openingSigned = 0;

  for (const row of rows) {
    const grandTotal = Number(row.grand_total ?? 0);
    const allocated = Number(row.allocated ?? 0);
    // What was settled at the counter is the paid amount less whatever FIFO has
    // claimed. Floored at zero: a stale paid_amount must not invent a credit.
    const tillPaid = Math.max(0, Number(row.paid_amount ?? 0) - allocated);
    const type = codeToLedgerType(row.code);
    documents.push({ id: row.id, code: row.code, type, number: row.number, date: row.date, grandTotal, tillPaid, allocated });

    const paymentSide = PAYMENT_SIDE[row.code as keyof typeof PAYMENT_SIDE];
    if (paymentSide) {
      payments.push({ id: row.id, side: paymentSide, amount: grandTotal, date: row.date, createdAt: row.created_at });
      continue;
    }

    if (row.code === "OPENING_BALANCE") {
      // The sign lives on the ledger row, not on the document, so the figure and
      // its direction cannot drift apart.
      openingDocumentId = row.id;
      openingSigned = Number(row.entry_debit ?? 0) - Number(row.entry_credit ?? 0);
      const side = openingQueueSide(openingSigned);
      if (side) {
        items.push({
          id: row.id,
          side,
          amount: Math.abs(openingSigned),
          date: row.date,
          createdAt: row.created_at,
          isOpening: true,
        });
      }
      continue;
    }

    if (row.code === "JOURNAL_ENTRY") {
      const signed = Number(row.entry_debit ?? 0) - Number(row.entry_credit ?? 0);
      const side = openingQueueSide(signed);
      if (side) {
        items.push({
          id: row.id,
          side,
          amount: Math.max(0, grandTotal - tillPaid),
          date: row.date,
          createdAt: row.created_at,
        });
      }
      continue;
    }

    const itemSide = ITEM_SIDE[row.code as keyof typeof ITEM_SIDE];
    if (!itemSide) continue;
    items.push({
      id: row.id,
      side: itemSide,
      amount: Math.max(0, grandTotal - tillPaid),
      date: row.date,
      createdAt: row.created_at,
    });
  }

  const allocations = allocationRows.map((a) => ({
    paymentId: a.payment_id,
    itemId: a.item_id,
    amount: Number(a.amount ?? 0),
  }));

  return { items, payments, allocations, documents, openingDocumentId, openingSigned };
}

// The queue-facing value of an item after its grand total is edited: the queue
// only ever sees what was not already taken at the counter.
export function settleableAfterEdit(doc: SettlementDocument, newGrandTotal: number): number {
  return Math.max(0, newGrandTotal - doc.tillPaid);
}
