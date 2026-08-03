-- Transfers (and adjustments) used to write inventory_transactions with no cost
-- at all. Stock valuation is cost/quantity per location, so a location that only
-- ever received transfers held real quantity at an average cost of zero — the
-- Stock page showed the goods with a valuation of 0.00, while the location they
-- came from kept the whole cost basis with nothing left on hand.
--
-- The write paths now stamp the source location's average cost on both sides
-- (lib/queries/stock-cost.ts). This fixes the rows already recorded, valuing them
-- at the item's average cost across its priced inflows — purchases are the only
-- movements that carry a real price, so they're the only input.
--
-- Idempotent: only rows still missing a cost are touched.
WITH avg_cost AS (
    SELECT dl.item_id, sum(it.total_cost) / nullif(sum(it.base_quantity), 0) AS unit_cost
    FROM inventory_transactions it
    JOIN document_lines dl ON dl.id = it.document_line_id
    WHERE it.movement = 1 AND it.total_cost IS NOT NULL
    GROUP BY dl.item_id
)
UPDATE inventory_transactions it
SET unit_cost = a.unit_cost,
    total_cost = a.unit_cost * it.base_quantity
FROM document_lines dl, avg_cost a
WHERE dl.id = it.document_line_id
  AND a.item_id = dl.item_id
  AND a.unit_cost IS NOT NULL
  AND it.total_cost IS NULL;
