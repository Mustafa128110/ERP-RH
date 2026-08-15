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

  // --- Pruning: the 24-hour sweep is part of the claiming statement -----------
  // A key older than the retention window is dead weight — it can never be a
  // retry (the form that held it is long gone), so claiming under it again is a
  // genuinely new operation, not a replay. The prune must also never touch a
  // fresh claim: the DELETE is bounded to created_at < now() - 24h, so a claim
  // made just now cannot be swept by the same statement that just made it.
  const d = crypto.randomUUID();
  await db.execute(sql`INSERT INTO submitted_operations (key, created_at) VALUES (${d}, now() - interval '25 hours')`);
  const staleReclaim = await db.transaction(async (tx) => claimOperation(tx, d));
  assert.equal(staleReclaim, true, "an id older than the retention window is pruned and claimable again");
  assert.equal(
    await countKeys(d),
    1,
    "the prune must have deleted the stale row and left exactly the fresh claim",
  );

  // --- A fresh claim survives its own claiming statement's prune ---------------
  const e = crypto.randomUUID();
  await db.transaction(async (tx) => claimOperation(tx, e));
  assert.equal(await countKeys(e), 1, "a just-claimed id must not be pruned by the claiming statement");
  const eReplay = await db.transaction(async (tx) => claimOperation(tx, e));
  assert.equal(eReplay, false, "the fresh claim must still refuse a replay");

  // --- Concurrent claims: two in-flight submits of the same operation ---------
  // Exactly one can win. The unique index serialises them; the loser's
  // ON CONFLICT DO NOTHING sees the winner's committed row and refuses.
  const f = crypto.randomUUID();
  const [r1, r2] = await Promise.all([
    db.transaction(async (tx) => claimOperation(tx, f)),
    db.transaction(async (tx) => claimOperation(tx, f)),
  ]);
  assert.equal([r1, r2].filter(Boolean).length, 1, "concurrent claims of the same id: exactly one wins");

  // --- Cleanup: only our own keys, nothing the app's users ever sent ----------
  await db.execute(sql`DELETE FROM submitted_operations WHERE key IN (${sql.join([sql`${a}`, sql`${b}`, sql`${c}`, sql`${d}`, sql`${e}`, sql`${f}`], sql`, `)})`);
  assert.equal(await countKeys(a, b, c, d, e, f), 0, "test keys must be cleaned up");

  console.log("ok   claim: fresh id claimed, replay refused, fresh id claimed again");
  console.log("ok   claim: rolled-back claim vanishes, retry goes through");
  console.log("ok   claim: 24h prune sweeps only stale keys; a fresh claim is untouched");
  console.log("ok   claim: concurrent claims of one id — exactly one wins");
  console.log("\nall operation-id checks passed");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
