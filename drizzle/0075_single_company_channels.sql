-- Run atomically after a verified backup. No financial document or movement is deleted.
CREATE TABLE sales_channels (
  id text PRIMARY KEY,
  name varchar(100) NOT NULL UNIQUE,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO sales_channels(id,name) VALUES ('counter','Counter Sales'),('balochistan','Balochistan'),('shopify','Shopify');
ALTER TABLE sales_channels ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON sales_channels FROM PUBLIC, anon, authenticated;
ALTER TABLE documents ALTER COLUMN sale_type TYPE text USING sale_type::text;
ALTER TABLE documents ADD CONSTRAINT documents_sale_type_sales_channels_id_fk FOREIGN KEY(sale_type) REFERENCES sales_channels(id);

-- Preserve the original master records and ownership, including conflicting settings.
CREATE TABLE consolidation_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL,
  source_id text NOT NULL,
  target_id text,
  original jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE consolidation_history ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON consolidation_history FROM PUBLIC, anon, authenticated;
CREATE INDEX consolidation_history_kind_source ON consolidation_history(kind,source_id);
INSERT INTO companies(name,short_name) SELECT 'Royal Hardware','RH' WHERE NOT EXISTS(SELECT 1 FROM companies);
CREATE TEMP TABLE company_consolidation ON COMMIT DROP AS
SELECT source.id AS source_id,target.id AS target_id FROM companies source CROSS JOIN companies target
WHERE lower(source.name)='m52' AND lower(target.name)='royal hardware';
INSERT INTO consolidation_history(kind,source_id,target_id,original)
SELECT 'company',c.id::text,m.target_id::text,to_jsonb(c) FROM companies c JOIN company_consolidation m ON m.source_id=c.id;
INSERT INTO consolidation_history(kind,source_id,target_id,original)
SELECT 'document ownership',d.id::text,m.target_id::text,to_jsonb(d) FROM documents d JOIN company_consolidation m ON m.source_id=d.company_id;

-- The same SKU is merged only when its product identity and base unit agree.
-- Rule sets must match, or one side must have no rule; this cannot introduce a conflicting graph.
CREATE TEMP TABLE item_consolidation ON COMMIT DROP AS
SELECT source.id AS source_id,target.id AS target_id
FROM items source JOIN company_consolidation m ON m.source_id=source.company_id
JOIN items target ON target.company_id=m.target_id AND target.sku=source.sku
WHERE lower(trim(source.name))=lower(trim(target.name))
  AND source.base_unit_id IS NOT DISTINCT FROM target.base_unit_id
  AND source.category_id IS NOT DISTINCT FROM target.category_id
  AND source.brand_id IS NOT DISTINCT FROM target.brand_id
  AND source.taxable IS NOT DISTINCT FROM target.taxable
  AND (source.urdu_name IS NULL OR target.urdu_name IS NULL OR source.urdu_name=target.urdu_name)
  AND (
    NOT EXISTS(SELECT 1 FROM item_unit_conversion_rules WHERE item_id=source.id)
    OR NOT EXISTS(SELECT 1 FROM item_unit_conversion_rules WHERE item_id=target.id)
    OR ARRAY(SELECT rule_id FROM item_unit_conversion_rules WHERE item_id=source.id ORDER BY rule_id)
       = ARRAY(SELECT rule_id FROM item_unit_conversion_rules WHERE item_id=target.id ORDER BY rule_id)
  );
INSERT INTO consolidation_history(kind,source_id,target_id,original)
SELECT 'merged product',i.id::text,m.target_id::text,to_jsonb(i) FROM items i JOIN item_consolidation m ON m.source_id=i.id;
INSERT INTO consolidation_history(kind,source_id,target_id,original)
SELECT 'merged product rule',r.item_id::text||':'||r.rule_id::text,m.target_id::text,to_jsonb(r)
FROM item_unit_conversion_rules r JOIN item_consolidation m ON m.source_id=r.item_id;
INSERT INTO item_unit_conversion_rules(item_id,rule_id)
SELECT m.target_id,r.rule_id FROM item_unit_conversion_rules r JOIN item_consolidation m ON m.source_id=r.item_id ON CONFLICT DO NOTHING;
UPDATE items target SET urdu_name=coalesce(target.urdu_name,source.urdu_name),is_active=coalesce(target.is_active,false) OR coalesce(source.is_active,false)
FROM item_consolidation m JOIN items source ON source.id=m.source_id WHERE target.id=m.target_id;
UPDATE document_lines d SET item_id=m.target_id FROM item_consolidation m WHERE d.item_id=m.source_id;
UPDATE market_purchase_requests d SET item_id=m.target_id FROM item_consolidation m WHERE d.item_id=m.source_id;
UPDATE item_images d SET item_id=m.target_id FROM item_consolidation m WHERE d.item_id=m.source_id;
DELETE FROM items i USING item_consolidation m WHERE i.id=m.source_id;
-- Distinct products with an overlapping SKU are retained, with original values in history.
INSERT INTO consolidation_history(kind,source_id,target_id,original)
SELECT 'retained product SKU',i.id::text,i.id::text,to_jsonb(i) FROM items i JOIN company_consolidation m ON m.source_id=i.company_id
WHERE EXISTS(SELECT 1 FROM items target WHERE target.company_id=m.target_id AND target.sku=i.sku);
UPDATE items i SET sku='M52-'||i.sku FROM company_consolidation m WHERE i.company_id=m.source_id
AND EXISTS(SELECT 1 FROM items target WHERE target.company_id=m.target_id AND target.sku=i.sku);

-- Resolve document-type identity before changing company, preserving all document IDs and numbers.
CREATE TEMP TABLE type_consolidation ON COMMIT DROP AS
SELECT source.id AS source_id,target.id AS target_id FROM document_types source
JOIN company_consolidation m ON m.source_id=source.company_id
JOIN document_types target ON target.company_id=m.target_id AND target.code=source.code;
INSERT INTO consolidation_history(kind,source_id,target_id,original)
SELECT 'document type',t.id::text,m.target_id::text,to_jsonb(t) FROM document_types t JOIN type_consolidation m ON m.source_id=t.id;
-- A deleted M52 invoice's tombstone can overlap a live Royal invoice number.
-- Keep the tombstone and its original number in history without renumbering a live invoice.
INSERT INTO consolidation_history(kind,source_id,target_id,original)
SELECT 'numbering tombstone',d.id::text,d.id::text,to_jsonb(d) FROM document_number_ledger d
JOIN type_consolidation t ON t.source_id=d.document_type_id JOIN company_consolidation m ON m.source_id=d.company_id
WHERE d.document_id IS NULL AND EXISTS(SELECT 1 FROM document_number_ledger target WHERE target.company_id=m.target_id AND target.document_type_id=t.target_id AND target.number=d.number);
UPDATE document_number_ledger d SET number='M52-'||d.number
FROM consolidation_history h WHERE h.kind='numbering tombstone' AND h.source_id=d.id::text;
ALTER TABLE documents DROP CONSTRAINT documents_company_document_type_fk;
UPDATE documents d SET document_type_id=t.target_id,company_id=m.target_id FROM type_consolidation t,company_consolidation m WHERE d.document_type_id=t.source_id AND d.company_id=m.source_id;
UPDATE document_number_ledger d SET document_type_id=t.target_id,company_id=m.target_id FROM type_consolidation t,company_consolidation m WHERE d.document_type_id=t.source_id AND d.company_id=m.source_id;
DELETE FROM document_types d USING type_consolidation m WHERE d.id=m.source_id;
UPDATE document_types d SET company_id=m.target_id FROM company_consolidation m WHERE d.company_id=m.source_id;
UPDATE documents d SET company_id=m.target_id FROM company_consolidation m WHERE d.company_id=m.source_id;
UPDATE document_number_ledger d SET company_id=m.target_id FROM company_consolidation m WHERE d.company_id=m.source_id;
ALTER TABLE documents ADD CONSTRAINT documents_company_document_type_fk FOREIGN KEY(company_id,document_type_id) REFERENCES document_types(company_id,id);

CREATE TEMP TABLE category_consolidation ON COMMIT DROP AS
SELECT source.id AS source_id,target.id AS target_id FROM expense_categories source
JOIN company_consolidation m ON m.source_id=source.company_id JOIN expense_categories target ON target.company_id=m.target_id AND target.name=source.name;
INSERT INTO consolidation_history(kind,source_id,target_id,original)
SELECT 'expense category',c.id::text,m.target_id::text,to_jsonb(c) FROM expense_categories c JOIN category_consolidation m ON m.source_id=c.id;
UPDATE expenses e SET expense_category_id=m.target_id FROM category_consolidation m WHERE e.expense_category_id=m.source_id;
DELETE FROM expense_categories c USING category_consolidation m WHERE c.id=m.source_id;
UPDATE expense_categories c SET company_id=m.target_id FROM company_consolidation m WHERE c.company_id=m.source_id;

INSERT INTO consolidation_history(kind,source_id,target_id,original)
SELECT 'setting',s.id::text,m.target_id::text,to_jsonb(s) FROM settings s JOIN company_consolidation m ON m.source_id=s.company_id;
INSERT INTO settings(company_id,key,value) SELECT m.target_id,s.key,s.value FROM settings s JOIN company_consolidation m ON m.source_id=s.company_id ON CONFLICT(company_id,key) DO NOTHING;
DELETE FROM settings s USING company_consolidation m WHERE s.company_id=m.source_id;
-- Keep distinct settlement accounts (and their IDs/balances); rename a colliding drawer only.
INSERT INTO consolidation_history(kind,source_id,target_id,original)
SELECT 'cash account',c.id::text,c.id::text,to_jsonb(c) FROM cash_accounts c JOIN company_consolidation m ON m.source_id=c.company_id;
UPDATE cash_accounts c SET name='M52 - '||c.name FROM company_consolidation m WHERE c.company_id=m.source_id
AND EXISTS(SELECT 1 FROM cash_accounts target WHERE target.company_id=m.target_id AND target.name=c.name);

UPDATE items d SET company_id=m.target_id FROM company_consolidation m WHERE d.company_id=m.source_id;
UPDATE contacts d SET company_id=m.target_id FROM company_consolidation m WHERE d.company_id=m.source_id;
UPDATE document_lines d SET company_id=m.target_id FROM company_consolidation m WHERE d.company_id=m.source_id;
UPDATE inventory_transactions d SET company_id=m.target_id FROM company_consolidation m WHERE d.company_id=m.source_id;
UPDATE ledger_entries d SET company_id=m.target_id FROM company_consolidation m WHERE d.company_id=m.source_id;
UPDATE payment_allocations d SET company_id=m.target_id FROM company_consolidation m WHERE d.company_id=m.source_id;
UPDATE expenses d SET company_id=m.target_id FROM company_consolidation m WHERE d.company_id=m.source_id;
UPDATE bank_accounts d SET company_id=m.target_id FROM company_consolidation m WHERE d.company_id=m.source_id;
UPDATE cash_accounts d SET company_id=m.target_id FROM company_consolidation m WHERE d.company_id=m.source_id;
UPDATE cheque_register d SET company_id=m.target_id FROM company_consolidation m WHERE d.company_id=m.source_id;
UPDATE item_images d SET company_id=m.target_id FROM company_consolidation m WHERE d.company_id=m.source_id;
UPDATE unit_conversions d SET company_id=m.target_id FROM company_consolidation m WHERE d.company_id=m.source_id;
UPDATE market_purchase_requests d SET company_id=m.target_id FROM company_consolidation m WHERE d.company_id=m.source_id;
UPDATE whatsapp_messages d SET company_id=m.target_id FROM company_consolidation m WHERE d.company_id=m.source_id;
UPDATE audit_logs d SET company_id=m.target_id FROM company_consolidation m WHERE d.company_id=m.source_id;
-- A shared contact can have an opening document in each former company.
-- Retain both documents, ledger entries and allocations; keep one editable index pointer.
INSERT INTO consolidation_history(kind,source_id,target_id,original)
SELECT 'opening balance index',d.document_id::text,target.document_id::text,to_jsonb(d)
FROM contact_opening_balances d JOIN company_consolidation m ON m.source_id=d.company_id
JOIN contact_opening_balances target ON target.company_id=m.target_id AND target.contact_id=d.contact_id;
DELETE FROM contact_opening_balances d USING company_consolidation m WHERE d.company_id=m.source_id
AND EXISTS(SELECT 1 FROM contact_opening_balances target WHERE target.company_id=m.target_id AND target.contact_id=d.contact_id);
UPDATE contact_opening_balances d SET company_id=m.target_id FROM company_consolidation m WHERE d.company_id=m.source_id;

-- Preserve every assigned role; company access is automatic for this single-company application.
INSERT INTO consolidation_history(kind,source_id,target_id,original)
SELECT 'user role',r.id::text,m.target_id::text,to_jsonb(r) FROM user_roles r JOIN company_consolidation m ON m.source_id=r.company_id;
DELETE FROM user_roles source USING company_consolidation m WHERE source.company_id=m.source_id
AND EXISTS(SELECT 1 FROM user_roles target WHERE target.company_id=m.target_id AND target.user_id=source.user_id AND target.role_id=source.role_id);
UPDATE user_roles r SET company_id=m.target_id FROM company_consolidation m WHERE r.company_id=m.source_id;
INSERT INTO user_company_access(user_id,company_id) SELECT u.id,c.id FROM users u CROSS JOIN companies c WHERE lower(c.name)='royal hardware' ON CONFLICT DO NOTHING;
DELETE FROM user_company_access a USING company_consolidation m WHERE a.company_id=m.source_id;
DELETE FROM companies c USING company_consolidation m WHERE c.id=m.source_id;
CREATE UNIQUE INDEX companies_single_company ON companies((true));

-- Older non-sales documents belonged to the default channel. Existing sale channel identities stay unchanged.
UPDATE documents SET sale_type='counter' WHERE sale_type IS NULL;
INSERT INTO audit_logs(company_id,user_name,action,entity,summary,detail)
SELECT id,'System migration','merge','company','M52 consolidated into Royal Hardware',
jsonb_build_object('merged_products',(SELECT count(*) FROM item_consolidation),'history_table','consolidation_history','preserved','All documents, lines, movements, balances, contacts and account IDs')::text
FROM companies WHERE lower(name)='royal hardware';
-- Invalidate shared read/session caches in the same commit as the ownership changes.
INSERT INTO cache_revisions(name) VALUES ('sales_channels'),('consolidation_history') ON CONFLICT DO NOTHING;
CREATE TRIGGER erp_cache_revision AFTER INSERT OR UPDATE OR DELETE OR TRUNCATE ON sales_channels FOR EACH STATEMENT EXECUTE FUNCTION erp_bump_cache_revision();
CREATE TRIGGER erp_cache_revision AFTER INSERT OR UPDATE OR DELETE OR TRUNCATE ON consolidation_history FOR EACH STATEMENT EXECUTE FUNCTION erp_bump_cache_revision();
UPDATE cache_revisions SET version=version+1;
