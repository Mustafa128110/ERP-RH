-- Three features that had screens but no tables behind them.
--
--   audit_logs        who changed what, when and why (lib/actions/audit.ts)
--   whatsapp_messages every message sent to a contact, and what became of it
--   quotations        documents.valid_until / source_document_id and
--                     document_lines.converted_quantity — a quotation is an
--                     ordinary document, so it needed columns rather than tables
--
-- documents.sale_type is deliberately absent below even though drizzle-kit
-- generated it: migration 0043 added it by hand and left no snapshot, so the
-- generator could not see it already existed.

CREATE TYPE "public"."audit_action" AS ENUM('create', 'update', 'delete', 'merge', 'import');--> statement-breakpoint
CREATE TYPE "public"."whatsapp_status" AS ENUM('queued', 'sent', 'delivered', 'read', 'failed');--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid,
	"user_id" uuid,
	"user_name" varchar(100) NOT NULL,
	"action" "audit_action" NOT NULL,
	"entity" varchar(50) NOT NULL,
	"entity_id" uuid,
	"summary" varchar(200) NOT NULL,
	"detail" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audit_logs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "whatsapp_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"contact_id" uuid,
	"recipient_name" varchar(200) NOT NULL,
	"phone" varchar(30) NOT NULL,
	"template" varchar(50) NOT NULL,
	"document_id" uuid,
	"body" text NOT NULL,
	"status" "whatsapp_status" DEFAULT 'queued' NOT NULL,
	"provider_message_id" varchar(120),
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "whatsapp_messages" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "document_lines" ADD COLUMN "converted_quantity" numeric(18, 3);--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "valid_until" date;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "source_document_id" uuid;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_messages" ADD CONSTRAINT "whatsapp_messages_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_messages" ADD CONSTRAINT "whatsapp_messages_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_messages" ADD CONSTRAINT "whatsapp_messages_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_audit_created" ON "audit_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_audit_entity" ON "audit_logs" USING btree ("entity","entity_id");--> statement-breakpoint
CREATE INDEX "idx_whatsapp_created" ON "whatsapp_messages" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_whatsapp_provider_id" ON "whatsapp_messages" USING btree ("provider_message_id");--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_source_document_id_documents_id_fk" FOREIGN KEY ("source_document_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "company_or_global_scope" ON "audit_logs" AS PERMISSIVE FOR ALL TO "app_user" USING (company_id IS NULL OR company_id IN (SELECT company_id FROM user_company_access WHERE user_id = current_setting('app.user_id', true)::uuid)) WITH CHECK (company_id IS NULL OR company_id IN (SELECT company_id FROM user_company_access WHERE user_id = current_setting('app.user_id', true)::uuid));--> statement-breakpoint
CREATE POLICY "company_scope" ON "whatsapp_messages" AS PERMISSIVE FOR ALL TO "app_user" USING (company_id IN (SELECT company_id FROM user_company_access WHERE user_id = current_setting('app.user_id', true)::uuid)) WITH CHECK (company_id IN (SELECT company_id FROM user_company_access WHERE user_id = current_setting('app.user_id', true)::uuid));