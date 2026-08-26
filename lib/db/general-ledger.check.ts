import assert from "node:assert/strict";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";

async function main() {
  const rows = await db.execute<{ table_name: string; has_one_sided_check: boolean; has_one_source_check: boolean; has_company_fks: boolean }>(sql`
    SELECT table_name,
           CASE
             WHEN table_name = 'general_ledger_entries' THEN EXISTS (
               SELECT 1 FROM pg_constraint
               WHERE conname = 'general_ledger_entries_debit_credit_check'
             )
             ELSE true
           END AS has_one_sided_check
           , CASE
             WHEN table_name = 'general_ledger_entries' THEN EXISTS (
               SELECT 1 FROM pg_constraint
               WHERE conname = 'general_ledger_entries_one_source_check'
             )
           ELSE true
           END AS has_one_source_check
           , CASE
             WHEN table_name = 'general_ledger_entries' THEN (
               SELECT count(*) = 3 FROM pg_constraint
               WHERE conname IN (
                 'general_ledger_entries_company_account_fk',
                 'general_ledger_entries_company_document_fk',
                 'general_ledger_entries_company_expense_fk'
               )
             )
             ELSE true
           END AS has_company_fks
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name IN ('general_ledger_accounts', 'general_ledger_entries')
  `);
  assert.deepEqual(rows.map((row) => row.table_name).sort(), ["general_ledger_accounts", "general_ledger_entries"]);
  assert.ok(rows.every((row) => row.has_one_sided_check), "each general-ledger entry must have exactly one positive side");
  assert.ok(rows.every((row) => row.has_one_source_check), "each general-ledger entry must identify exactly one source");
  assert.ok(rows.every((row) => row.has_company_fks), "GL sources and accounts must belong to the entry's company");
  const imbalancedSources = await db.execute<{ company_id: string; source_id: string; net: string }>(sql`
    SELECT company_id, coalesce(document_id, expense_id)::text AS source_id,
           sum(debit - credit)::text AS net
    FROM general_ledger_entries
    GROUP BY company_id, document_id, expense_id
    HAVING sum(debit - credit) <> 0
  `);
  assert.equal(imbalancedSources.length, 0, `unbalanced GL source(s): ${imbalancedSources.map((row) => `${row.company_id}/${row.source_id}=${row.net}`).join(", ")}`);
  console.log("general-ledger database checks passed");
}

main();
