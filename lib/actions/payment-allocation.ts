import "server-only";

import { sql } from "drizzle-orm";
import { db } from "@/lib/db";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const uuidList = (ids: string[]) => sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `);

// FIFO in one set operation, including payment batches. Payments and invoices
// are ranges on a running balance per company/contact/direction; their overlap
// is the exact amount one settles against the other. Rows are locked before the
// ranges are calculated so two simultaneous receipts cannot claim the same
// invoice balance.
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
             CASE WHEN p.code = 'PAYMENT_RECEIVED' THEN 'SALES_INVOICE'::document_type_code
                  ELSE 'PURCHASE_INVOICE'::document_type_code END AS invoice_code,
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
      SELECT d.id, d.company_id, d.contact_id, dt.code,
             greatest(d.grand_total - d.paid_amount, 0) AS balance,
             d.document_date, d.created_at
      FROM documents d
      JOIN document_types dt ON dt.id = d.document_type_id
      WHERE d.status = 'posted'
        AND dt.code IN ('SALES_INVOICE', 'PURCHASE_INVOICE')
        AND d.grand_total > d.paid_amount
        AND EXISTS (
          SELECT 1 FROM selected_payments p
          WHERE p.company_id = d.company_id AND p.contact_id = d.contact_id
            AND ((p.code = 'PAYMENT_RECEIVED' AND dt.code = 'SALES_INVOICE')
              OR (p.code = 'PAYMENT_MADE' AND dt.code = 'PURCHASE_INVOICE'))
        )
      FOR UPDATE OF d
    ), invoice_rows AS (
      SELECT i.*,
             coalesce(sum(i.balance) OVER (
               PARTITION BY i.company_id, i.contact_id, i.code
               ORDER BY i.document_date, i.created_at, i.id
               ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
             ), 0) AS range_start,
             sum(i.balance) OVER (
               PARTITION BY i.company_id, i.contact_id, i.code
               ORDER BY i.document_date, i.created_at, i.id
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
       AND i.code = p.invoice_code
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
