-- Sales need to be told apart by the channel they came through — over the
-- counter, the Balochistan trade, or the Shopify store — so the takings can be
-- reconciled against each afterwards. Nothing on documents could hold it.
--
-- Nullable, like `reason`: it belongs to sales the way a reason belongs to stock
-- adjustments, and a purchase invoice has no sale type at all. No column
-- default, because that would silently stamp 'counter' on every purchase and
-- transfer too — the sales action supplies it instead, which keeps the default
-- attached to the one document type it means anything for.
CREATE TYPE "public"."sale_type" AS ENUM('counter', 'balochistan', 'shopify');--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "sale_type" "sale_type";--> statement-breakpoint

-- Every sale already recorded predates the channels, so it was a counter sale.
UPDATE "documents" d
   SET "sale_type" = 'counter'
  FROM "document_types" dt
 WHERE dt.id = d.document_type_id
   AND dt.code = 'SALES_INVOICE'
   AND d."sale_type" IS NULL;
