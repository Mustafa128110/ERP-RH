CREATE TYPE "public"."market_purchase_status" AS ENUM('pending', 'confirmed', 'cancelled');--> statement-breakpoint
ALTER TYPE "public"."document_series" ADD VALUE 'MP' BEFORE 'CN';--> statement-breakpoint
ALTER TYPE "public"."document_type_code" ADD VALUE 'MARKET_PURCHASE' BEFORE 'CREDIT_NOTE';--> statement-breakpoint
CREATE TABLE "market_purchase_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"sale_document_id" uuid NOT NULL,
	"sale_line_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"unit_id" uuid,
	"quantity" numeric(18, 3) NOT NULL,
	"base_quantity" numeric(18, 3) NOT NULL,
	"status" "market_purchase_status" DEFAULT 'pending' NOT NULL,
	"confirmation_document_id" uuid,
	"expense_id" uuid,
	"purchase_cost" numeric(18, 4),
	"confirmed_by" uuid,
	"confirmed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "market_purchase_requests_sale_line_id_unique" UNIQUE("sale_line_id"),
	CONSTRAINT "market_purchase_quantity_check" CHECK ("market_purchase_requests"."quantity" > 0 AND "market_purchase_requests"."base_quantity" > 0),
	CONSTRAINT "market_purchase_cost_check" CHECK ("market_purchase_requests"."purchase_cost" IS NULL OR "market_purchase_requests"."purchase_cost" >= 0)
);
--> statement-breakpoint
ALTER TABLE "document_lines" ADD COLUMN "market_purchase" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "status" "document_status" DEFAULT 'posted' NOT NULL;--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "cancelled_by" uuid;--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "cancelled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "market_purchase_requests" ADD CONSTRAINT "market_purchase_requests_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_purchase_requests" ADD CONSTRAINT "market_purchase_requests_sale_document_id_documents_id_fk" FOREIGN KEY ("sale_document_id") REFERENCES "public"."documents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_purchase_requests" ADD CONSTRAINT "market_purchase_requests_sale_line_id_document_lines_id_fk" FOREIGN KEY ("sale_line_id") REFERENCES "public"."document_lines"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_purchase_requests" ADD CONSTRAINT "market_purchase_requests_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_purchase_requests" ADD CONSTRAINT "market_purchase_requests_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_purchase_requests" ADD CONSTRAINT "market_purchase_requests_confirmation_document_id_documents_id_fk" FOREIGN KEY ("confirmation_document_id") REFERENCES "public"."documents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_purchase_requests" ADD CONSTRAINT "market_purchase_requests_expense_id_expenses_id_fk" FOREIGN KEY ("expense_id") REFERENCES "public"."expenses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_market_purchase_status_company" ON "market_purchase_requests" USING btree ("status","company_id");--> statement-breakpoint
CREATE INDEX "idx_market_purchase_confirmation" ON "market_purchase_requests" USING btree ("confirmation_document_id");
--> statement-breakpoint
INSERT INTO "permissions" ("module", "action") VALUES
  ('stock_adjustments', 'delete'),
  ('stock_transfers', 'edit'),
  ('stock_transfers', 'delete')
ON CONFLICT ("module", "action") DO NOTHING;
--> statement-breakpoint
INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r.id, p.id
FROM "roles" r
CROSS JOIN "permissions" p
WHERE r.name = 'Admin'
  AND (p.module, p.action) IN (
    ('stock_adjustments', 'delete'),
    ('stock_transfers', 'edit'),
    ('stock_transfers', 'delete')
  )
ON CONFLICT DO NOTHING;
