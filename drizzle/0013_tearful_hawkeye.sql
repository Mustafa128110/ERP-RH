ALTER TABLE "units" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY "company_scope" ON "units" CASCADE;--> statement-breakpoint
ALTER TABLE "units" DROP CONSTRAINT "units_company_id_companies_id_fk";
--> statement-breakpoint
ALTER TABLE "units" DROP COLUMN "company_id";