// Offline check for the offline-readiness dependency set (lib/offline-
// readiness.ts). The claim the feature makes is that OFFLINE_KINDS is exactly
// the reference data the three offline-supported workflows need. That claim is
// derived from the code, not asserted from memory: every useCachedOptions
// ("kind", …) call in the quotation/expense/payment managers must be covered by
// the set, and the set must be exactly the documented union. If a form starts
// caching another kind, this check fails and the set is updated deliberately —
// an unprepared form dependency would silently ship an offline form with an
// empty picker.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { OFFLINE_KINDS, OFFLINE_WORKFLOWS } from "./offline-readiness";

// The documented, minimal union. Sorted for a stable comparison; if a form's
// picker starts reading a new reference kind, add it here AND in the workflows
// constant — the assertions below force both to stay in sync.
const EXPECTED = [
  "bankAccounts",
  "cashAccounts",
  "cheques",
  "companies",
  "contacts",
  "customers",
  "expenseCategories",
  "items",
  "units",
];

function main() {
  assert.deepEqual(
    [...OFFLINE_KINDS].sort(),
    EXPECTED,
    "offline readiness kinds must be exactly the documented set",
  );

  // Every workflow's own kinds must be in the union (catches a typo in the
  // constant itself).
  for (const [workflow, kinds] of Object.entries(OFFLINE_WORKFLOWS)) {
    for (const kind of kinds) {
      assert.ok(OFFLINE_KINDS.includes(kind), `${workflow} lists ${kind} which is not in the union`);
    }
  }

  // The three managers that seed the cache must all seed, and every kind they
  // seed must be prepared. This is the code-derived half: the set is whatever
  // the forms actually call useCachedOptions with.
  const dir = path.join(process.cwd(), "components", "modules");
  const files = ["ExpenseManager.tsx", "PaymentManager.tsx", "QuotationManager.tsx"];
  const used = new Set<string>();
  for (const file of files) {
    const src = fs.readFileSync(path.join(dir, file), "utf8");
    for (const m of src.matchAll(/useCachedOptions\(\s*"([^"]+)"/g)) used.add(m[1]);
  }
  assert.ok(used.size > 0, "the managers must actually seed the client cache");
  const missing = [...used].filter((k) => !OFFLINE_KINDS.includes(k));
  assert.deepEqual(
    missing,
    [],
    `managers cache kinds that offline readiness does not prepare: ${missing.join(", ")}`,
  );

  console.log(`offline-readiness.check: ok — ${OFFLINE_KINDS.length} kinds, ${files.length} managers, every seeded kind covered`);
}

main();
