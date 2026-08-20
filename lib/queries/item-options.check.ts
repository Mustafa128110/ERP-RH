import assert from "node:assert/strict";
import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { companies, items } from "@/lib/db/schema";
import { queryItemOptions } from "@/lib/queries/item-options";

async function main() {
  const [all, countRows, companyRows] = await Promise.all([
    queryItemOptions(sql`true`),
    db.select({ count: sql<number>`count(*)::int` }).from(items),
    db.select({ id: companies.id }).from(companies).limit(1),
  ]);

  assert.equal(all.length, countRows[0]?.count ?? 0, "the option query returns every item exactly once");
  assert.equal(new Set(all.map((row) => row.id)).size, all.length, "item options contain no duplicates");
  assert.ok(all.every((row) => typeof row.taxable === "boolean"), "taxability keeps its boolean form");

  const companyId = companyRows[0]?.id;
  if (companyId) {
    const scoped = await queryItemOptions(eq(items.companyId, companyId));
    assert.ok(scoped.every((row) => row.companyId === companyId), "company scope cannot leak another company's item");
  }

  console.log(`item option query checks passed (${all.length} item(s))`);
  await db.$client.end();
}

void main().catch(async (error) => {
  console.error(error);
  await db.$client.end().catch(() => {});
  process.exitCode = 1;
});
