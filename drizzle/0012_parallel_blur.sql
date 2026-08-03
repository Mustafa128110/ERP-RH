CREATE TABLE "bank_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"bank_name" varchar(150) NOT NULL,
	"branch_name" varchar(150),
	"account_title" varchar(200) NOT NULL,
	"account_number" varchar(50) NOT NULL,
	"iban" varchar(34),
	"swift_code" varchar(20),
	"opening_balance" numeric(18, 2) DEFAULT '0',
	"current_balance" numeric(18, 2) DEFAULT '0',
	"is_default" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bank_accounts_company_id_account_number_unique" UNIQUE("company_id","account_number")
);
--> statement-breakpoint
ALTER TABLE "bank_accounts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "cheque_register" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"bank_account_id" uuid,
	"document_id" uuid,
	"contact_id" uuid,
	"cheque_number" varchar(50) NOT NULL,
	"cheque_date" date NOT NULL,
	"amount" numeric(18, 2) NOT NULL,
	"cheque_type" "cheque_type" NOT NULL,
	"status" "cheque_status" DEFAULT 'IN_HAND' NOT NULL,
	"issued_by_company" boolean DEFAULT false NOT NULL,
	"remarks" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cheque_register_bank_account_id_cheque_number_unique" UNIQUE("bank_account_id","cheque_number"),
	CONSTRAINT "cheque_register_amount_check" CHECK ("cheque_register"."amount" > 0)
);
--> statement-breakpoint
ALTER TABLE "cheque_register" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cheque_register" ADD CONSTRAINT "cheque_register_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cheque_register" ADD CONSTRAINT "cheque_register_bank_account_id_bank_accounts_id_fk" FOREIGN KEY ("bank_account_id") REFERENCES "public"."bank_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cheque_register" ADD CONSTRAINT "cheque_register_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cheque_register" ADD CONSTRAINT "cheque_register_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "company_scope" ON "bank_accounts" AS PERMISSIVE FOR ALL TO "app_user" USING (company_id IN (SELECT company_id FROM user_company_access WHERE user_id = current_setting('app.user_id', true)::uuid)) WITH CHECK (company_id IN (SELECT company_id FROM user_company_access WHERE user_id = current_setting('app.user_id', true)::uuid));--> statement-breakpoint
CREATE POLICY "company_scope" ON "cheque_register" AS PERMISSIVE FOR ALL TO "app_user" USING (company_id IN (SELECT company_id FROM user_company_access WHERE user_id = current_setting('app.user_id', true)::uuid)) WITH CHECK (company_id IN (SELECT company_id FROM user_company_access WHERE user_id = current_setting('app.user_id', true)::uuid));