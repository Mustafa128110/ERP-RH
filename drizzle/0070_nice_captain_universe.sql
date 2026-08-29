ALTER TABLE "bank_accounts" DROP CONSTRAINT IF EXISTS "bank_accounts_general_ledger_account_id_general_ledger_accounts_id_fk";--> statement-breakpoint
ALTER TABLE "cash_accounts" DROP CONSTRAINT IF EXISTS "cash_accounts_general_ledger_account_id_general_ledger_accounts_id_fk";--> statement-breakpoint
ALTER TABLE "bank_accounts" DROP COLUMN "general_ledger_account_id";--> statement-breakpoint
ALTER TABLE "cash_accounts" DROP COLUMN "general_ledger_account_id";--> statement-breakpoint
ALTER TABLE "general_ledger_entries" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "general_ledger_entries";--> statement-breakpoint
ALTER TABLE "general_ledger_accounts" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "general_ledger_accounts";--> statement-breakpoint
DROP TYPE "public"."general_account_type";--> statement-breakpoint
DELETE FROM "document_number_ledger"
WHERE "document_id" IN (
  SELECT "id" FROM "documents" WHERE "reason" = 'GL Opening Balance'
);--> statement-breakpoint
DELETE FROM "documents" WHERE "reason" = 'GL Opening Balance';--> statement-breakpoint
DELETE FROM "settings" WHERE "key" = 'gl_cutover_date';
