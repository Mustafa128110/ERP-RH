-- A universal document's subtype must come from the same company. The old
-- single-column FK proved only that the type id existed, allowing application
-- mistakes or direct SQL to attach company A's number series and behavior flags
-- to company B's document.
ALTER TABLE "document_types"
  ADD CONSTRAINT "document_types_company_id_id_unique" UNIQUE("company_id", "id");--> statement-breakpoint

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM "documents" d
      JOIN "document_types" dt ON dt."id" = d."document_type_id"
     WHERE dt."company_id" <> d."company_id"
  ) THEN
    RAISE EXCEPTION 'documents contain company/document-type mismatches; repair them before applying 0056';
  END IF;
END $$;--> statement-breakpoint

ALTER TABLE "documents"
  ADD CONSTRAINT "documents_company_document_type_fk"
  FOREIGN KEY ("company_id", "document_type_id")
  REFERENCES "document_types"("company_id", "id")
  ON DELETE NO ACTION ON UPDATE NO ACTION;
