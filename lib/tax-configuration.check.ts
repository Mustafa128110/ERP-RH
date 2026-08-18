import "server-only";
import assert from "node:assert/strict";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";

async function main() {
  const [row] = await db.execute<{
    configured: number;
    legacy_snapshots: number;
    invalid_tax_links: number;
  }>(sql`
    SELECT
      count(*) FILTER (WHERE d.tax_id IS NOT NULL)::int AS configured,
      count(*) FILTER (WHERE d.tax_id IS NULL AND d.tax_total > 0)::int AS legacy_snapshots,
      count(*) FILTER (WHERE d.tax_id IS NOT NULL AND t.id IS NULL)::int AS invalid_tax_links
    FROM documents d
    LEFT JOIN taxes t ON t.id = d.tax_id
  `);
  assert.equal(row?.invalid_tax_links, 0, "every configured document tax must resolve to its master row");
  console.log(`tax-configuration checks passed (${row?.configured ?? 0} configured document(s), ${row?.legacy_snapshots ?? 0} preserved legacy snapshot(s))`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
