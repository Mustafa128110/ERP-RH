import "server-only";
import assert from "node:assert/strict";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";

async function main() {
  const [integrity] = await db.execute<{
    broken_links: number;
    overpaid_payments: number;
    invoice_mismatches: number;
    opening_entry_mismatches: number;
    invalid_payment_allocations: number;
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
         LEFT JOIN ledger_entries party_entry ON party_entry.document_id = i.id AND it.code IN ('OPENING_BALANCE', 'JOURNAL_ENTRY')
        WHERE pa.company_id <> p.company_id OR pa.company_id <> i.company_id
           OR p.contact_id IS DISTINCT FROM i.contact_id
           OR NOT ((pt.code = 'PAYMENT_RECEIVED' AND it.code = 'SALES_INVOICE')
                OR (pt.code = 'PAYMENT_MADE' AND it.code = 'PURCHASE_INVOICE')
                -- A party's opening balance settles like an invoice does, and
                -- which of the two queues it belongs to comes from the side its
                -- single ledger row sits on rather than from its document type:
                -- debit means the party owes us, so a receipt settles it. Stated
                -- as two explicit arms so an allocation with no ledger row behind
                -- it, or one on the wrong side, is a broken link rather than an
                -- unknown that quietly passes.
                OR (it.code IN ('OPENING_BALANCE', 'JOURNAL_ENTRY') AND pt.code = 'PAYMENT_RECEIVED' AND coalesce(party_entry.debit, 0) > 0)
                OR (it.code IN ('OPENING_BALANCE', 'JOURNAL_ENTRY') AND pt.code = 'PAYMENT_MADE' AND coalesce(party_entry.credit, 0) > 0))) AS broken_links,
      (SELECT count(*)::int
         FROM allocation_totals a JOIN documents p ON p.id = a.payment_document_id
        WHERE a.amount > p.grand_total) AS overpaid_payments,
      (SELECT count(*)::int
         FROM invoice_totals a JOIN documents i ON i.id = a.invoice_document_id
        WHERE a.amount > i.paid_amount) AS invoice_mismatches,
      (SELECT count(*)::int
         FROM documents i
         JOIN document_types it ON it.id = i.document_type_id
         LEFT JOIN invoice_totals a ON a.invoice_document_id = i.id
        WHERE i.status = 'posted'
          AND it.code IN ('OPENING_BALANCE', 'JOURNAL_ENTRY')
          AND i.paid_amount <> coalesce(a.amount, 0)) AS opening_entry_mismatches,
      (SELECT count(*)::int
       FROM payment_allocations pa
       JOIN documents p ON p.id = pa.payment_document_id
       LEFT JOIN bank_accounts b ON b.id = p.bank_account_id
       LEFT JOIN cash_accounts c ON c.id = p.cash_account_id
       WHERE NOT (
         (p.bank_account_id IS NOT NULL AND (b.company_id IS NULL OR b.company_id = p.company_id))
         OR (p.cash_account_id IS NOT NULL AND c.company_id = p.company_id)
         OR (p.bank_account_id IS NULL AND p.cash_account_id IS NULL AND EXISTS (
           SELECT 1 FROM cheque_register q WHERE q.document_id = p.id AND q.company_id = p.company_id
         ))
       )) AS invalid_payment_allocations,
      (SELECT count(*)::int FROM payment_allocations) AS total_allocations,
      (SELECT coalesce(sum(amount), 0) FROM payment_allocations) AS allocated_amount
  `);
  assert.equal(integrity?.broken_links, 0, "allocations must stay in one company/contact and match payment direction");
  assert.equal(integrity?.overpaid_payments, 0, "a payment cannot allocate more than its value");
  assert.equal(integrity?.invoice_mismatches, 0, "allocated value must be reflected in invoice paid_amount");
  assert.equal(integrity?.opening_entry_mismatches, 0, "opening-balance paid_amount must exactly equal its FIFO allocations");
  assert.equal(integrity?.invalid_payment_allocations, 0, "a payment with another company's settlement account must never settle a party item");

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

  // The opening balance is the oldest item in whichever queue it joins — ahead of
  // every real invoice regardless of the date written on it, which is the whole
  // point of it being an opening balance. So nothing on that side may be settled
  // while it is still open. The query above can't see this: it compares document
  // types to group a queue, and an opening balance's type matches neither invoice.
  const [openingFirst] = await db.execute<{ violations: number }>(sql`
    SELECT count(*)::int AS violations
    FROM documents ob
    JOIN document_types obt ON obt.id = ob.document_type_id
    JOIN ledger_entries obl ON obl.document_id = ob.id
    WHERE ob.status = 'posted'
      AND obt.code = 'OPENING_BALANCE'
      AND ob.grand_total > ob.paid_amount
      AND EXISTS (
        SELECT 1
        FROM documents later
        JOIN document_types lt ON lt.id = later.document_type_id
        JOIN payment_allocations pa ON pa.invoice_document_id = later.id
        WHERE later.company_id = ob.company_id
          AND later.contact_id = ob.contact_id
          AND lt.code = (CASE WHEN coalesce(obl.debit, 0) > 0 THEN 'SALES_INVOICE' ELSE 'PURCHASE_INVOICE' END)::document_type_code
      )
  `);
  assert.equal(openingFirst?.violations, 0, "an invoice cannot be settled while the party's opening balance on that side is still open");

  // Purchases/sales and contact-linked legacy opening entries share one FIFO per
  // side. A later purchase cannot hold a payment while an older credit opening
  // remains, and the same rule holds for receivables.
  const [sharedFifo] = await db.execute<{ violations: number }>(sql`
    WITH items AS (
      SELECT d.id, d.company_id, d.contact_id, d.document_date, d.created_at,
             (dt.code = 'OPENING_BALANCE') AS is_opening,
             CASE
               WHEN dt.code = 'SALES_INVOICE' THEN 'receivable'
               WHEN dt.code = 'PURCHASE_INVOICE' THEN 'payable'
               WHEN coalesce(le.debit, 0) > 0 THEN 'receivable'
               ELSE 'payable'
             END AS side,
             d.grand_total - d.paid_amount AS remaining
      FROM documents d
      JOIN document_types dt ON dt.id = d.document_type_id
      LEFT JOIN ledger_entries le
        ON le.document_id = d.id
       AND dt.code IN ('OPENING_BALANCE', 'JOURNAL_ENTRY')
      WHERE d.status = 'posted'
        AND d.contact_id IS NOT NULL
        AND dt.code IN ('SALES_INVOICE', 'PURCHASE_INVOICE', 'OPENING_BALANCE', 'JOURNAL_ENTRY')
    )
    SELECT count(*)::int AS violations
    FROM items older
    WHERE older.remaining > 0
      AND EXISTS (
        SELECT 1
        FROM items later
        JOIN payment_allocations pa ON pa.invoice_document_id = later.id
        WHERE later.company_id = older.company_id
          AND later.contact_id = older.contact_id
          AND later.side = older.side
          AND (
            (older.is_opening AND NOT later.is_opening)
            OR (older.is_opening = later.is_opening
                AND (later.document_date, later.created_at, later.id) > (older.document_date, older.created_at, older.id))
          )
      )
  `);
  assert.equal(sharedFifo?.violations, 0, "purchases/invoices and opening-balance entries must share one chronological FIFO per side");

  console.log(`payment-allocation checks passed (${integrity?.total_allocations ?? 0} allocation(s), ${integrity?.allocated_amount ?? "0"} settled)`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
