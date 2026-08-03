import assert from "node:assert/strict";
import { db } from "@/lib/db";
import { companies } from "@/lib/db/schema";
import { REPORT_TYPES } from "@/lib/report-constants";
import { queryReport, reportScope } from "@/lib/queries/reports";

// Runs every report against the real database. This is the only thing that can
// tell you a report references a column that doesn't exist — the pages need a
// session to reach, TypeScript can't see inside a sql`` template, and the first
// run of a broken report would otherwise be someone opening it.
//
//   npx tsx --conditions=react-server --env-file=.env lib/queries/reports.check.ts
//
// It imports the queries rather than restating them, so it cannot drift from
// what the app actually runs. That split is why lib/queries/reports.ts exists
// separately from lib/actions/reports.ts: the SQL takes a scope, and only the
// action needs a session to build one.

// A range wide enough that every report returns whatever the database holds —
// this is checking that the statements run, not what they say.
const FILTERS = { from: "2000-01-01", to: "2100-01-01" };

async function main() {
  const companyRows = await db.select({ id: companies.id, name: companies.name }).from(companies).orderBy(companies.name);
  assert.ok(companyRows.length > 0, "no companies in the database — nothing to report on");
  console.log(`companies: ${companyRows.map((c) => c.name).join(", ")}\n`);

  const scope = reportScope(
    companyRows.map((c) => c.id),
    FILTERS,
  );
  assert.ok(scope, "reportScope returned nothing for a non-empty company list");

  let failures = 0;
  for (const { slug, label } of REPORT_TYPES) {
    try {
      const result = await queryReport(slug, scope);
      // Every row has to carry every column the table will try to render, or
      // the page shows a column of dashes and nobody knows why.
      for (const row of result.rows.slice(0, 5)) {
        for (const column of result.columns) {
          assert.ok(column.key in row, `${slug}: rows are missing the "${column.key}" column`);
        }
      }
      // Totals are only meaningful over columns marked money or qty.
      if (result.totals) {
        for (const [key, value] of Object.entries(result.totals)) {
          assert.ok(Number.isFinite(Number(value)), `${slug}: total for "${key}" is not a number (${value})`);
        }
      }
      console.log(`ok   ${label.padEnd(24)} ${result.rows.length} row(s), ${result.columns.length} column(s)`);
    } catch (e) {
      failures++;
      console.log(`FAIL ${label.padEnd(24)} ${(e as Error).message.split("\n")[0]}`);
    }
  }

  // Scoping to one company must never widen past it, and an unknown company id
  // must be ignored rather than trusted.
  const single = reportScope([companyRows[0].id], { ...FILTERS, company: companyRows[0].id });
  assert.equal(single?.company, companyRows[0].id);
  const forged = reportScope([companyRows[0].id], { ...FILTERS, company: "00000000-0000-0000-0000-000000000000" });
  assert.equal(forged?.company, null, "a company id outside the user's access must be ignored");
  assert.equal(reportScope([], FILTERS), null, "no company access means no report");

  // A company id that exists but isn't in the passed set must not appear in the
  // scope — this is the whole boundary the action relies on.
  if (companyRows.length > 1) {
    const narrowed = reportScope([companyRows[0].id], { ...FILTERS, company: companyRows[1].id });
    assert.equal(narrowed?.company, null, "scoping must intersect with what was granted, not replace it");
  }

  assert.equal(failures, 0, `${failures} report(s) failed to run`);
  console.log(`\nall ${REPORT_TYPES.length} reports ran, scope rules hold`);

  // Leaves the connection pool closed so the script exits rather than hanging on
  // an idle socket.
  await db.$client.end();
}

void main().catch(async (e) => {
  console.error(e);
  await db.$client.end().catch(() => {});
  process.exitCode = 1;
});
