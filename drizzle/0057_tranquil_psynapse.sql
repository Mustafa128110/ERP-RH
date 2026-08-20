ALTER TYPE "public"."audit_action" ADD VALUE 'cancel' BEFORE 'merge';--> statement-breakpoint
ALTER TYPE "public"."audit_action" ADD VALUE 'approve' BEFORE 'merge';--> statement-breakpoint
CREATE TABLE "payment_allocations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"payment_document_id" uuid NOT NULL,
	"invoice_document_id" uuid NOT NULL,
	"amount" numeric(18, 2) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_allocations_payment_document_id_invoice_document_id_unique" UNIQUE("payment_document_id","invoice_document_id"),
	CONSTRAINT "payment_allocations_amount_check" CHECK ("payment_allocations"."amount" > 0)
);
--> statement-breakpoint
ALTER TABLE "document_lines" ADD COLUMN "taxable" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "document_lines" ADD COLUMN "tax_amount" numeric(18, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "document_lines" ADD COLUMN "stock_movement" smallint;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "tax_id" uuid;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "tax_rate" numeric(8, 4) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "tax_inclusive" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "cancelled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "base_unit_id" uuid;--> statement-breakpoint
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_payment_document_id_documents_id_fk" FOREIGN KEY ("payment_document_id") REFERENCES "public"."documents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_invoice_document_id_documents_id_fk" FOREIGN KEY ("invoice_document_id") REFERENCES "public"."documents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_payment_allocations_payment" ON "payment_allocations" USING btree ("payment_document_id");--> statement-breakpoint
CREATE INDEX "idx_payment_allocations_invoice" ON "payment_allocations" USING btree ("invoice_document_id");--> statement-breakpoint
CREATE INDEX "idx_payment_allocations_company" ON "payment_allocations" USING btree ("company_id");--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_tax_id_taxes_id_fk" FOREIGN KEY ("tax_id") REFERENCES "public"."taxes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_base_unit_id_units_id_fk" FOREIGN KEY ("base_unit_id") REFERENCES "public"."units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_lines" ADD CONSTRAINT "document_lines_stock_movement_check" CHECK ("document_lines"."stock_movement" IS NULL OR "document_lines"."stock_movement" IN (-1, 1));--> statement-breakpoint

-- Establish one base unit for legacy products from the unit they have most
-- often moved in. Existing base quantities equal entered quantities, so this
-- labels the historical unit without changing any stock balance.
WITH ranked AS (
  SELECT dl.item_id, dl.unit_id,
         row_number() OVER (PARTITION BY dl.item_id ORDER BY count(*) DESC, dl.unit_id) AS rank
  FROM document_lines dl
  WHERE dl.item_id IS NOT NULL AND dl.unit_id IS NOT NULL
  GROUP BY dl.item_id, dl.unit_id
)
UPDATE items i
SET base_unit_id = ranked.unit_id
FROM ranked
WHERE ranked.rank = 1 AND ranked.item_id = i.id AND i.base_unit_id IS NULL;--> statement-breakpoint

-- Preserve the intended sign on document lines. It is required for pending
-- adjustments, which deliberately have no inventory row until approval.
WITH movement AS (
  SELECT document_line_id, min(movement) AS movement
  FROM inventory_transactions
  GROUP BY document_line_id
  HAVING min(movement) = max(movement)
)
UPDATE document_lines dl
SET stock_movement = movement.movement
FROM movement
WHERE movement.document_line_id = dl.id;--> statement-breakpoint

-- Historical tax totals were entered manually. Snapshot their effective rate
-- and spread the recorded total over taxable lines so old documents continue
-- to add up without pretending a Tax-master row was selected at the time.
UPDATE documents
SET tax_rate = CASE
  WHEN subtotal - discount_total > 0 THEN round((tax_total / (subtotal - discount_total)) * 100, 4)
  ELSE 0
END
WHERE tax_total > 0;--> statement-breakpoint

UPDATE document_lines dl
SET taxable = coalesce(i.taxable, false)
FROM items i
WHERE i.id = dl.item_id;--> statement-breakpoint

WITH taxable_totals AS (
  SELECT dl.document_id, sum(dl.line_total) AS taxable_total
  FROM document_lines dl
  WHERE dl.taxable
  GROUP BY dl.document_id
)
UPDATE document_lines dl
SET tax_amount = CASE
  WHEN totals.taxable_total > 0 THEN round(d.tax_total * dl.line_total / totals.taxable_total, 2)
  ELSE 0
END
FROM documents d, taxable_totals totals
WHERE d.id = dl.document_id AND totals.document_id = dl.document_id AND dl.taxable;--> statement-breakpoint

-- Backfill FIFO settlement for all existing standalone receipts and payments.
-- Each payment and invoice occupies a range on the contact's running total;
-- the overlap of those ranges is the allocation. This handles every contact in
-- one set operation and leaves excess payments as unallocated credit.
WITH payment_rows AS (
  SELECT d.id, d.company_id, d.contact_id, d.grand_total AS amount,
         CASE WHEN dt.code = 'PAYMENT_RECEIVED' THEN 'SALES_INVOICE'::document_type_code
              ELSE 'PURCHASE_INVOICE'::document_type_code END AS invoice_code,
         coalesce(sum(d.grand_total) OVER (
           PARTITION BY d.company_id, d.contact_id, dt.code
           ORDER BY d.document_date, d.created_at, d.id ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
         ), 0) AS range_start,
         sum(d.grand_total) OVER (
           PARTITION BY d.company_id, d.contact_id, dt.code
           ORDER BY d.document_date, d.created_at, d.id
         ) AS range_end
  FROM documents d
  JOIN document_types dt ON dt.id = d.document_type_id
  WHERE dt.code IN ('PAYMENT_RECEIVED', 'PAYMENT_MADE')
    AND d.contact_id IS NOT NULL AND d.status = 'posted'
), invoice_source AS (
  SELECT d.id, d.company_id, d.contact_id, dt.code,
         greatest(d.grand_total - d.paid_amount, 0) AS balance,
         d.document_date, d.created_at
  FROM documents d
  JOIN document_types dt ON dt.id = d.document_type_id
  WHERE dt.code IN ('SALES_INVOICE', 'PURCHASE_INVOICE')
    AND d.contact_id IS NOT NULL AND d.status = 'posted'
    AND d.grand_total > d.paid_amount
), invoice_rows AS (
  SELECT s.*,
         coalesce(sum(s.balance) OVER (
           PARTITION BY s.company_id, s.contact_id, s.code
           ORDER BY s.document_date, s.created_at, s.id ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
         ), 0) AS range_start,
         sum(s.balance) OVER (
           PARTITION BY s.company_id, s.contact_id, s.code
           ORDER BY s.document_date, s.created_at, s.id
         ) AS range_end
  FROM invoice_source s
), inserted AS (
  INSERT INTO payment_allocations (company_id, payment_document_id, invoice_document_id, amount)
  SELECT p.company_id, p.id, i.id,
         round(least(p.range_end, i.range_end) - greatest(p.range_start, i.range_start), 2)
  FROM payment_rows p
  JOIN invoice_rows i
    ON i.company_id = p.company_id
   AND i.contact_id = p.contact_id
   AND i.code = p.invoice_code
   AND least(p.range_end, i.range_end) > greatest(p.range_start, i.range_start)
  RETURNING invoice_document_id, amount
), allocated AS (
  SELECT invoice_document_id, sum(amount) AS amount
  FROM inserted
  GROUP BY invoice_document_id
)
UPDATE documents d
SET paid_amount = least(d.grand_total, d.paid_amount + allocated.amount),
    is_paid = d.paid_amount + allocated.amount >= d.grand_total,
    updated_at = now()
FROM allocated
WHERE d.id = allocated.invoice_document_id;
