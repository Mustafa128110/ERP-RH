ALTER TABLE "documents" ADD CONSTRAINT "documents_company_id_id_unique" UNIQUE("company_id","id");--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_company_id_id_unique" UNIQUE("company_id","id");--> statement-breakpoint
ALTER TABLE "general_ledger_accounts" ADD CONSTRAINT "general_ledger_accounts_company_id_id_unique" UNIQUE("company_id","id");--> statement-breakpoint
ALTER TABLE "general_ledger_entries" ADD CONSTRAINT "general_ledger_entries_company_account_fk" FOREIGN KEY ("company_id","account_id") REFERENCES "public"."general_ledger_accounts"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "general_ledger_entries" ADD CONSTRAINT "general_ledger_entries_company_document_fk" FOREIGN KEY ("company_id","document_id") REFERENCES "public"."documents"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "general_ledger_entries" ADD CONSTRAINT "general_ledger_entries_company_expense_fk" FOREIGN KEY ("company_id","expense_id") REFERENCES "public"."expenses"("company_id","id") ON DELETE no action ON UPDATE no action;
