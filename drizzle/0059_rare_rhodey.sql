DROP INDEX "idx_market_purchase_status_company";--> statement-breakpoint
CREATE INDEX "idx_document_lines_item_document_line" ON "document_lines" USING btree ("item_id","document_id","line_no" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_documents_company_type_date" ON "documents" USING btree ("company_id","document_type_id","document_date" DESC NULLS LAST,"created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_market_purchase_company_status_created" ON "market_purchase_requests" USING btree ("company_id","status","created_at" DESC NULLS LAST);