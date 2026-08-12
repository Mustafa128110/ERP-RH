-- Landed cost in whole rupees, rounded up.
--
-- drizzle/0049 stored it to four decimals, which is what the division actually
-- produces — 12 rupees of freight over 5 units is 2.4 a piece. A cost is read as
-- the floor under a selling price, though, and the fraction of a rupee that
-- rounding down would shave off is sold at a loss on every unit that goes out,
-- so it rounds up.
--
-- The consequence, stated plainly: the landed costs no longer add back to the
-- invoice. They come to a little over the grand total, by under a rupee a line.
-- Nothing settles against them — the payable is settled against unit_price,
-- which this does not touch.
--
-- Purchases and stock openings only, the same rows 0049 rebuilt. A sale line's
-- unit_cost is the rate it was costed into that sale at and stays as it is.
UPDATE document_lines dl
SET unit_cost = CEIL(dl.unit_cost)
FROM documents d
JOIN document_types dt ON dt.id = d.document_type_id
WHERE dl.document_id = d.id
  AND dt.code IN ('PURCHASE_INVOICE', 'STOCK_OPENING')
  AND dl.unit_cost IS NOT NULL
  AND dl.unit_cost <> CEIL(dl.unit_cost);
