CREATE TABLE "document_number_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"document_type_id" smallint NOT NULL,
	"number" varchar(50) NOT NULL,
	"document_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_number_ledger_company_id_document_type_id_number_unique" UNIQUE("company_id","document_type_id","number")
);
--> statement-breakpoint
ALTER TABLE "document_number_ledger" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "document_number_ledger" ADD CONSTRAINT "document_number_ledger_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_number_ledger" ADD CONSTRAINT "document_number_ledger_document_type_id_document_types_id_fk" FOREIGN KEY ("document_type_id") REFERENCES "public"."document_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_number_ledger" ADD CONSTRAINT "document_number_ledger_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "company_scope" ON "document_number_ledger" AS PERMISSIVE FOR ALL TO "app_user" USING (company_id IN (SELECT company_id FROM user_company_access WHERE user_id = current_setting('app.user_id', true)::uuid)) WITH CHECK (company_id IN (SELECT company_id FROM user_company_access WHERE user_id = current_setting('app.user_id', true)::uuid));