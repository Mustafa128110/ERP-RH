DROP POLICY "company_scope" ON "payment_methods" CASCADE;--> statement-breakpoint
DROP TABLE "payment_methods" CASCADE;--> statement-breakpoint
-- IF EXISTS: DROP TABLE ... CASCADE above already removed both of these
-- constraints, so dropping them again aborts the migration on a fresh database.
ALTER TABLE "documents" DROP CONSTRAINT IF EXISTS "documents_payment_method_id_payment_methods_id_fk";
--> statement-breakpoint
ALTER TABLE "expenses" DROP CONSTRAINT IF EXISTS "expenses_payment_method_id_payment_methods_id_fk";
--> statement-breakpoint
ALTER TABLE "documents" DROP COLUMN "payment_method_id";--> statement-breakpoint
ALTER TABLE "expenses" DROP COLUMN "payment_method_id";