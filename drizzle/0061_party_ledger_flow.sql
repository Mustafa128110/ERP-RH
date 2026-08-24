ALTER TYPE "public"."document_series" ADD VALUE 'OB';--> statement-breakpoint
ALTER TYPE "public"."document_type_code" ADD VALUE 'OPENING_BALANCE';--> statement-breakpoint
CREATE TABLE "contact_opening_balances" (
	"company_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contact_opening_balances_company_id_contact_id_pk" PRIMARY KEY("company_id","contact_id"),
	CONSTRAINT "contact_opening_balances_document_id_unique" UNIQUE("document_id")
);
--> statement-breakpoint
ALTER TABLE "contact_opening_balances" ADD CONSTRAINT "contact_opening_balances_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_opening_balances" ADD CONSTRAINT "contact_opening_balances_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_opening_balances" ADD CONSTRAINT "contact_opening_balances_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_contact_opening_balances_contact" ON "contact_opening_balances" USING btree ("contact_id");
