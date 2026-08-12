-- document_number_ledger (added in 0015) was never backfilled with numbers
-- issued before it existed, so nextDocumentNumber() undercounts and reissues
-- already-used numbers (unique constraint violation on the next create).
INSERT INTO document_number_ledger (company_id, document_type_id, number, document_id)
SELECT d.company_id, d.document_type_id, d.number, d.id
FROM documents d
WHERE NOT EXISTS (
  SELECT 1 FROM document_number_ledger l
  WHERE l.company_id = d.company_id
    AND l.document_type_id = d.document_type_id
    AND l.number = d.number
);
