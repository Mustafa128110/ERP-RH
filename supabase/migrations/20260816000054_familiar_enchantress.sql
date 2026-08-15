CREATE INDEX "idx_audit_user" ON "audit_logs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_audit_company" ON "audit_logs" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "idx_cheque_document" ON "cheque_register" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "idx_contacts_company" ON "contacts" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "idx_expenses_company" ON "expenses" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "idx_expenses_document" ON "expenses" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "idx_inventory_company" ON "inventory_transactions" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "idx_ledger_document" ON "ledger_entries" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "idx_ledger_company" ON "ledger_entries" USING btree ("company_id");