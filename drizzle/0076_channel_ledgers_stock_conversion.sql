-- Ledger channels, closing checkpoints and stock conversion. All existing entries remain.
ALTER TYPE document_type_code ADD VALUE IF NOT EXISTS 'STOCK_CONVERSION';
ALTER TYPE document_type_code ADD VALUE IF NOT EXISTS 'LEDGER_CLOSING';
ALTER TYPE document_series ADD VALUE IF NOT EXISTS 'LC';
ALTER TYPE document_series ADD VALUE IF NOT EXISTS 'CV';
ALTER TABLE expenses ADD COLUMN sale_type text NOT NULL DEFAULT 'counter' REFERENCES sales_channels(id);
UPDATE expenses e SET sale_type=coalesce(d.sale_type,'counter') FROM documents d WHERE d.id=e.document_id;
ALTER TABLE documents ADD COLUMN ledger_closed_at timestamptz;
UPDATE documents SET sale_type='counter' WHERE sale_type IS NULL;
ALTER TABLE documents ALTER COLUMN sale_type SET DEFAULT 'counter';
ALTER TABLE documents ALTER COLUMN sale_type SET NOT NULL;
CREATE TABLE contact_ledgers (
 company_id uuid NOT NULL REFERENCES companies(id),
 contact_id uuid NOT NULL REFERENCES contacts(id),
 channel_id text NOT NULL REFERENCES sales_channels(id),
 is_active boolean NOT NULL DEFAULT true,
 closed_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(company_id,contact_id,channel_id)
);
ALTER TABLE contact_ledgers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON contact_ledgers FROM PUBLIC,anon,authenticated;
INSERT INTO contact_ledgers(company_id,contact_id,channel_id)
SELECT DISTINCT d.company_id,d.contact_id,coalesce(d.sale_type,'counter') FROM documents d
WHERE d.contact_id IS NOT NULL AND EXISTS(SELECT 1 FROM ledger_entries le WHERE le.document_id=d.id);
CREATE FUNCTION erp_touch_contact_ledger() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 IF NEW.contact_id IS NOT NULL AND EXISTS(SELECT 1 FROM document_types dt WHERE dt.id=NEW.document_type_id AND dt.code::text IN ('SALES_INVOICE','PURCHASE_INVOICE','SALES_RETURN','PURCHASE_RETURN','PAYMENT_RECEIVED','PAYMENT_MADE','OPENING_BALANCE','JOURNAL_ENTRY','MARKET_PURCHASE')) THEN
  INSERT INTO contact_ledgers(company_id,contact_id,channel_id) VALUES(NEW.company_id,NEW.contact_id,coalesce(NEW.sale_type,'counter'))
  ON CONFLICT(company_id,contact_id,channel_id) DO UPDATE SET is_active=true;
 END IF;
 RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION erp_touch_contact_ledger() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER erp_contact_ledger BEFORE INSERT OR UPDATE ON documents FOR EACH ROW EXECUTE FUNCTION erp_touch_contact_ledger();
ALTER TABLE contact_opening_balances ADD COLUMN channel_id text NOT NULL DEFAULT 'counter' REFERENCES sales_channels(id);
UPDATE contact_opening_balances b SET channel_id=coalesce(d.sale_type,'counter') FROM documents d WHERE d.id=b.document_id;
ALTER TABLE contact_opening_balances DROP CONSTRAINT contact_opening_balances_company_id_contact_id_pk;
ALTER TABLE contact_opening_balances ADD CONSTRAINT contact_opening_balances_company_contact_channel_pk PRIMARY KEY(company_id,contact_id,channel_id);
INSERT INTO contact_opening_balances(company_id,contact_id,channel_id,document_id)
SELECT DISTINCT ON(d.company_id,d.contact_id,coalesce(d.sale_type,'counter')) d.company_id,d.contact_id,coalesce(d.sale_type,'counter'),d.id
FROM documents d JOIN document_types dt ON dt.id=d.document_type_id
WHERE dt.code='OPENING_BALANCE' AND d.contact_id IS NOT NULL AND d.status='posted'
ORDER BY d.company_id,d.contact_id,coalesce(d.sale_type,'counter'),d.created_at,d.id
ON CONFLICT DO NOTHING;
CREATE INDEX documents_contact_channel ON documents(company_id,contact_id,sale_type);
-- A closing checkpoint retains its source figures. Corrections are new entries;
-- changing a channel or descriptive note is still allowed for ledger merges.
CREATE FUNCTION erp_protect_closed_document() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 IF OLD.ledger_closed_at IS NOT NULL THEN
  IF TG_OP='DELETE' THEN
   RAISE EXCEPTION USING ERRCODE='P0076',MESSAGE='Closed ledger history is retained';
  END IF;
  IF (to_jsonb(NEW)-ARRAY['sale_type','updated_at','reason']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['sale_type','updated_at','reason']) THEN
   RAISE EXCEPTION USING ERRCODE='P0076',MESSAGE='Closed ledger history is retained';
  END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION erp_protect_closed_document() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER erp_closed_document BEFORE UPDATE OR DELETE ON documents FOR EACH ROW EXECUTE FUNCTION erp_protect_closed_document();
CREATE FUNCTION erp_protect_closed_entry() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM documents d WHERE d.id=OLD.document_id AND d.ledger_closed_at IS NOT NULL)
 OR (TG_OP<>'DELETE' AND EXISTS(SELECT 1 FROM documents d WHERE d.id=NEW.document_id AND d.ledger_closed_at IS NOT NULL)) THEN
  RAISE EXCEPTION USING ERRCODE='P0076',MESSAGE='Closed ledger history is retained';
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION erp_protect_closed_entry() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER erp_closed_entry BEFORE UPDATE OR DELETE ON ledger_entries FOR EACH ROW EXECUTE FUNCTION erp_protect_closed_entry();
INSERT INTO cache_revisions(name) VALUES('contact_ledgers') ON CONFLICT DO NOTHING;
CREATE TRIGGER erp_cache_revision AFTER INSERT OR UPDATE OR DELETE OR TRUNCATE ON contact_ledgers FOR EACH STATEMENT EXECUTE FUNCTION erp_bump_cache_revision();
UPDATE cache_revisions SET version=version+1;
INSERT INTO audit_logs(company_id,user_name,action,entity,summary,detail)
SELECT id,'System migration','update','ledger','Channel ledgers and closing checkpoints enabled','All existing documents, entries, allocations and stock movements retained.' FROM companies;
