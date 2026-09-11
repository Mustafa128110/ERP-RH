import assert from "node:assert/strict";
import { sql } from "drizzle-orm";
import { database, db } from "./db";
import { commandContext } from "./db/command-context";
import { withCommandReceipt, ReceiptConflict } from "./command-receipt";
import { commandRevisionsMatch } from "./command-revisions";

// Temporary tables shadow the production table names on this connection only.
// The enclosing transaction is rolled back; no business records are touched.
async function main() {
  assert.equal(db.$client, database.$client, "the database proxy preserves the callable driver's properties");
  assert.equal(typeof db.$client.end, "function");
  const rollback = new Error("rollback temporary checks");
  try {
    await database.transaction(async tx => {
      await tx.execute(sql`CREATE TEMP TABLE command_receipts (id uuid PRIMARY KEY, user_id uuid NOT NULL, action text NOT NULL, payload_hash text NOT NULL, result jsonb) ON COMMIT DROP`);
      await tx.execute(sql`CREATE TEMP TABLE receipt_probe (value integer NOT NULL) ON COMMIT DROP`);
      await tx.execute(sql`INSERT INTO receipt_probe VALUES (0)`);
      const actor = crypto.randomUUID();
      const command = { id: crypto.randomUUID(), action: "test.create", args: ["original"] };
      const work = async () => {
        // Exercise the same nested transaction routing existing actions use.
        await commandContext.run({ database: tx, afterCommit: [] }, () => db.transaction(async nested => {
          await nested.execute(sql`UPDATE receipt_probe SET value = value + 1`);
        }));
        return { success: true, id: crypto.randomUUID(), number: "TEST-1" };
      };
      const first = await withCommandReceipt(tx, command, actor, work);
      const replay = await withCommandReceipt(tx, command, actor, work);
      assert.deepEqual(replay, first, "lost-response replay returns the original canonical ID and number");
      let [counter] = await tx.execute<{ value: number }>(sql`SELECT value FROM receipt_probe`);
      assert.equal(counter.value, 1, "replay must not execute any business writes");
      await assert.rejects(withCommandReceipt(tx, { ...command, args: ["different"] }, actor, work), ReceiptConflict);
      await assert.rejects(withCommandReceipt(tx, command, crypto.randomUUID(), work), ReceiptConflict);
      const failing = { ...command, id: crypto.randomUUID() };
      await assert.rejects(tx.transaction(async nested => withCommandReceipt(nested, failing, actor, async () => {
        await nested.execute(sql`UPDATE receipt_probe SET value = value + 100`);
        throw new Error("simulated validation failure");
      })), /simulated validation failure/);
      [counter] = await tx.execute<{ value: number }>(sql`SELECT value FROM receipt_probe`);
      assert.equal(counter.value, 1, "failed actions roll back all their writes");
      const [count] = await tx.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM command_receipts WHERE id = ${failing.id}::uuid`);
      assert.equal(count.n, 0, "a failed action cannot leave a committed receipt");
      await withCommandReceipt(tx, failing, actor, work);
      await tx.execute(sql`CREATE TEMP TABLE revision_probe (id uuid PRIMARY KEY, name text) ON COMMIT DROP`);
      const recordId = crypto.randomUUID();
      await tx.execute(sql`INSERT INTO revision_probe VALUES (${recordId}::uuid, 'original')`);
      const [base] = await tx.execute<{ revision: string }>(sql`SELECT xmin::text AS revision FROM revision_probe`);
      const expected: [string, string][] = [[`revision_probe:${recordId}`, base.revision]];
      assert.equal(await commandRevisionsMatch(tx, "revision_probe", expected), true);
      await tx.transaction(async nested => { await nested.execute(sql`UPDATE revision_probe SET name = 'newer edit'`); });
      assert.equal(await commandRevisionsMatch(tx, "revision_probe", expected), false, "stale master edits must be refused after another row version exists");
      assert.equal(await commandRevisionsMatch(tx, "revision_probe", [[`revision_probe:${crypto.randomUUID()}`, base.revision]]), false, "deleted records cannot be silently recreated by an edit");
      console.log("Database receipt checks passed: canonical replay, payload/account isolation, nested action transactions, atomic rollback and retry");
      throw rollback;
    });
  } catch (error) { if (error !== rollback) throw error; }
}
void main();
