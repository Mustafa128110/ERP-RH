import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { cached, invalidate, invalidateAll } from "./cache";

// Two checks, no database needed:
//
//   1. the cache primitive behaves (dedupes, expires, evicts on failure)
//   2. every action that writes a table behind a cached lookup invalidates it
//
// The second is the one that matters. A broken invalidate() call is a type
// error; a *missing* one is silent, and shows up as a brand you just created
// not appearing in a dropdown for five minutes. This asserts coverage so that
// failure mode can't be introduced quietly.
//
//   npx tsx --conditions=react-server lib/cache.check.ts

async function checkPrimitive() {
  invalidateAll();

  let calls = 0;
  const load = async () => {
    calls++;
    return "value";
  };

  assert.equal(await cached("k", 1000, load), "value");
  assert.equal(await cached("k", 1000, load), "value");
  assert.equal(calls, 1, "second read should hit the cache");

  // Concurrent misses share one in-flight load rather than stampeding.
  invalidateAll();
  calls = 0;
  const slow = async () => {
    calls++;
    await new Promise((r) => setTimeout(r, 20));
    return "shared";
  };
  const all = await Promise.all(Array.from({ length: 12 }, () => cached("burst", 1000, slow)));
  assert.deepEqual(all, Array(12).fill("shared"));
  assert.equal(calls, 1, "twelve concurrent readers should trigger one load");

  // Expiry.
  calls = 0;
  await cached("ttl", 10, load);
  await new Promise((r) => setTimeout(r, 25));
  await cached("ttl", 10, load);
  assert.equal(calls, 2, "entry should reload after its TTL");

  // A failed load must not be cached.
  invalidateAll();
  let attempts = 0;
  const failing = async () => {
    attempts++;
    throw new Error("boom");
  };
  await assert.rejects(() => cached("bad", 1000, failing));
  await assert.rejects(() => cached("bad", 1000, failing));
  assert.equal(attempts, 2, "a rejected load must evict itself");

  // invalidate() clears parameterised variants too.
  invalidateAll();
  calls = 0;
  await cached("cheques", 1000, load);
  await cached("cheques:doc-1", 1000, load);
  invalidate("cheques");
  await cached("cheques", 1000, load);
  await cached("cheques:doc-1", 1000, load);
  assert.equal(calls, 4, "invalidate should clear the key and its variants");

  invalidateAll();
  console.log("ok  cache primitive: dedupe, expiry, failure eviction, prefix invalidation");
}

// Tables that back a cached lookup -> the CACHE key that must be invalidated.
// documents and expenses are here because linking a cheque to either is what
// makes it stop being "available".
const TABLE_TO_KEY: Record<string, string> = {
  companies: "companies",
  categories: "categories",
  brands: "brands",
  locations: "locations",
  units: "units",
  documentTypes: "documentTypes",
  expenseCategories: "expenseCategories",
  items: "items",
  contacts: "contacts",
  bankAccounts: "bankAccounts",
  cashAccounts: "cashAccounts",
  chequeRegister: "cheques",
  documents: "cheques",
  expenses: "cheques",
};

// adjustSettlementBalance only moves a balance column, and no cached lookup
// selects a balance — nothing to invalidate.
//
// resolve-refs.ts is exempt for a different reason: it only ever runs inside
// another action's transaction, creating the item/unit/contact a line named.
// Invalidating from there would drop the cache before the transaction commits,
// so the next reader could repopulate it from data that then rolled back. Its
// callers invalidate after their commit, which is the correct place — and
// cache.check's own coverage rule is what holds them to it.
//
// guard.ts writes nothing; it wraps the actions that do.
const EXEMPT = new Set(["settlement.ts", "resolve-refs.ts", "guard.ts"]);

function checkInvalidationCoverage() {
  const dir = path.join(process.cwd(), "lib/actions");
  let gaps = 0;
  let checked = 0;

  for (const file of fs.readdirSync(dir)) {
    if (EXEMPT.has(file)) continue;
    const src = fs.readFileSync(path.join(dir, file), "utf8");

    // Only mutations count — a bare select never invalidates anything.
    const written = new Set(
      [...src.matchAll(/\.(?:insert|update|delete)\((\w+)\)/g)]
        .map((m) => TABLE_TO_KEY[m[1]])
        .filter(Boolean),
    );
    if (written.size === 0) continue;
    checked++;

    const declared = new Set([...src.matchAll(/CACHE\.(\w+)/g)].map((m) => m[1]));
    const missing = [...written].filter((k) => !declared.has(k));

    if (missing.length) {
      gaps++;
      console.log(`FAIL ${file}: writes tables behind ${missing.join(", ")} but never invalidates them`);
    } else {
      console.log(`ok   ${file.padEnd(22)} invalidates ${[...written].sort().join(", ")}`);
    }
  }

  assert.equal(gaps, 0, `${gaps} action file(s) write a cached table without invalidating it`);
  console.log(`\nok  invalidation coverage: ${checked} mutating action file(s), no gaps`);
}

async function main() {
  await checkPrimitive();
  console.log("");
  checkInvalidationCoverage();
  console.log("\nall cache checks passed");
  process.exit(0);
}

main();
