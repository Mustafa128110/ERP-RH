-- Sales only started writing their outstanding balance to ledger_entries once
-- part payment landed, so every sale entered before that has a balance owing and
-- no ledger row to show it — the customer is simply missing from the ledger.
--
-- One debit per sale that still has something owed and no entry yet. The NOT
-- EXISTS makes it idempotent: re-running adds nothing, and it can't double up on
-- a sale whose row the app has since written.
INSERT INTO ledger_entries (company_id, document_id, debit, credit)
SELECT d.company_id, d.id, d.grand_total - d.paid_amount, 0
FROM documents d
JOIN document_types dt ON dt.id = d.document_type_id
WHERE dt.code = 'SALES_INVOICE'
  AND d.grand_total - d.paid_amount > 0
  AND NOT EXISTS (SELECT 1 FROM ledger_entries l WHERE l.document_id = d.id);
