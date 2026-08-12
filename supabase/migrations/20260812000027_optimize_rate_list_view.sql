-- rate_list previously ran 6 separate correlated subqueries per item (3 OFFSET
-- levels x duplicate rate/date queries, each rescanning + resorting the same
-- purchase lines). Replaced with one ROW_NUMBER pass per item via LATERAL,
-- pivoted into the same rate_1/date_1..rate_3/date_3 columns. Same output
-- shape, ~6x fewer scans — this is what listProductsWithRates() (products
-- page) queries on every load.
-- DROP then CREATE, not CREATE OR REPLACE: the rewrite changes purchase_rate_N
-- from numeric(18,4) to numeric, and Postgres refuses to alter a view column's
-- type in place ("cannot change data type of view column").
DROP VIEW IF EXISTS rate_list;
--> statement-breakpoint
CREATE VIEW rate_list AS
SELECT
    i.id,
    i.sku,
    i.name,
    ranked.purchase_rate_1,
    ranked.purchase_date_1,
    ranked.purchase_rate_2,
    ranked.purchase_date_2,
    ranked.purchase_rate_3,
    ranked.purchase_date_3
FROM items i
LEFT JOIN LATERAL (
    SELECT
        MAX(unit_price) FILTER (WHERE rn = 1) AS purchase_rate_1,
        MAX(document_date) FILTER (WHERE rn = 1) AS purchase_date_1,
        MAX(unit_price) FILTER (WHERE rn = 2) AS purchase_rate_2,
        MAX(document_date) FILTER (WHERE rn = 2) AS purchase_date_2,
        MAX(unit_price) FILTER (WHERE rn = 3) AS purchase_rate_3,
        MAX(document_date) FILTER (WHERE rn = 3) AS purchase_date_3
    FROM (
        SELECT
            dl.unit_price,
            d.document_date,
            ROW_NUMBER() OVER (ORDER BY d.document_date DESC) AS rn
        FROM document_lines dl
        JOIN documents d
            ON d.id = dl.document_id
        JOIN document_types dt
            ON dt.id = d.document_type_id
        WHERE
            dl.item_id = i.id
            AND dt.code = 'PURCHASE_INVOICE'
        ORDER BY d.document_date DESC
        LIMIT 3
    ) top3
) ranked ON true;
