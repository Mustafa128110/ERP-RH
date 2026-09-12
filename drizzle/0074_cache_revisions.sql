CREATE TABLE public.cache_revisions (
  name text PRIMARY KEY,
  version bigint NOT NULL DEFAULT 0
);
ALTER TABLE public.cache_revisions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cache_revisions FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
CREATE FUNCTION public.erp_bump_cache_revision() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  INSERT INTO public.cache_revisions(name, version) VALUES (TG_TABLE_NAME, 1)
  ON CONFLICT (name) DO UPDATE SET version = cache_revisions.version + 1;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.erp_bump_cache_revision() FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
DO $$ DECLARE relation record; BEGIN
  FOR relation IN SELECT tablename FROM pg_tables WHERE schemaname = 'public'
    AND tablename NOT IN ('cache_revisions', 'command_receipts', 'submitted_operations', 'audit_logs', 'whatsapp_messages')
    ORDER BY tablename
  LOOP
    INSERT INTO public.cache_revisions(name) VALUES (relation.tablename);
    EXECUTE format('CREATE TRIGGER erp_cache_revision AFTER INSERT OR UPDATE OR DELETE OR TRUNCATE ON public.%I FOR EACH STATEMENT EXECUTE FUNCTION public.erp_bump_cache_revision()', relation.tablename);
  END LOOP;
END $$;

--> statement-breakpoint
-- Child-only writes must advance the editor version of their parent too.
-- Transition tables collect the whole statement: no trigger per invoice line.
CREATE FUNCTION public.erp_touch_edit_parent() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE sources text;
BEGIN
  sources := CASE WHEN TG_OP = 'INSERT' THEN format('SELECT %I AS id FROM new_rows', TG_ARGV[1])
                  WHEN TG_OP = 'DELETE' THEN format('SELECT %I AS id FROM old_rows', TG_ARGV[1])
                  ELSE format('SELECT %I AS id FROM old_rows UNION SELECT %I AS id FROM new_rows', TG_ARGV[1], TG_ARGV[1]) END;
  EXECUTE format('UPDATE public.%I target SET id = target.id FROM (SELECT id FROM public.%I WHERE id IN (%s) ORDER BY id FOR UPDATE) changed WHERE target.id = changed.id', TG_ARGV[0], TG_ARGV[0], sources);
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.erp_touch_edit_parent() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER erp_edit_document_id_insert AFTER INSERT ON public.document_lines REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION public.erp_touch_edit_parent('documents', 'document_id');
CREATE TRIGGER erp_edit_document_id_delete AFTER DELETE ON public.document_lines REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION public.erp_touch_edit_parent('documents', 'document_id');
CREATE TRIGGER erp_edit_document_id_update AFTER UPDATE ON public.document_lines REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION public.erp_touch_edit_parent('documents', 'document_id');
CREATE TRIGGER erp_edit_item_id_insert AFTER INSERT ON public.document_lines REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION public.erp_touch_edit_parent('items', 'item_id');
CREATE TRIGGER erp_edit_item_id_delete AFTER DELETE ON public.document_lines REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION public.erp_touch_edit_parent('items', 'item_id');
CREATE TRIGGER erp_edit_item_id_update AFTER UPDATE ON public.document_lines REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION public.erp_touch_edit_parent('items', 'item_id');
CREATE TRIGGER erp_edit_rule_id_insert AFTER INSERT ON public.item_unit_conversion_rules REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION public.erp_touch_edit_parent('unit_conversions', 'rule_id');
CREATE TRIGGER erp_edit_rule_id_delete AFTER DELETE ON public.item_unit_conversion_rules REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION public.erp_touch_edit_parent('unit_conversions', 'rule_id');
CREATE TRIGGER erp_edit_rule_id_update AFTER UPDATE ON public.item_unit_conversion_rules REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION public.erp_touch_edit_parent('unit_conversions', 'rule_id');
CREATE TRIGGER erp_edit_item_id_insert AFTER INSERT ON public.item_unit_conversion_rules REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION public.erp_touch_edit_parent('items', 'item_id');
CREATE TRIGGER erp_edit_item_id_delete AFTER DELETE ON public.item_unit_conversion_rules REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION public.erp_touch_edit_parent('items', 'item_id');
CREATE TRIGGER erp_edit_item_id_update AFTER UPDATE ON public.item_unit_conversion_rules REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION public.erp_touch_edit_parent('items', 'item_id');
CREATE TRIGGER erp_edit_role_id_insert AFTER INSERT ON public.role_permissions REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION public.erp_touch_edit_parent('roles', 'role_id');
CREATE TRIGGER erp_edit_role_id_delete AFTER DELETE ON public.role_permissions REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION public.erp_touch_edit_parent('roles', 'role_id');
CREATE TRIGGER erp_edit_role_id_update AFTER UPDATE ON public.role_permissions REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION public.erp_touch_edit_parent('roles', 'role_id');
CREATE TRIGGER erp_edit_invoice_document_id_insert AFTER INSERT ON public.payment_allocations REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION public.erp_touch_edit_parent('documents', 'invoice_document_id');
CREATE TRIGGER erp_edit_invoice_document_id_delete AFTER DELETE ON public.payment_allocations REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION public.erp_touch_edit_parent('documents', 'invoice_document_id');
CREATE TRIGGER erp_edit_invoice_document_id_update AFTER UPDATE ON public.payment_allocations REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION public.erp_touch_edit_parent('documents', 'invoice_document_id');
CREATE TRIGGER erp_edit_payment_document_id_insert AFTER INSERT ON public.payment_allocations REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION public.erp_touch_edit_parent('documents', 'payment_document_id');
CREATE TRIGGER erp_edit_payment_document_id_delete AFTER DELETE ON public.payment_allocations REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION public.erp_touch_edit_parent('documents', 'payment_document_id');
CREATE TRIGGER erp_edit_payment_document_id_update AFTER UPDATE ON public.payment_allocations REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION public.erp_touch_edit_parent('documents', 'payment_document_id');
CREATE TRIGGER erp_edit_contact_id_insert AFTER INSERT ON public.documents REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION public.erp_touch_edit_parent('contacts', 'contact_id');
CREATE TRIGGER erp_edit_contact_id_delete AFTER DELETE ON public.documents REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION public.erp_touch_edit_parent('contacts', 'contact_id');
CREATE TRIGGER erp_edit_contact_id_update AFTER UPDATE ON public.documents REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION public.erp_touch_edit_parent('contacts', 'contact_id');
CREATE TRIGGER erp_edit_document_id_insert AFTER INSERT ON public.ledger_entries REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION public.erp_touch_edit_parent('documents', 'document_id');
CREATE TRIGGER erp_edit_document_id_delete AFTER DELETE ON public.ledger_entries REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION public.erp_touch_edit_parent('documents', 'document_id');
CREATE TRIGGER erp_edit_document_id_update AFTER UPDATE ON public.ledger_entries REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION public.erp_touch_edit_parent('documents', 'document_id');
CREATE TRIGGER erp_edit_document_line_id_insert AFTER INSERT ON public.inventory_transactions REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION public.erp_touch_edit_parent('document_lines', 'document_line_id');
CREATE TRIGGER erp_edit_document_line_id_delete AFTER DELETE ON public.inventory_transactions REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION public.erp_touch_edit_parent('document_lines', 'document_line_id');
CREATE TRIGGER erp_edit_document_line_id_update AFTER UPDATE ON public.inventory_transactions REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION public.erp_touch_edit_parent('document_lines', 'document_line_id');
CREATE TRIGGER erp_edit_document_id_insert AFTER INSERT ON public.expenses REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION public.erp_touch_edit_parent('documents', 'document_id');
CREATE TRIGGER erp_edit_document_id_delete AFTER DELETE ON public.expenses REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION public.erp_touch_edit_parent('documents', 'document_id');
CREATE TRIGGER erp_edit_document_id_update AFTER UPDATE ON public.expenses REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION public.erp_touch_edit_parent('documents', 'document_id');
