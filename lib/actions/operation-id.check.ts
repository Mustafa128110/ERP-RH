import assert from "node:assert/strict";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { claimOperation } from "./operation-id";

// The rule this file exists to hold: a submitted operation id is claimed at
// most once, for as long as the transaction that claimed it lives. That is
// what makes a replayed save a no-op while a retried failure still works —
// the whole duplicate-submission protection in lib/actions/operation-id.ts.
//
// Runs against the real database (the table lives there):
//
//   npx tsx --conditions=react-server --env-file=.env lib/actions/operation-id.check.ts

// One round trip, same as the claiming statement: prune anything the last run
// left behind, then take the count.
async function countKeys(...keys: string[]): Promise<number> {
  const [row] = await db.execute<{ n: string }>(sql`
    WITH pruned AS (
      DELETE FROM submitted_operations WHERE created_at < now() - interval '24 hours'
    )
    SELECT count(*)::text AS n FROM submitted_operations WHERE key IN (${sql.join(
      keys.map((k) => sql`${k}`),
      sql`, `,
    )})
  `);
  return Number(row?.n ?? 0);
}

async function main() {
  const a = crypto.randomUUID();
  const b = crypto.randomUUID();

  // --- A fresh id is claimed; the same id again is refused -------------------
  const first = await db.transaction(async (tx) => claimOperation(tx, a));
  assert.equal(first, true, "a fresh id must be claimable");
  const replay = await db.transaction(async (tx) => claimOperation(tx, a));
  assert.equal(replay, false, "the same id must not be claimable twice");

  // --- A different id is a different operation --------------------------------
  const other = await db.transaction(async (tx) => claimOperation(tx, b));
  assert.equal(other, true, "a different id must claim independently");
  assert.equal(await countKeys(a, b), 2, "both committed claims must persist");

  // --- A rolled-back transaction takes its claim with it ----------------------
  // This is what makes retrying a genuine failure safe: the claim lives inside
  // the transaction that guards the record, so a failed save leaves nothing
  // behind to trip the retry.
  const c = crypto.randomUUID();
  const failed = await db
    .transaction(async (tx) => {
      await claimOperation(tx, c);
      throw new Error("simulated failure");
    })
    .catch((e) => e);
  assert.ok(failed instanceof Error, "the simulated failure must have thrown");
  assert.equal(await countKeys(c), 0, "the rolled-back claim must be gone");

  // --- And the retry of the failed operation goes through ---------------------
  const retry = await db.transaction(async (tx) => claimOperation(tx, c));
  assert.equal(retry, true, "an id whose claim rolled back must be claimable again");

  // --- Cleanup: only our own keys, nothing the app's users ever sent ----------
  await db.execute(sql`DELETE FROM submitted_operations WHERE key IN (${sql.join([sql`${a}`, sql`${b}`, sql`${c}`], sql`, `)})`);
  assert.equal(await countKeys(a, b, c), 0, "test keys must be cleaned up");

  console.log("ok   claim: fresh id claimed, replay refused, fresh id claimed again");
  console.log("ok   claim: rolled-back claim vanishes, retry goes through");
  console.log("\nall operation-id checks passed");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
