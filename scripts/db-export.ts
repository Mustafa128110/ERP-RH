import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { db } from "@/lib/db";

// Recovery artifact before a schema change: every public table, one CSV per
// table, in <cwd>/db-export/<ISO date>/ . Read-only — nothing is written to
// the database. Restore would be the reverse (COPY from CSV); for the additive
// changes this guards, rollback is actually "drop the new object", and the
// export is belt-and-braces.

async function main() {
  const client = db.$client;
  const dir = join(process.cwd(), "db-export", new Date().toISOString().slice(0, 10));
  mkdirSync(dir, { recursive: true });

  const tables = await client<{ name: string }[]>`SELECT tablename AS name FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`;

  let total = 0;
  for (const { name } of tables) {
    const rows = await client.unsafe(`SELECT * FROM "${name}"`);
    const cols = (rows as unknown as { columns: { name: string }[] }).columns.map((c) => c.name);
    const csv = [
      cols.join(","),
      ...rows.map((r) => cols.map((c) => JSON.stringify(r[c] ?? "")).join(",")),
    ].join("\n");
    writeFileSync(join(dir, `${name}.csv`), csv, "utf8");
    total += rows.length;
    console.log(`${name}: ${rows.length} rows`);
  }

  console.log(`\nexported ${tables.length} tables, ${total} rows → ${dir}`);
  await client.end();
}

main().catch((e) => {
  console.error("ERR", e);
  process.exit(1);
});
