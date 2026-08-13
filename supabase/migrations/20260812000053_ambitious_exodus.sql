-- Remove the inert RLS machinery: the app_user role, its row-level security
-- policies and RLS itself were never activated — the app connects as a
-- BYPASSRLS role and scopes per company in application code (lib/auth/scope.ts),
-- so `withUserContext` (deleted) and every policy here were dead weight.
-- Policies must go before the role: DROP ROLE fails while policies still
-- reference it.
ALTER TABLE "audit_logs" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "bank_accounts" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "cash_accounts" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "cheque_register" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "contacts" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "document_lines" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "document_number_ledger" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "document_types" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "documents" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "expense_categories" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "expenses" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "inventory_transactions" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "item_images" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "items" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ledger_entries" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "settings" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "unit_conversions" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "whatsapp_messages" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY "company_or_global_scope" ON "audit_logs";--> statement-breakpoint
DROP POLICY "company_scope" ON "bank_accounts";--> statement-breakpoint
DROP POLICY "company_scope" ON "cash_accounts";--> statement-breakpoint
DROP POLICY "company_scope" ON "cheque_register";--> statement-breakpoint
DROP POLICY "company_or_global_scope" ON "contacts";--> statement-breakpoint
DROP POLICY "company_scope" ON "document_lines";--> statement-breakpoint
DROP POLICY "company_scope" ON "document_number_ledger";--> statement-breakpoint
DROP POLICY "company_scope" ON "document_types";--> statement-breakpoint
DROP POLICY "company_scope" ON "documents";--> statement-breakpoint
DROP POLICY "company_scope" ON "expense_categories";--> statement-breakpoint
DROP POLICY "company_scope" ON "expenses";--> statement-breakpoint
DROP POLICY "company_scope" ON "inventory_transactions";--> statement-breakpoint
DROP POLICY "company_scope" ON "item_images";--> statement-breakpoint
DROP POLICY "company_scope" ON "items";--> statement-breakpoint
DROP POLICY "company_scope" ON "ledger_entries";--> statement-breakpoint
DROP POLICY "company_scope" ON "settings";--> statement-breakpoint
DROP POLICY "company_scope" ON "unit_conversions";--> statement-breakpoint
DROP POLICY "company_scope" ON "whatsapp_messages";--> statement-breakpoint
DROP ROLE "app_user";
