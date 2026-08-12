ALTER TABLE "attachments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "brands" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "categories" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "currencies" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "document_lines" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "document_types" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "expense_categories" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "inventory_transactions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "item_images" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ledger_entries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "payment_methods" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "taxes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "unit_conversions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "units" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "brands" DROP CONSTRAINT "brands_name_unique";--> statement-breakpoint
ALTER TABLE "categories" DROP CONSTRAINT "categories_slug_unique";--> statement-breakpoint
ALTER TABLE "currencies" DROP CONSTRAINT "currencies_code_unique";--> statement-breakpoint
ALTER TABLE "document_types" DROP CONSTRAINT "document_types_code_unique";--> statement-breakpoint
ALTER TABLE "expense_categories" DROP CONSTRAINT "expense_categories_name_unique";--> statement-breakpoint
ALTER TABLE "payment_methods" DROP CONSTRAINT "payment_methods_name_unique";--> statement-breakpoint
ALTER TABLE "user_roles" DROP CONSTRAINT "user_roles_user_id_role_id_pk";--> statement-breakpoint
ALTER TABLE "attachments" ADD COLUMN "company_id" uuid;--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "company_id" uuid;--> statement-breakpoint
ALTER TABLE "brands" ADD COLUMN "company_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "categories" ADD COLUMN "company_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "currencies" ADD COLUMN "company_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "document_lines" ADD COLUMN "company_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "document_types" ADD COLUMN "company_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "expense_categories" ADD COLUMN "company_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "inventory_transactions" ADD COLUMN "company_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "item_images" ADD COLUMN "company_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD COLUMN "company_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "payment_methods" ADD COLUMN "company_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "taxes" ADD COLUMN "company_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "unit_conversions" ADD COLUMN "company_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "units" ADD COLUMN "company_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "user_roles" ADD COLUMN "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL;--> statement-breakpoint
ALTER TABLE "user_roles" ADD COLUMN "company_id" uuid;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brands" ADD CONSTRAINT "brands_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "currencies" ADD CONSTRAINT "currencies_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_lines" ADD CONSTRAINT "document_lines_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_types" ADD CONSTRAINT "document_types_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_categories" ADD CONSTRAINT "expense_categories_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_transactions" ADD CONSTRAINT "inventory_transactions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_images" ADD CONSTRAINT "item_images_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_methods" ADD CONSTRAINT "payment_methods_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "taxes" ADD CONSTRAINT "taxes_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unit_conversions" ADD CONSTRAINT "unit_conversions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "units" ADD CONSTRAINT "units_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brands" ADD CONSTRAINT "brands_company_id_name_unique" UNIQUE("company_id","name");--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_company_id_slug_unique" UNIQUE("company_id","slug");--> statement-breakpoint
ALTER TABLE "currencies" ADD CONSTRAINT "currencies_company_id_code_unique" UNIQUE("company_id","code");--> statement-breakpoint
ALTER TABLE "document_types" ADD CONSTRAINT "document_types_company_id_code_unique" UNIQUE("company_id","code");--> statement-breakpoint
ALTER TABLE "expense_categories" ADD CONSTRAINT "expense_categories_company_id_name_unique" UNIQUE("company_id","name");--> statement-breakpoint
ALTER TABLE "payment_methods" ADD CONSTRAINT "payment_methods_company_id_name_unique" UNIQUE("company_id","name");--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_role_id_company_id_unique" UNIQUE("user_id","role_id","company_id");--> statement-breakpoint
CREATE POLICY "company_scope" ON "attachments" AS PERMISSIVE FOR ALL TO "app_user" USING ("attachments"."company_id" IS NULL OR company_id IN (SELECT company_id FROM user_company_access WHERE user_id = current_setting('app.user_id', true)::uuid)) WITH CHECK ("attachments"."company_id" IS NULL OR company_id IN (SELECT company_id FROM user_company_access WHERE user_id = current_setting('app.user_id', true)::uuid));--> statement-breakpoint
CREATE POLICY "company_scope" ON "brands" AS PERMISSIVE FOR ALL TO "app_user" USING (company_id IN (SELECT company_id FROM user_company_access WHERE user_id = current_setting('app.user_id', true)::uuid)) WITH CHECK (company_id IN (SELECT company_id FROM user_company_access WHERE user_id = current_setting('app.user_id', true)::uuid));--> statement-breakpoint
CREATE POLICY "company_scope" ON "categories" AS PERMISSIVE FOR ALL TO "app_user" USING (company_id IN (SELECT company_id FROM user_company_access WHERE user_id = current_setting('app.user_id', true)::uuid)) WITH CHECK (company_id IN (SELECT company_id FROM user_company_access WHERE user_id = current_setting('app.user_id', true)::uuid));--> statement-breakpoint
CREATE POLICY "company_scope" ON "currencies" AS PERMISSIVE FOR ALL TO "app_user" USING (company_id IN (SELECT company_id FROM user_company_access WHERE user_id = current_setting('app.user_id', true)::uuid)) WITH CHECK (company_id IN (SELECT company_id FROM user_company_access WHERE user_id = current_setting('app.user_id', true)::uuid));--> statement-breakpoint
CREATE POLICY "company_scope" ON "document_lines" AS PERMISSIVE FOR ALL TO "app_user" USING (company_id IN (SELECT company_id FROM user_company_access WHERE user_id = current_setting('app.user_id', true)::uuid)) WITH CHECK (company_id IN (SELECT company_id FROM user_company_access WHERE user_id = current_setting('app.user_id', true)::uuid));--> statement-breakpoint
CREATE POLICY "company_scope" ON "document_types" AS PERMISSIVE FOR ALL TO "app_user" USING (company_id IN (SELECT company_id FROM user_company_access WHERE user_id = current_setting('app.user_id', true)::uuid)) WITH CHECK (company_id IN (SELECT company_id FROM user_company_access WHERE user_id = current_setting('app.user_id', true)::uuid));--> statement-breakpoint
CREATE POLICY "company_scope" ON "expense_categories" AS PERMISSIVE FOR ALL TO "app_user" USING (company_id IN (SELECT company_id FROM user_company_access WHERE user_id = current_setting('app.user_id', true)::uuid)) WITH CHECK (company_id IN (SELECT company_id FROM user_company_access WHERE user_id = current_setting('app.user_id', true)::uuid));--> statement-breakpoint
CREATE POLICY "company_scope" ON "inventory_transactions" AS PERMISSIVE FOR ALL TO "app_user" USING (company_id IN (SELECT company_id FROM user_company_access WHERE user_id = current_setting('app.user_id', true)::uuid)) WITH CHECK (company_id IN (SELECT company_id FROM user_company_access WHERE user_id = current_setting('app.user_id', true)::uuid));--> statement-breakpoint
CREATE POLICY "company_scope" ON "item_images" AS PERMISSIVE FOR ALL TO "app_user" USING (company_id IN (SELECT company_id FROM user_company_access WHERE user_id = current_setting('app.user_id', true)::uuid)) WITH CHECK (company_id IN (SELECT company_id FROM user_company_access WHERE user_id = current_setting('app.user_id', true)::uuid));--> statement-breakpoint
CREATE POLICY "company_scope" ON "ledger_entries" AS PERMISSIVE FOR ALL TO "app_user" USING (company_id IN (SELECT company_id FROM user_company_access WHERE user_id = current_setting('app.user_id', true)::uuid)) WITH CHECK (company_id IN (SELECT company_id FROM user_company_access WHERE user_id = current_setting('app.user_id', true)::uuid));--> statement-breakpoint
CREATE POLICY "company_scope" ON "payment_methods" AS PERMISSIVE FOR ALL TO "app_user" USING (company_id IN (SELECT company_id FROM user_company_access WHERE user_id = current_setting('app.user_id', true)::uuid)) WITH CHECK (company_id IN (SELECT company_id FROM user_company_access WHERE user_id = current_setting('app.user_id', true)::uuid));--> statement-breakpoint
CREATE POLICY "company_scope" ON "taxes" AS PERMISSIVE FOR ALL TO "app_user" USING (company_id IN (SELECT company_id FROM user_company_access WHERE user_id = current_setting('app.user_id', true)::uuid)) WITH CHECK (company_id IN (SELECT company_id FROM user_company_access WHERE user_id = current_setting('app.user_id', true)::uuid));--> statement-breakpoint
CREATE POLICY "company_scope" ON "unit_conversions" AS PERMISSIVE FOR ALL TO "app_user" USING (company_id IN (SELECT company_id FROM user_company_access WHERE user_id = current_setting('app.user_id', true)::uuid)) WITH CHECK (company_id IN (SELECT company_id FROM user_company_access WHERE user_id = current_setting('app.user_id', true)::uuid));--> statement-breakpoint
CREATE POLICY "company_scope" ON "units" AS PERMISSIVE FOR ALL TO "app_user" USING (company_id IN (SELECT company_id FROM user_company_access WHERE user_id = current_setting('app.user_id', true)::uuid)) WITH CHECK (company_id IN (SELECT company_id FROM user_company_access WHERE user_id = current_setting('app.user_id', true)::uuid));