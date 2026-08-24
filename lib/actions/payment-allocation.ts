import "server-only";

import { sql } from "drizzle-orm";
import { db } from "@/lib/db";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const uuidList = (ids: string[]) => sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `);

// FIFO in one set operation, including payment batches. Payments and the items
// they settle are ranges on a running balance per company/contact/queue; their
// overlap is the exact amount one settles against the other. Rows are locked
// before the ranges are calculated so two simultaneous receipts cannot claim the
// same invoice balance.
//
// "Queue" rather than "invoice type" because a party's opening balance settles
// too, and which of the two queues it belongs to depends on its sign, not on its
// document type: a positive opening balance is a receivable and is settled by
// receipts, a negative one is a payable settled by payments out. It is always
// the oldest item in whichever queue it joins, ahead of every real invoice
// regardless of the date on it.
export async function allocatePaymentsFifo(tx: Tx, paymentDocumentIds: string[]): Promise<{ allocated: number; allocations: number }> {
  const ids = [...new Set(paymentDocumentIds)];
  if (ids.length === 0) return { allocated: 0, allocations: 0 };

  const [result] = await tx.execute<{ allocated: string; allocations: number }>(sql`
    WITH selected_payments AS MATERIALIZED (
      SELECT d.id, d.company_id, d.contact_id, d.grand_total AS amount,
             dt.code, d.document_date, d.created_at
      FROM documents d
      JOIN document_types dt ON dt.id = d.document_type_id
      WHERE d.id IN (${uuidList(ids)})
        AND dt.code IN ('PAYMENT_RECEIVED', 'PAYMENT_MADE')
        AND d.contact_id IS NOT NULL AND d.status = 'posted'
      FOR UPDATE OF d
    ), payment_rows AS (
      SELECT p.*,
             coalesce(sum(p.amount) OVER (
               PARTITION BY p.company_id, p.contact_id, p.code
               ORDER BY p.document_date, p.created_at, p.id
               ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
             ), 0) AS range_start,
             sum(p.amount) OVER (
               PARTITION BY p.company_id, p.contact_id, p.code
               ORDER BY p.document_date, p.created_at, p.id
             ) AS range_end
      FROM selected_payments p
    ), invoice_locked AS MATERIALIZED (
      -- The opening balance's direction is the side its single ledger row sits
      -- on: debit means the party owes us. Read from ledger_entries rather than
      -- copied onto the document, so the figure and its sign cannot disagree.
      -- The join is LEFT and predicated on the code, so it costs nothing for the
      -- invoices, which know their queue from their type.
      SELECT d.id, d.company_id, d.contact_id,
             (CASE
                WHEN dt.code = 'SALES_INVOICE' THEN 'PAYMENT_RECEIVED'
                WHEN dt.code = 'PURCHASE_INVOICE' THEN 'PAYMENT_MADE'
                WHEN coalesce(ob.debit, 0) > 0 THEN 'PAYMENT_RECEIVED'
                ELSE 'PAYMENT_MADE'
              END)::document_type_code AS queue,
             (dt.code = 'OPENING_BALANCE') AS is_opening,
             greatest(d.grand_total - d.paid_amount, 0) AS balance,
             d.document_date, d.created_at
      FROM documents d
      JOIN document_types dt ON dt.id = d.document_type_id
      LEFT JOIN ledger_entries ob ON ob.document_id = d.id AND dt.code = 'OPENING_BALANCE'
      WHERE d.status = 'posted'
        AND dt.code IN ('SALES_INVOICE', 'PURCHASE_INVOICE', 'OPENING_BALANCE')
        AND d.grand_total > d.paid_amount
        -- Company and contact only: the queue is computed above, so it cannot be
        -- tested here. Locking the party's other side as well is a few extra
        -- rows and keeps one party's whole account consistent under concurrency.
        AND EXISTS (
          SELECT 1 FROM selected_payments p
          WHERE p.company_id = d.company_id AND p.contact_id = d.contact_id
        )
      FOR UPDATE OF d
    ), invoice_rows AS (
      SELECT i.*,
             coalesce(sum(i.balance) OVER (
               PARTITION BY i.company_id, i.contact_id, i.queue
               ORDER BY i.is_opening DESC, i.document_date, i.created_at, i.id
               ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
             ), 0) AS range_start,
             sum(i.balance) OVER (
               PARTITION BY i.company_id, i.contact_id, i.queue
               ORDER BY i.is_opening DESC, i.document_date, i.created_at, i.id
             ) AS range_end
      FROM invoice_locked i
    ), inserted AS (
      INSERT INTO payment_allocations (company_id, payment_document_id, invoice_document_id, amount)
      SELECT p.company_id, p.id, i.id,
             round(least(p.range_end, i.range_end) - greatest(p.range_start, i.range_start), 2)
      FROM payment_rows p
      JOIN invoice_rows i
        ON i.company_id = p.company_id
       AND i.contact_id = p.contact_id
       AND i.queue = p.code
       AND least(p.range_end, i.range_end) > greatest(p.range_start, i.range_start)
      ON CONFLICT (payment_document_id, invoice_document_id)
      DO UPDATE SET amount = excluded.amount
      RETURNING invoice_document_id, amount
    ), allocated AS (
      SELECT invoice_document_id, sum(amount) AS amount
      FROM inserted
      GROUP BY invoice_document_id
    ), updated AS (
      UPDATE documents d
      SET paid_amount = least(d.grand_total, d.paid_amount + allocated.amount),
          is_paid = d.paid_amount + allocated.amount >= d.grand_total,
          updated_at = now()
      FROM allocated
      WHERE d.id = allocated.invoice_document_id
      RETURNING d.id
    )
    SELECT coalesce(sum(amount), 0) AS allocated, count(*)::int AS allocations
    FROM inserted
  `);
  return { allocated: Number(result?.allocated ?? 0), allocations: Number(result?.allocations ?? 0) };
}

// Editing/cancelling a payment first returns every allocation to its invoice.
// Deleting and updating happen in one statement so there is no moment inside
// the transaction where an allocation exists but the invoice balance disagrees.
export async function releasePaymentAllocations(tx: Tx, paymentDocumentIds: string[]): Promise<number> {
  const ids = [...new Set(paymentDocumentIds)];
  if (ids.length === 0) return 0;
  const [result] = await tx.execute<{ released: string }>(sql`
    WITH removed AS (
      DELETE FROM payment_allocations
      WHERE payment_document_id IN (${uuidList(ids)})
      RETURNING invoice_document_id, amount
    ), released AS (
      SELECT invoice_document_id, sum(amount) AS amount
      FROM removed
      GROUP BY invoice_document_id
    ), updated AS (
      UPDATE documents d
      SET paid_amount = greatest(0, d.paid_amount - released.amount),
          is_paid = greatest(0, d.paid_amount - released.amount) >= d.grand_total,
          updated_at = now()
      FROM released
      WHERE d.id = released.invoice_document_id
      RETURNING d.id
    )
    SELECT coalesce(sum(amount), 0) AS released FROM removed
  `);
  return Number(result?.released ?? 0);
}

// The mirror of the above, keyed on the invoice rather than the payment: what an
// invoice about to be edited or cancelled must give back before anything else
// touches it.
//
// Order matters at the call sites. An invoice's paid_amount is the sum of what
// was taken at the counter and what FIFO allocated to it, and only the counter
// part belongs to the invoice's own bank or cash account. Releasing first is what
// leaves `paid_amount - released` as the figure a cancellation should refund —
// refunding the whole of paid_amount would hand back money that arrived through
// separate, still-posted payment documents.
//
// Returns the payments freed as well as the total, so the audit entry can name
// them.
export async function releaseInvoiceAllocations(
  tx: Tx,
  invoiceDocumentIds: string[],
): Promise<{ released: number; paymentIds: string[] }> {
  const ids = [...new Set(invoiceDocumentIds)];
  if (ids.length === 0) return { released: 0, paymentIds: [] };
  const [result] = await tx.execute<{ released: string; payment_ids: string[] }>(sql`
    WITH removed AS (
      DELETE FROM payment_allocations
      WHERE invoice_document_id IN (${uuidList(ids)})
      RETURNING invoice_document_id, payment_document_id, amount
    ), released AS (
      SELECT invoice_document_id, sum(amount) AS amount
      FROM removed
      GROUP BY invoice_document_id
    ), updated AS (
      UPDATE documents d
      SET paid_amount = greatest(0, d.paid_amount - released.amount),
          is_paid = greatest(0, d.paid_amount - released.amount) >= d.grand_total,
          updated_at = now()
      FROM released
      WHERE d.id = released.invoice_document_id
      RETURNING d.id
    )
    SELECT coalesce(sum(amount), 0) AS released,
           coalesce(array_agg(DISTINCT payment_document_id::text), '{}') AS payment_ids
    FROM removed
  `);
  return { released: Number(result?.released ?? 0), paymentIds: result?.payment_ids ?? [] };
}

// An edit or cancellation can open an older invoice after later payments have
// already been assigned. Rebuild the whole contact/direction chain so the
// oldest invoice is always settled first, not merely the invoice that happened
// to be open when the most recent payment was posted.
export async function reallocateAccountPaymentsFifo(
  tx: Tx,
  companyId: string,
  contactId: string | null,
  paymentCode: "PAYMENT_RECEIVED" | "PAYMENT_MADE",
): Promise<void> {
  if (!contactId) return;
  const payments = await tx.execute<{ id: string }>(sql`
    SELECT d.id
    FROM documents d
    JOIN document_types dt ON dt.id = d.document_type_id
    WHERE d.company_id = ${companyId}::uuid
      AND d.contact_id = ${contactId}::uuid
      AND d.status = 'posted'
      AND dt.code = ${paymentCode}::document_type_code
    ORDER BY d.document_date, d.created_at, d.id
    FOR UPDATE OF d
  `);
  const ids = payments.map((payment) => payment.id);
  await releasePaymentAllocations(tx, ids);
  await allocatePaymentsFifo(tx, ids);
}

// The recompute the party statement is specified in terms of: after any change
// to an opening balance, invoice, payment or journal entry, settlement for that
// party is rebuilt from scratch in date order rather than patched incrementally.
//
// Both queues, because one change can move both: flipping the sign of an opening
// balance takes it out of the receivable queue and puts it in the payable one, and
// a contact that is both customer and vendor has invoices on each side.
//
// Two statements per side, four round trips for the whole party — the cost of a
// recompute, not of a row (AGENTS.md: no loops of statements in a transaction).
export async function recomputeParty(tx: Tx, companyId: string, contactId: string | null): Promise<void> {
  if (!contactId) return;
  await reallocateAccountPaymentsFifo(tx, companyId, contactId, "PAYMENT_RECEIVED");
  await reallocateAccountPaymentsFifo(tx, companyId, contactId, "PAYMENT_MADE");
}
