-- Purchases never posted inventory movements until now (createStockPurchase
-- gained the insert in this same change), so every pre-existing purchase
-- line is invisible to stock calculations. Backfill one +1 movement per line
-- on an inventory-affecting document type, valued at that line's unit price.
INSERT INTO inventory_transactions (company_id, document_line_id, movement, quantity, base_quantity, unit_cost, total_cost)
SELECT dl.company_id, dl.id, 1, dl.quantity, dl.base_quantity, dl.unit_price, dl.line_total
FROM document_lines dl
JOIN documents d ON d.id = dl.document_id
JOIN document_types dt ON dt.id = d.document_type_id
WHERE dt.affects_inventory = true
  AND NOT EXISTS (
    SELECT 1 FROM inventory_transactions it WHERE it.document_line_id = dl.id
  );
