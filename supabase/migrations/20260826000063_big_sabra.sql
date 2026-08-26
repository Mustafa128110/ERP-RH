ALTER TABLE "general_ledger_entries" ALTER COLUMN "document_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "general_ledger_entries" ADD COLUMN "expense_id" uuid;--> statement-breakpoint
ALTER TABLE "general_ledger_entries" ADD CONSTRAINT "general_ledger_entries_expense_id_expenses_id_fk" FOREIGN KEY ("expense_id") REFERENCES "public"."expenses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_gl_entries_expense" ON "general_ledger_entries" USING btree ("expense_id");--> statement-breakpoint
ALTER TABLE "general_ledger_entries" ADD CONSTRAINT "general_ledger_entries_one_source_check" CHECK (("general_ledger_entries"."document_id" IS NULL) <> ("general_ledger_entries"."expense_id" IS NULL));