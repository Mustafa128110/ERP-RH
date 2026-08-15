import { db } from "@/lib/db";
import { sql } from "drizzle-orm";

// Read-only audit: indexes that exist, row counts, and the columns most
// queried tables are filtered/joined on (so missing index candidates are
// evident). Nothing is written.

const TABLES = [
  "documents",
  "document_lines",
  "document_types",
  "ledger_entries",
  "inventory_transactions",
  "expenses",
  "audit_logs",
  "contacts",
  "items",
  "cheque_register",
  "purchases",
  "sale_payments",
  "stock_movements",
  "users",
  "user_roles",
  "user_company_access",
  "number_sequences",
];

const list = sql.join(TABLES.map((t) => sql`${t}`), sql`, `);

async function main() {
  const indexes = await db.execute<{ table: string; index: string; cols: string }>(sql`
    SELECT t.relname AS table, i.relname AS index,
           array_to_string(array_agg(a.attname ORDER BY k.ordinality), ',') AS cols
    FROM pg_index x
    JOIN pg_class t ON t.oid = x.indrelid
    JOIN pg_class i ON i.oid = x.indexrelid
    JOIN LATERAL unnest(x.indkey) WITH ORDINALITY AS k(attnum, ordinality) ON true
    JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum
    WHERE t.relname IN (${list}) AND t.relkind = 'r'
    GROUP BY t.relname, i.relname
    ORDER BY t.relname, i.relname
  `);
  console.log("=== INDEXES (live DB) ===");
  for (const r of indexes) console.log(`  ${r.table}.${r.index}  (${r.cols})`);

  const counts = await db.execute<{ table: string; n: number }>(sql`
    SELECT relname AS table, n_live_tup::int AS n FROM pg_stat_user_tables
    WHERE relname IN (${list}) ORDER BY n_live_tup DESC
  `);
  console.log("\n=== ROW COUNTS (live DB) ===");
  for (const r of counts) console.log(`  ${r.table}: ${r.n}`);

  const fkCols = await db.execute<{ table: string; col: string; indexed: boolean }>(sql`
    SELECT conrelid::regclass::text AS table, a.attname AS col,
           EXISTS (
             SELECT 1 FROM pg_index x
             WHERE x.indrelid = con.conrelid AND a.attnum = ANY(x.indkey)
           ) AS indexed
    FROM pg_constraint con
    JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = ANY(con.conkey)
    WHERE con.contype = 'f' AND con.conrelid::regclass::text IN (${list})
    ORDER BY 1, 2
  `);
  const missing = fkCols.filter((r) => !r.indexed);
  console.log(`\n=== FK COLUMNS WITHOUT ANY INDEX (${missing.length}) ===`);
  for (const r of missing) console.log(`  ${r.table}.${r.col}`);
  await db.$client.end();
}

main().catch((e) => {
  console.error("ERR", e);
  process.exit(1);
});
