-- Supabase force-enables RLS on every new table in the `public` schema by
-- default, independent of Drizzle's migrations (a project-level default, not
-- something drizzle-kit generate tracks since it diffs schema.ts against its
-- own snapshot history, not the live DB). That left 22 tables RLS-enabled
-- with zero policies — under the non-bypass `app_user` role (lib/db/context.ts),
-- every query against them would return/affect zero rows. Only tables that
-- actually carry a company_id column get a real policy (see 0002); everything
-- else is either global reference data, an identity/RBAC table gated by
-- requirePermission() at the app layer instead of RLS, or a child table whose
-- access is already bounded by its parent's policy when queried via join
-- (documents -> document_lines -> inventory_transactions, items -> item_images,
-- documents -> attachments) — see docs/phase-8-authentication.md §4.
ALTER TABLE "attachments" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "audit_log" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "brands" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "categories" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "companies" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "currencies" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "document_lines" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "document_types" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "expense_categories" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "inventory_transactions" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "item_images" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ledger_entries" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "payment_methods" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "permissions" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "role_permissions" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "roles" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "taxes" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "unit_conversions" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "units" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "user_company_access" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "user_roles" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "user_warehouse_access" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "users" DISABLE ROW LEVEL SECURITY;
