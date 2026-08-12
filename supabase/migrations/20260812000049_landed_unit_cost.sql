-- What a purchased piece actually cost, carriage included.
--
-- document_lines.unit_cost was being written with quantity x unit_price — a line
-- total under a column named for a unit. Nothing read it, so nothing was wrong
-- on screen, but the name promised a per-unit figure and the purchase form now
-- shows one: the price plus that unit's share of what the delivery was charged
-- on top of the goods — shipping, less the discount, plus the tax — spread over
-- every unit that arrived in the same load. Same signs the grand total uses, so
-- sum(unit_cost x quantity) comes back to it.
--
-- The share is recoverable for what's already stored — shipping_total,
-- discount_total and tax_total are on the document, and so is every line's
-- quantity — so the old rows are rebuilt rather than left as line totals for the
-- view below to read as costs.
--
-- Purchases and stock openings only. On a sale line unit_cost means the rate the
-- item was costed into that sale at, which is a different number and stays.
UPDATE document_lines dl
SET unit_cost = ROUND(
      dl.unit_price
        + CASE
            WHEN q.total_quantity > 0
            THEN (d.shipping_total - d.discount_total + d.tax_total) / q.total_quantity
            ELSE 0
          END,
      4
    )
FROM documents d
JOIN document_types dt ON dt.id = d.document_type_id
JOIN (
    SELECT document_id, SUM(quantity) AS total_quantity
    FROM document_lines
    GROUP BY document_id
) q ON q.document_id = d.id
WHERE dl.document_id = d.id
  AND dt.code IN ('PURCHASE_INVOICE', 'STOCK_OPENING');
--> statement-breakpoint

-- rate_list now reports landed cost rather than the invoice price. "What we last
-- paid for this" is the question both the products page and the sale grid ask of
-- it, and freight is part of what was paid — a price that ignores it prices the
-- next sale below cost.
--
-- COALESCE for the rows the backfill above can't reach: a line written before
-- unit_cost existed falls back to the price, which is what the view returned
-- before this migration.
--
-- Same view as drizzle/0044, with the rate columns swapped for cost. Still not
-- security_invoker: see the note in 0007 before exposing it to app_user.
DROP VIEW IF EXISTS rate_list;
--> statement-breakpoint

CREATE VIEW rate_list AS
SELECT

    i.id,
    i.sku,
    i.name,

    (
        SELECT COALESCE(dl.unit_cost, dl.unit_price)
        FROM document_lines dl
        JOIN documents d
            ON d.id = dl.document_id
        JOIN document_types dt
            ON dt.id = d.document_type_id
        WHERE
            dl.item_id = i.id
            AND dt.code IN ('PURCHASE_INVOICE', 'STOCK_OPENING')
        ORDER BY d.document_date DESC
        LIMIT 1
    ) AS purchase_rate_1,

    (
        SELECT d.document_date
        FROM document_lines dl
        JOIN documents d
            ON d.id = dl.document_id
        JOIN document_types dt
            ON dt.id = d.document_type_id
        WHERE
            dl.item_id = i.id
            AND dt.code IN ('PURCHASE_INVOICE', 'STOCK_OPENING')
        ORDER BY d.document_date DESC
        LIMIT 1
    ) AS purchase_date_1,

    (
        SELECT COALESCE(dl.unit_cost, dl.unit_price)
        FROM document_lines dl
        JOIN documents d
            ON d.id = dl.document_id
        JOIN document_types dt
            ON dt.id = d.document_type_id
        WHERE
            dl.item_id = i.id
            AND dt.code IN ('PURCHASE_INVOICE', 'STOCK_OPENING')
        ORDER BY d.document_date DESC
        OFFSET 1
        LIMIT 1
    ) AS purchase_rate_2,

    (
        SELECT d.document_date
        FROM document_lines dl
        JOIN documents d
            ON d.id = dl.document_id
        JOIN document_types dt
            ON dt.id = d.document_type_id
        WHERE
            dl.item_id = i.id
            AND dt.code IN ('PURCHASE_INVOICE', 'STOCK_OPENING')
        ORDER BY d.document_date DESC
        OFFSET 1
        LIMIT 1
    ) AS purchase_date_2,

    (
        SELECT COALESCE(dl.unit_cost, dl.unit_price)
        FROM document_lines dl
        JOIN documents d
            ON d.id = dl.document_id
        JOIN document_types dt
            ON dt.id = d.document_type_id
        WHERE
            dl.item_id = i.id
            AND dt.code IN ('PURCHASE_INVOICE', 'STOCK_OPENING')
        ORDER BY d.document_date DESC
        OFFSET 2
        LIMIT 1
    ) AS purchase_rate_3,

    (
        SELECT d.document_date
        FROM document_lines dl
        JOIN documents d
            ON d.id = dl.document_id
        JOIN document_types dt
            ON dt.id = d.document_type_id
        WHERE
            dl.item_id = i.id
            AND dt.code IN ('PURCHASE_INVOICE', 'STOCK_OPENING')
        ORDER BY d.document_date DESC
        OFFSET 2
        LIMIT 1
    ) AS purchase_date_3

FROM items i;
