-- is_paid was a boolean: a sale was either settled in full or not at all, with
-- nowhere to record "customer paid 2000 of 3500". paid_amount is how much of the
-- document's grand total has actually come in; is_paid stays as the derived
-- shorthand for paid_amount >= grand_total, so every existing reader keeps working.
ALTER TABLE "documents" ADD COLUMN "paid_amount" numeric(18, 2) DEFAULT '0' NOT NULL;
--> statement-breakpoint
-- Everything already marked paid was paid in full by definition — without this
-- backfill, editing an old paid sale would reverse a settlement of 0.
UPDATE "documents" SET "paid_amount" = "grand_total" WHERE "is_paid" = true;
