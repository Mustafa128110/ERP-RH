-- Stock adjustments have to record WHY stock moved (FR-AUDIT-001: adjustments
-- and deletes require a reason), and nothing on documents could hold it — there
-- was no free-text column at all. One nullable column, filled by stock
-- adjustments and left NULL by every other document type.
ALTER TABLE "documents" ADD COLUMN "reason" varchar(100);
