DROP POLICY "company_scope" ON "price_lists" CASCADE;--> statement-breakpoint
DROP TABLE "price_lists" CASCADE;--> statement-breakpoint
ALTER TABLE "bank_accounts" DROP COLUMN "swift_code";--> statement-breakpoint
ALTER TABLE "brands" DROP COLUMN "country";--> statement-breakpoint
ALTER TABLE "companies" DROP COLUMN "website";--> statement-breakpoint
ALTER TABLE "contacts" DROP COLUMN "alternate_phone";--> statement-breakpoint
ALTER TABLE "contacts" DROP COLUMN "country";--> statement-breakpoint
ALTER TABLE "expense_categories" DROP COLUMN "description";--> statement-breakpoint
ALTER TABLE "items" DROP COLUMN "barcode";--> statement-breakpoint
ALTER TABLE "items" DROP COLUMN "alias";--> statement-breakpoint
DROP TYPE "public"."document_type_name";