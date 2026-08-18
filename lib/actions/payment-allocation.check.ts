import "server-only";
import assert from "node:assert/strict";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";

async function main() {
  const [integrity] = await db.execute<{
    broken_links: number;
    overpaid_payments: number;
    invoice_mismatches: number;
    total_allocations: number;
    allocated_amount: string;
  }>(sql`
    WITH allocation_totals AS (
      SELECT payment_document_id, sum(amount) AS amount
      FROM payment_allocations
      GROUP BY payment_document_id
    ), invoice_totals AS (
      SELECT invoice_document_id, sum(amount) AS amount
      FROM payment_allocations
      GROUP BY invoice_document_id
    )
    SELECT
      (SELECT count(*)::int
         FROM payment_allocations pa
         JOIN documents p ON p.id = pa.payment_document_id
         JOIN document_types pt ON pt.id = p.document_type_id
         JOIN documents i ON i.id = pa.invoice_document_id
         JOIN document_types it ON it.id = i.document_type_id
        WHERE pa.company_id <> p.company_id OR pa.company_id <> i.company_id
           OR p.contact_id IS DISTINCT FROM i.contact_id
           OR NOT ((pt.code = 'PAYMENT_RECEIVED' AND it.code = 'SALES_INVOICE')
                OR (pt.code = 'PAYMENT_MADE' AND it.code = 'PURCHASE_INVOICE'))) AS broken_links,
      (SELECT count(*)::int
         FROM allocation_totals a JOIN documents p ON p.id = a.payment_document_id
        WHERE a.amount > p.grand_total) AS overpaid_payments,
      (SELECT count(*)::int
         FROM invoice_totals a JOIN documents i ON i.id = a.invoice_document_id
        WHERE a.amount > i.paid_amount) AS invoice_mismatches,
      (SELECT count(*)::int FROM payment_allocations) AS total_allocations,
      (SELECT coalesce(sum(amount), 0) FROM payment_allocations) AS allocated_amount
  `);
  assert.equal(integrity?.broken_links, 0, "allocations must stay in one company/contact and match payment direction");
  assert.equal(integrity?.overpaid_payments, 0, "a payment cannot allocate more than its value");
  assert.equal(integrity?.invoice_mismatches, 0, "allocated value must be reflected in invoice paid_amount");

  const [fifo] = await db.execute<{ violations: number }>(sql`
    SELECT count(*)::int AS violations
    FROM documents older
    JOIN document_types older_type ON older_type.id = older.document_type_id
    WHERE older.status = 'posted'
      AND older_type.code IN ('SALES_INVOICE', 'PURCHASE_INVOICE')
      AND older.grand_total > older.paid_amount
      AND EXISTS (
        SELECT 1
        FROM documents later
        JOIN document_types later_type ON later_type.id = later.document_type_id
        JOIN payment_allocations pa ON pa.invoice_document_id = later.id
        WHERE later.company_id = older.company_id
          AND later.contact_id = older.contact_id
          AND later_type.code = older_type.code
          AND (later.document_date, later.created_at, later.id) > (older.document_date, older.created_at, older.id)
      )
  `);
  assert.equal(fifo?.violations, 0, "a later invoice cannot receive a payment while an older invoice remains open");
  console.log(`payment-allocation checks passed (${integrity?.total_allocations ?? 0} allocation(s), ${integrity?.allocated_amount ?? "0"} settled)`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
