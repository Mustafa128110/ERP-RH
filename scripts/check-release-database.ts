import assert from "node:assert/strict";
import postgres from "postgres";

// Read-only release inspection. Print schema evidence, never connection secrets
// or customer records. Deliberately refuse an unexpected production project.
async function main() {
const ref = "gvneuhadkktmhoxaazzg";
const connection = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
assert.ok(connection, "Database connection is missing");
const url = new URL(connection);
assert.ok(url.hostname === `db.${ref}.supabase.co` || decodeURIComponent(url.username) === `postgres.${ref}`, "Database target is not ERP-System (Singapore)");
assert.equal(new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!).hostname, `${ref}.supabase.co`);
const db = postgres(connection, { max: 1, connect_timeout: 10 });
try {
  const columns = await db`SELECT table_name, column_name FROM information_schema.columns WHERE table_schema='public' AND
    ((table_name='unit_conversions' AND column_name IN ('item_id','name','created_at','updated_at')) OR
     (table_name IN ('bank_accounts','cash_accounts') AND column_name='general_ledger_account_id') OR table_name='command_receipts') ORDER BY table_name, ordinal_position`;
  const tables = await db`SELECT c.relname AS name, c.relrowsecurity AS rls FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname IN ('command_receipts','item_unit_conversion_rules','general_ledger_accounts','general_ledger_entries') ORDER BY c.relname`;
  const constraints = await db`SELECT conname AS name FROM pg_constraint WHERE conname IN ('taxes_rate_check','unit_conversions_different_units_check','item_unit_conversion_rules_item_id_item_id_fk','item_unit_conversion_rules_item_id_items_id_fk','item_unit_conversion_rules_rule_id_unit_conversions_id_fk') ORDER BY conname`;
  const versions = await db`SELECT version FROM supabase_migrations.schema_migrations ORDER BY version DESC LIMIT 12`;
  console.log(JSON.stringify({ project: ref, columns, tables, constraints, versions }, null, 2));
} finally { await db.end(); }
}
void main();
