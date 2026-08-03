-- rate_list used to read PURCHASE_INVOICE lines only. Editing a product and
-- typing a purchase rate no longer books a purchase invoice (that would owe a
-- supplier money nobody agreed to) — it books a STOCK_OPENING receipt, which
-- moves the stock and records the rate without touching the ledger. Both are
-- "what we last paid for this", so both feed the rate columns.
--
-- Same view as drizzle/0007, with the document-type filter widened. Still not
-- security_invoker: see the note in 0007 before exposing it to app_user.
DROP VIEW IF EXISTS rate_list;

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
        SELECT dl.unit_price
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
        SELECT dl.unit_price
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
