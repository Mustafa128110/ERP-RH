-- Reporting view: last 3 purchase rates + dates per item, sourced from
-- document_lines where the parent document is a PURCHASE_INVOICE. Kept as a
-- hand-written view (not a typed pgView in lib/db/schema.ts) since the
-- correlated OFFSET/LIMIT subqueries don't map cleanly onto Drizzle's query
-- builder and nothing in the app queries this yet — see docs/db/Royal_Hardware_ERP_SQL.md.
-- ponytail: not security_invoker, so it runs with the view owner's (migration
-- role's) BYPASSRLS privileges regardless of caller — fine for direct db
-- access (no end-user session to scope by), but do not expose this view to
-- app_user without reconsidering RLS if it's ever queried through withUserContext().
CREATE VIEW rate_list AS
SELECT

    i.id,
    i.sku,
    i.name,

    (
        SELECT dl.unit_price
        FROM document_lines dl
        JOIN documents d
            ON d.id = dl.document_id
        JOIN document_types dt
            ON dt.id = d.document_type_id
        WHERE
            dl.item_id = i.id
            AND dt.code = 'PURCHASE_INVOICE'
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
            AND dt.code = 'PURCHASE_INVOICE'
        ORDER BY d.document_date DESC
        LIMIT 1
    ) AS purchase_date_1,

    (
        SELECT dl.unit_price
        FROM document_lines dl
        JOIN documents d
            ON d.id = dl.document_id
        JOIN document_types dt
            ON dt.id = d.document_type_id
        WHERE
            dl.item_id = i.id
            AND dt.code = 'PURCHASE_INVOICE'
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
            AND dt.code = 'PURCHASE_INVOICE'
        ORDER BY d.document_date DESC
        OFFSET 1
        LIMIT 1
    ) AS purchase_date_2,

    (
        SELECT dl.unit_price
        FROM document_lines dl
        JOIN documents d
            ON d.id = dl.document_id
        JOIN document_types dt
            ON dt.id = d.document_type_id
        WHERE
            dl.item_id = i.id
            AND dt.code = 'PURCHASE_INVOICE'
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
            AND dt.code = 'PURCHASE_INVOICE'
        ORDER BY d.document_date DESC
        OFFSET 2
        LIMIT 1
    ) AS purchase_date_3

FROM items i;
