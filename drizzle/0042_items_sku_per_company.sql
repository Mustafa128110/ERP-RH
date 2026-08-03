-- One physical product sold from Royal Hardware to M52 is the same product, but
-- the catalogs are separate rows (items.company_id is NOT NULL and stock hangs
-- off the row). A global UNIQUE on sku meant the buyer's row could not carry the
-- seller's SKU, so every inter-company sale minted a second one.
ALTER TABLE "items" DROP CONSTRAINT "items_sku_unique";--> statement-breakpoint

-- Repair what the old code created. The buyer's item was resolved by *name*, and
-- the name it got was the picker's label — "R5 Glass Cutting Disc 4\" (RH-00005)"
-- — so 13 rows landed in Royal Hardware named after the label with a fresh SKU.
-- The suffix names the SKU they should have had, and no row in their company
-- holds it, so each is renamed and re-SKU'd in place: the document lines and
-- stock movements already pointing at them stay correct.
UPDATE "items"
SET "sku" = substring("name" from '\(([^)]+)\)$'),
    "name" = regexp_replace("name", '\s*\([^)]+\)$', '')
WHERE "name" ~ '\(RH-[0-9]+\)$'
  AND NOT EXISTS (
    SELECT 1 FROM "items" other
    WHERE other."company_id" = "items"."company_id"
      AND other."sku" = substring("items"."name" from '\(([^)]+)\)$')
  );--> statement-breakpoint

ALTER TABLE "items" ADD CONSTRAINT "items_company_id_sku_unique" UNIQUE("company_id","sku");
