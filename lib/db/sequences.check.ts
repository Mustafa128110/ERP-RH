import assert from "node:assert/strict";
import { eq, inArray } from "drizzle-orm";
import { db } from "./index";
import { numberSequences } from "./schema";
import { SKU_SCOPE, documentScope, formatSku, nextSequenceValue, peekSequenceValue } from "./sequences";

// The reason number_sequences exists is that "read the count, add one" hands two
// concurrent creates the same invoice number. So the check that matters is the
// concurrent one: fire allocations in parallel and assert every value is
// distinct. Uses throwaway scopes and cleans up after itself.
//
//   npx tsx --conditions=react-server --env-file=.env lib/db/sequences.check.ts
//
// Stop the dev/prod server first. Session mode caps this project at 15
// connections in total, and a running server holds most of them — the
// concurrency test below will otherwise fail with EMAXCONNSESSION rather than
// on anything it is actually checking.

const scopes: string[] = [];
const scope = (name: string) => {
  const s = `test:${name}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
  scopes.push(s);
  return s;
};

async function main() {
  // Starts at 1 and increments by 1.
  const a = scope("basic");
  assert.equal(await peekSequenceValue(a), 1, "an unused scope should peek at 1");
  assert.equal(await nextSequenceValue(a), 1);
  assert.equal(await nextSequenceValue(a), 2);
  assert.equal(await nextSequenceValue(a), 3);
  assert.equal(await peekSequenceValue(a), 4, "peek should report the next unissued value");
  console.log("ok  allocates 1,2,3 and peeks 4");

  // Peeking must not consume.
  const b = scope("peek");
  assert.equal(await peekSequenceValue(b), 1);
  assert.equal(await peekSequenceValue(b), 1);
  assert.equal(await nextSequenceValue(b), 1, "peeking must not have consumed anything");
  console.log("ok  peek does not consume");

  // The one that matters: 25 concurrent allocations, no duplicates, no gaps.
  const c = scope("concurrent");
  const values = await Promise.all(Array.from({ length: 25 }, () => nextSequenceValue(c)));
  const unique = new Set(values);
  assert.equal(unique.size, 25, `25 concurrent allocations produced ${unique.size} distinct values: ${values.join(",")}`);
  assert.deepEqual([...unique].sort((x, y) => x - y), Array.from({ length: 25 }, (_, i) => i + 1), "should be exactly 1..25");
  console.log("ok  25 concurrent allocations: all distinct, no gaps");

  // Scopes are independent.
  const d = scope("iso-1");
  const e = scope("iso-2");
  await nextSequenceValue(d);
  await nextSequenceValue(d);
  assert.equal(await nextSequenceValue(e), 1, "a different scope must have its own counter");
  console.log("ok  scopes are independent");

  // Rolling back the transaction that allocated must return the number.
  const f = scope("rollback");
  assert.equal(await nextSequenceValue(f), 1);
  await assert.rejects(
    db.transaction(async (tx) => {
      await nextSequenceValue(f, tx);
      throw new Error("rollback");
    }),
  );
  assert.equal(await nextSequenceValue(f), 2, "a rolled-back allocation must not burn a number");
  console.log("ok  rolled-back allocation returns its number");

  // Formatting, and that document scopes don't collide with the SKU scope.
  assert.equal(formatSku(1), "RH-00001");
  assert.equal(formatSku(42), "RH-00042");
  assert.equal(formatSku(99999), "RH-99999");
  assert.notEqual(documentScope("SI"), documentScope("PI"), "different series must have their own counters");
  assert.notEqual(documentScope("SI"), SKU_SCOPE);
  // The point of keying on series: every company shares one SI run, so there is
  // nothing company-specific left in the key to make two of them.
  assert.equal(documentScope("SI"), "doc:SI");
  console.log("ok  SKU format and scope keys");

  await db.delete(numberSequences).where(inArray(numberSequences.scope, scopes));
  const leftover = await db.select().from(numberSequences).where(eq(numberSequences.scope, scopes[0]));
  assert.equal(leftover.length, 0, "test scopes should be cleaned up");
  console.log("ok  cleaned up test scopes");

  console.log("\nall sequence checks passed");
  process.exit(0);
}

main();
