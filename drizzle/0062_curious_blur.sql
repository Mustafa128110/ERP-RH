CREATE TYPE "public"."general_account_type" AS ENUM('asset', 'liability', 'equity', 'income', 'expense');--> statement-breakpoint
CREATE TABLE "general_ledger_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"code" varchar(40) NOT NULL,
	"name" varchar(150) NOT NULL,
	"account_type" "general_account_type" NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "general_ledger_accounts_company_id_code_unique" UNIQUE("company_id","code")
);
--> statement-breakpoint
CREATE TABLE "general_ledger_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"debit" numeric(18, 2) DEFAULT '0' NOT NULL,
	"credit" numeric(18, 2) DEFAULT '0' NOT NULL,
	"memo" varchar(250),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "general_ledger_entries_debit_credit_check" CHECK (("general_ledger_entries"."debit" = 0 AND "general_ledger_entries"."credit" > 0) OR ("general_ledger_entries"."credit" = 0 AND "general_ledger_entries"."debit" > 0))
);
--> statement-breakpoint
ALTER TABLE "general_ledger_accounts" ADD CONSTRAINT "general_ledger_accounts_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "general_ledger_entries" ADD CONSTRAINT "general_ledger_entries_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "general_ledger_entries" ADD CONSTRAINT "general_ledger_entries_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "general_ledger_entries" ADD CONSTRAINT "general_ledger_entries_account_id_general_ledger_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."general_ledger_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_gl_accounts_company_active" ON "general_ledger_accounts" USING btree ("company_id","is_active");--> statement-breakpoint
CREATE INDEX "idx_gl_entries_company_account" ON "general_ledger_entries" USING btree ("company_id","account_id");--> statement-breakpoint
CREATE INDEX "idx_gl_entries_document" ON "general_ledger_entries" USING btree ("document_id");
