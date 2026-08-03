CREATE TABLE "cash_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"name" varchar(150) NOT NULL,
	"opening_balance" numeric(18, 2) DEFAULT '0',
	"current_balance" numeric(18, 2) DEFAULT '0',
	"is_default" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cash_accounts_company_id_name_unique" UNIQUE("company_id","name")
);
--> statement-breakpoint
ALTER TABLE "cash_accounts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "cash_accounts" ADD CONSTRAINT "cash_accounts_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "company_scope" ON "cash_accounts" AS PERMISSIVE FOR ALL TO "app_user" USING (company_id IN (SELECT company_id FROM user_company_access WHERE user_id = current_setting('app.user_id', true)::uuid)) WITH CHECK (company_id IN (SELECT company_id FROM user_company_access WHERE user_id = current_setting('app.user_id', true)::uuid));