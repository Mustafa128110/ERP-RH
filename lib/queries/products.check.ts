import assert from "node:assert/strict";
import { db } from "@/lib/db";
import { companies } from "@/lib/db/schema";
import { queryProductRates } from "@/lib/queries/products";

// Runs the actual products list query against a real database.
//
//   npx tsx --conditions=react-server --env-file=.env lib/queries/products.check.ts
//
// This exists because the query shipped broken: two joins carried the alias `s`
// (`42712: table name "s" specified more than once`) and the page threw on every
// load. It had been "verified" by pasting the SQL into a scratch script and
// editing the aliases while doing so — so the copy ran and the real query never
// did. Importing the query is the only way that class of mistake gets caught.

async function main() {
  const companyRows = await db.select({ id: companies.id, name: companies.name }).from(companies).orderBy(companies.name);
  assert.ok(companyRows.length > 0, "no companies in the database — nothing to scope to");
  const ids = companyRows.map((c) => c.id);

  const rows = await queryProductRates(ids);
  console.log(`ok   products list ran: ${rows.length} row(s) across ${companyRows.length} compan(ies)`);

  // No company access must mean no products — items.company_id is NOT NULL, so
  // there is no global product to leak.
  assert.deepEqual(await queryProductRates([]), [], "an empty scope must return no products");
  console.log("ok   empty scope returns nothing");

  if (rows.length > 0) {
    // Every field the hover panel reads has to actually arrive, or the panel
    // renders a column of "undefined" and nobody knows why.
    for (const row of rows.slice(0, 25)) {
      for (const key of ["id", "name", "sku", "company"] as const) {
        assert.ok(row[key] !== undefined && row[key] !== null, `row ${row.id}: ${key} missing`);
      }
      for (const key of ["categoryId", "category", "brand", "onHand", "purchaseRate1", "salesRate", "ruleIds"] as const) {
        assert.ok(key in row, `row ${row.id}: ${key} absent from the result shape`);
      }
      assert.ok(Array.isArray(row.ruleIds), `row ${row.id}: ruleIds must be an array for the setup-dot column`);
      assert.equal(new Set(row.ruleIds).size, row.ruleIds.length, `row ${row.id}: a rule dot was returned more than once`);
      if (row.onHand !== null) {
        assert.ok(Number.isFinite(Number(row.onHand)), `row ${row.id}: onHand "${row.onHand}" is not a number`);
      }
    }
    console.log("ok   every column the hover panel reads is present");

    // Scoping to one company must never return another's products.
    if (companyRows.length > 1) {
      const first = await queryProductRates([ids[0]]);
      const names = new Set(first.map((r) => r.company));
      assert.ok(names.size <= 1, `scoping to one company returned ${[...names].join(", ")}`);
      console.log(`ok   scope narrows correctly (${companyRows[0].name}: ${first.length} row(s))`);
    }
  }

  console.log("\nall product query checks passed");
  await db.$client.end();
}

void main().catch(async (e) => {
  console.error(e);
  await db.$client.end().catch(() => {});
  process.exitCode = 1;
});
