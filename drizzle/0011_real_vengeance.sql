CREATE TYPE "public"."cheque_status" AS ENUM('RECEIVED', 'ISSUED', 'IN_HAND', 'DEPOSITED', 'CLEARED', 'RETURNED', 'CANCELLED', 'VOID');--> statement-breakpoint
CREATE TYPE "public"."cheque_type" AS ENUM('ACCOUNT_PAYEE', 'BEARER', 'CROSS', 'OPEN', 'POST_DATED');--> statement-breakpoint
CREATE TYPE "public"."document_series" AS ENUM('PI', 'PR', 'PO', 'SI', 'SR', 'SO', 'QT', 'ST', 'SA', 'OS', 'RC', 'PM', 'JE', 'EX', 'DN', 'GR', 'CN', 'DB');--> statement-breakpoint
CREATE TYPE "public"."document_type_code" AS ENUM('PURCHASE_INVOICE', 'PURCHASE_RETURN', 'PURCHASE_ORDER', 'SALES_INVOICE', 'SALES_RETURN', 'SALES_ORDER', 'QUOTATION', 'STOCK_TRANSFER', 'STOCK_ADJUSTMENT', 'STOCK_OPENING', 'PAYMENT_RECEIVED', 'PAYMENT_MADE', 'JOURNAL_ENTRY', 'EXPENSE', 'DELIVERY_NOTE', 'GOODS_RECEIPT', 'CREDIT_NOTE', 'DEBIT_NOTE');--> statement-breakpoint
CREATE TYPE "public"."document_type_name" AS ENUM('Purchase Invoice', 'Purchase Return', 'Purchase Order', 'Sales Invoice', 'Sales Return', 'Sales Order', 'Quotation', 'Stock Transfer', 'Stock Adjustment', 'Stock Opening', 'Payment Received', 'Payment Made', 'Journal Entry', 'Expense', 'Delivery Note', 'Goods Receipt', 'Credit Note', 'Debit Note');--> statement-breakpoint
ALTER TABLE "contacts" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY "company_scope" ON "contacts" CASCADE;--> statement-breakpoint
ALTER TABLE "audit_log" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY "company_scope" ON "attachments" CASCADE;--> statement-breakpoint
DROP TABLE "attachments" CASCADE;--> statement-breakpoint
DROP TABLE "audit_log" CASCADE;--> statement-breakpoint
DROP POLICY "company_scope" ON "chart_of_accounts" CASCADE;--> statement-breakpoint
DROP TABLE "chart_of_accounts" CASCADE;--> statement-breakpoint
ALTER TABLE "companies" DROP CONSTRAINT "companies_currency_id_currencies_id_fk";
--> statement-breakpoint
ALTER TABLE "contacts" DROP CONSTRAINT "contacts_company_id_companies_id_fk";
--> statement-breakpoint
ALTER TABLE "document_lines" DROP CONSTRAINT "document_lines_tax_id_taxes_id_fk";
--> statement-breakpoint
ALTER TABLE "items" DROP CONSTRAINT "items_purchase_unit_id_units_id_fk";
--> statement-breakpoint
ALTER TABLE "items" DROP CONSTRAINT "items_sales_unit_id_units_id_fk";
--> statement-breakpoint
ALTER TABLE "items" DROP CONSTRAINT "items_base_unit_id_units_id_fk";
--> statement-breakpoint
DROP VIEW "rate_list";--> statement-breakpoint
ALTER TABLE "document_types" ALTER COLUMN "code" SET DATA TYPE "public"."document_type_code" USING "code"::"public"."document_type_code";--> statement-breakpoint
ALTER TABLE "document_types" ADD COLUMN "series" "document_series" NOT NULL;--> statement-breakpoint
ALTER TABLE "companies" DROP COLUMN "currency_id";--> statement-breakpoint
ALTER TABLE "contacts" DROP COLUMN "company_id";--> statement-breakpoint
ALTER TABLE "document_lines" DROP COLUMN "discount_percent";--> statement-breakpoint
ALTER TABLE "document_lines" DROP COLUMN "discount_amount";--> statement-breakpoint
ALTER TABLE "document_lines" DROP COLUMN "tax_id";--> statement-breakpoint
ALTER TABLE "document_lines" DROP COLUMN "tax_amount";--> statement-breakpoint
ALTER TABLE "documents" DROP COLUMN "series";--> statement-breakpoint
ALTER TABLE "items" DROP COLUMN "purchase_unit_id";--> statement-breakpoint
ALTER TABLE "items" DROP COLUMN "sales_unit_id";--> statement-breakpoint
ALTER TABLE "items" DROP COLUMN "base_unit_id";--> statement-breakpoint
ALTER TABLE "items" DROP COLUMN "minimum_stock";--> statement-breakpoint
ALTER TABLE "items" DROP COLUMN "reorder_level";--> statement-breakpoint
ALTER TABLE "items" DROP COLUMN "purchase_price";--> statement-breakpoint
ALTER TABLE "items" DROP COLUMN "selling_price";--> statement-breakpoint
ALTER TABLE "ledger_entries" DROP COLUMN "account_id";--> statement-breakpoint
ALTER TABLE "document_types" ADD CONSTRAINT "document_types_series_unique" UNIQUE("series");--> statement-breakpoint
CREATE VIEW "rate_list" AS
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