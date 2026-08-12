-- Drop the RLS policies first: they reference company_id, so the column can't be
-- dropped while they exist. (drizzle generated these after the DROP COLUMN,
-- which fails — reordered by hand.)
DROP POLICY "company_scope" ON "brands" CASCADE;--> statement-breakpoint
DROP POLICY "company_scope" ON "categories" CASCADE;--> statement-breakpoint
DROP POLICY "company_scope" ON "currencies" CASCADE;--> statement-breakpoint
DROP POLICY "company_or_warehouse_scope" ON "locations" CASCADE;--> statement-breakpoint
DROP POLICY "company_scope" ON "taxes" CASCADE;--> statement-breakpoint
ALTER TABLE "brands" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "categories" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "currencies" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "locations" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "taxes" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "brands" DROP CONSTRAINT "brands_company_id_name_unique";--> statement-breakpoint
ALTER TABLE "categories" DROP CONSTRAINT "categories_company_id_slug_unique";--> statement-breakpoint
ALTER TABLE "currencies" DROP CONSTRAINT "currencies_company_id_code_unique";--> statement-breakpoint
ALTER TABLE "brands" DROP CONSTRAINT "brands_company_id_companies_id_fk";
--> statement-breakpoint
ALTER TABLE "categories" DROP CONSTRAINT "categories_company_id_companies_id_fk";
--> statement-breakpoint
ALTER TABLE "currencies" DROP CONSTRAINT "currencies_company_id_companies_id_fk";
--> statement-breakpoint
ALTER TABLE "locations" DROP CONSTRAINT "locations_company_id_companies_id_fk";
--> statement-breakpoint
ALTER TABLE "taxes" DROP CONSTRAINT "taxes_company_id_companies_id_fk";
--> statement-breakpoint
ALTER TABLE "brands" DROP COLUMN "company_id";--> statement-breakpoint
ALTER TABLE "categories" DROP COLUMN "company_id";--> statement-breakpoint
ALTER TABLE "currencies" DROP COLUMN "company_id";--> statement-breakpoint
ALTER TABLE "locations" DROP COLUMN "company_id";--> statement-breakpoint
ALTER TABLE "taxes" DROP COLUMN "company_id";--> statement-breakpoint
ALTER TABLE "brands" ADD CONSTRAINT "brands_name_unique" UNIQUE("name");--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_slug_unique" UNIQUE("slug");--> statement-breakpoint
ALTER TABLE "currencies" ADD CONSTRAINT "currencies_code_unique" UNIQUE("code");
