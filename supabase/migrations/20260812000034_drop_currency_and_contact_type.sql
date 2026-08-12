ALTER TABLE "documents" DROP CONSTRAINT IF EXISTS "documents_currency_id_currencies_id_fk";--> statement-breakpoint
ALTER TABLE "currencies" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "currencies" CASCADE;--> statement-breakpoint
ALTER TABLE "contacts" DROP COLUMN "contact_type";--> statement-breakpoint
ALTER TABLE "documents" DROP COLUMN "currency_id";--> statement-breakpoint
ALTER TABLE "documents" DROP COLUMN "exchange_rate";--> statement-breakpoint
DROP TYPE "public"."contact_type";