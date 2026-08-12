-- Payments received never wrote a ledger entry. The rule was that a payment
-- books the opposite side of whatever raised it, but only the "made" direction
-- was implemented — the comment in payments.ts said sales/AR wasn't wired up,
-- which stopped being true once sales started posting their own debit. So every
-- receipt taken to date settled a cash or bank balance and left what the
-- customer owed us exactly where it was.
--
-- One credit per payment received that has none yet. NOT EXISTS makes it
-- idempotent, and keeps it off the receipts the app has already written an entry
-- for. Same shape as 0039, which filled the matching hole on the sales side.
--
-- contact_id IS NOT NULL because a ledger balance belongs to somebody: a receipt
-- booked against no contact has no account to credit. grand_total > 0 because
-- ledger_entries_debit_credit_check requires one side strictly above zero.
INSERT INTO ledger_entries (company_id, document_id, debit, credit)
SELECT d.company_id, d.id, 0, d.grand_total
FROM documents d
JOIN document_types dt ON dt.id = d.document_type_id
WHERE dt.code = 'PAYMENT_RECEIVED'
  AND d.contact_id IS NOT NULL
  AND d.grand_total > 0
  AND NOT EXISTS (SELECT 1 FROM ledger_entries l WHERE l.document_id = d.id);
