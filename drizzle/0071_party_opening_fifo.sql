-- Contact-linked legacy journal rows are opening-balance entries in the party
-- ledger. They share FIFO with sales/purchases according to their debit/credit
-- side. Rebuild every allocation once so existing advances and balances adopt
-- the same rule immediately.

UPDATE document_types
SET name = 'Opening Balance'
WHERE code = 'JOURNAL_ENTRY'
  AND name = 'Journal Entry';

WITH removed AS MATERIALIZED (
  DELETE FROM payment_allocations
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
SELECT count(*) FROM updated;

WITH payments AS MATERIALIZED (
  SELECT d.id, d.company_id, d.contact_id, d.grand_total AS amount,
         dt.code, d.document_date, d.created_at
  FROM documents d
  JOIN document_types dt ON dt.id = d.document_type_id
  WHERE dt.code IN ('PAYMENT_RECEIVED', 'PAYMENT_MADE')
    AND d.contact_id IS NOT NULL
    AND d.status = 'posted'
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
  FROM payments p
), items AS MATERIALIZED (
  SELECT d.id, d.company_id, d.contact_id,
         (CASE
            WHEN dt.code = 'SALES_INVOICE' THEN 'PAYMENT_RECEIVED'
            WHEN dt.code = 'PURCHASE_INVOICE' THEN 'PAYMENT_MADE'
            WHEN coalesce(party_entry.debit, 0) > 0 THEN 'PAYMENT_RECEIVED'
            ELSE 'PAYMENT_MADE'
          END)::document_type_code AS queue,
         (dt.code = 'OPENING_BALANCE') AS is_opening,
         greatest(d.grand_total - d.paid_amount, 0) AS balance,
         d.document_date, d.created_at
  FROM documents d
  JOIN document_types dt ON dt.id = d.document_type_id
  LEFT JOIN ledger_entries party_entry
    ON party_entry.document_id = d.id
   AND dt.code IN ('OPENING_BALANCE', 'JOURNAL_ENTRY')
  WHERE d.status = 'posted'
    AND d.contact_id IS NOT NULL
    AND dt.code IN ('SALES_INVOICE', 'PURCHASE_INVOICE', 'OPENING_BALANCE', 'JOURNAL_ENTRY')
    AND d.grand_total > d.paid_amount
), item_rows AS (
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
  FROM items i
), inserted AS (
  INSERT INTO payment_allocations
    (company_id, payment_document_id, invoice_document_id, amount)
  SELECT p.company_id, p.id, i.id,
         round(least(p.range_end, i.range_end) - greatest(p.range_start, i.range_start), 2)
  FROM payment_rows p
  JOIN item_rows i
    ON i.company_id = p.company_id
   AND i.contact_id = p.contact_id
   AND i.queue = p.code
   AND least(p.range_end, i.range_end) > greatest(p.range_start, i.range_start)
  RETURNING invoice_document_id, amount
), allocated AS (
  SELECT invoice_document_id, sum(amount) AS amount
  FROM inserted
  GROUP BY invoice_document_id
)
UPDATE documents d
SET paid_amount = least(d.grand_total, d.paid_amount + allocated.amount),
    is_paid = d.paid_amount + allocated.amount >= d.grand_total,
    updated_at = now()
FROM allocated
WHERE d.id = allocated.invoice_document_id;
