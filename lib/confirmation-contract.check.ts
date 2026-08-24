import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// One refusal in this app isn't a fault. When an edit or a cancellation would
// move money that is already settled against something else, the action stops and
// asks — the write is legal, it just needs a "yes" first. That refusal comes back
// in the same `{ error }` shape as a validation failure and a database outage, so
// a form has to be able to tell them apart: the first turns Save into Confirm,
// the other two are dead ends.
//
// It used to tell them apart by reading the sentence
// (`error.includes("Confirm to release")`), which meant rewording a message
// silently broke a form. `needsConfirmation` replaced that, and this check is what
// stops the string match coming back — and what stops a new action asking for
// `confirmAllocations` without flagging its refusal, which is the same bug seen
// from the other side.

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");
const lines = (file: string) => read(file).split(/\r?\n/);

// ---------------------------------------------------------------------------
// 1. The flag exists on the shape every mutation answers with
// ---------------------------------------------------------------------------

assert.ok(
  /export type ActionResult = \{[^}]*needsConfirmation\?: boolean/.test(read("lib/actions/guard.ts")),
  "ActionResult must carry `needsConfirmation?: boolean` — it is the one channel a form has for telling a request-to-confirm from a failure",
);

// ---------------------------------------------------------------------------
// 2. Every refusal that asks for confirmation sets it
// ---------------------------------------------------------------------------

// The guard is written one way everywhere, which is what makes it scannable.
const GUARD = 'String(formData.get("confirmAllocations") ?? "") !== "1"';

const actionsDir = path.join(root, "lib", "actions");
let refusals = 0;

for (const name of fs.readdirSync(actionsDir)) {
  if (!name.endsWith(".ts") || name.endsWith(".check.ts")) continue;
  const source = lines(path.posix.join("lib/actions", name));
  source.forEach((line, index) => {
    if (!line.includes(GUARD)) return;
    refusals += 1;
    // The `return` it guards, from the `if` down to the line that closes the
    // returned object — a one-liner closes on its own line, a spread-out one a
    // few lines below. Twelve lines is well past both and short of whatever
    // statement comes next.
    const window = source.slice(index, index + 12);
    const closes = window.findIndex((l, i) => i > 0 && /\};?\s*$/.test(l));
    const returned = window.slice(0, closes === -1 ? window.length : closes + 1).join("\n");
    assert.ok(
      returned.includes("needsConfirmation: true"),
      `lib/actions/${name}:${index + 1} refuses a write pending confirmation without setting needsConfirmation — the form has no way to know this is a question rather than a failure`,
    );
  });
}

// Six of them today: editing and cancelling a sale, editing and cancelling a
// purchase, cancelling a payment, and moving an opening balance. The floor is
// here so deleting the flag along with the guards can't pass by finding nothing.
assert.ok(refusals >= 6, `expected at least six confirmation refusals, found ${refusals}`);

// ---------------------------------------------------------------------------
// 3. Every form that can trip one of those refusals can answer it
// ---------------------------------------------------------------------------

// The other half of the contract, and the more expensive half to get wrong: an
// action that asks for `confirmAllocations` from a form that never sends it is a
// dead end — the user reads a sentence explaining what would happen and has no way
// to say yes, and the only remaining route is to go and unlink the payments by
// hand, which is exactly what this flow exists to avoid.
const CONFIRMABLE_ACTIONS = [
  "updateSale(",
  "deleteSale(",
  "updateStockPurchase(",
  "deleteStockPurchase(",
  "deletePayment(",
  "setPartyOpeningBalance(",
] as const;

let callers = 0;
for (const name of fs.readdirSync(path.join(root, "components", "modules"))) {
  if (!name.endsWith(".tsx")) continue;
  const source = read(path.posix.join("components/modules", name));
  const calls = CONFIRMABLE_ACTIONS.filter((call) => source.includes(`await ${call}`));
  if (calls.length === 0) continue;
  callers += 1;
  assert.ok(
    source.includes("confirmAllocations"),
    `components/modules/${name} calls ${calls.join(", ")} but never sends confirmAllocations — its refusal would be a dead end`,
  );
}
assert.ok(callers >= 4, `expected at least four forms to call a confirmable action, found ${callers}`);

// ---------------------------------------------------------------------------
// 4. No form recognises the refusal by its wording
// ---------------------------------------------------------------------------

// A message is prose — it gets reworded, translated, made shorter. Nothing that
// decides behaviour may depend on it.
const WORDING_MATCH = /\.(error|message)\s*\??\.\s*(includes|startsWith|endsWith|match|indexOf)\s*\(/;

for (const dir of ["components/modules", "components/ui", "components/layout"]) {
  for (const name of fs.readdirSync(path.join(root, dir))) {
    if (!name.endsWith(".tsx") && !name.endsWith(".ts")) continue;
    lines(path.posix.join(dir, name)).forEach((line, index) => {
      assert.ok(
        !WORDING_MATCH.test(line),
        `${dir}/${name}:${index + 1} branches on the wording of a server message — read a typed field on the result instead (needsConfirmation, success, error)`,
      );
    });
  }
}

console.log("confirmation-contract.check: ok — every confirmable refusal is flagged, and no form reads the flag out of the sentence");
