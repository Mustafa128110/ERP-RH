import assert from "node:assert/strict";
import { describeDbError, guard } from "./guard";
import { PermissionError } from "../auth/permissions";
import { DuplicateOperationError, DUPLICATE_OPERATION_MESSAGE } from "./operation-id";

// The rule this file exists to hold: a failing write returns a sentence, it
// never throws. No database needed:
//
//   npx tsx --conditions=react-server lib/actions/guard.check.ts
//
// (--conditions=react-server makes the `server-only` import resolve to a no-op
// outside Next, which is exactly what it is on the server.)

const FALLBACK = "Couldn't save the products.";

// --- Unrecognised failures fall back to the caller's own sentence ------------
assert.equal(describeDbError(new Error("boom"), FALLBACK), FALLBACK);
assert.equal(describeDbError(null, FALLBACK), FALLBACK);
assert.equal(describeDbError({ code: "XX999" }, FALLBACK), FALLBACK, "an unmapped SQLSTATE is still a bug, not a guess");

// --- A permission failure already says exactly what's wrong ------------------
assert.equal(describeDbError(new PermissionError("Missing permission products.create"), FALLBACK), "Missing permission products.create");

// --- Constraint violations name the field that collided ----------------------
assert.equal(
  describeDbError({ code: "23505", constraint_name: "items_company_id_sku_unique" }, FALLBACK),
  "The sku already exists. Nothing was saved.",
);
// A foreign key breaks in both directions, so its message names neither field —
// it says what actually happened and promises nothing was written.
assert.match(
  describeDbError({ code: "23503", constraint_name: "document_lines_item_id_items_id_fk" }, FALLBACK),
  /still referenced by others, or something it depends on no longer exists\. Nothing was changed\./,
);
assert.equal(
  describeDbError({ code: "23505", constraint_name: "documents_company_id_document_type_id_number_unique" }, FALLBACK),
  "The number already exists. Nothing was saved.",
);
// postgres-js spells it `constraint_name`; some drivers use `constraint`.
assert.equal(describeDbError({ code: "23505", constraint: "brands_name_unique" }, FALLBACK), "The name already exists. Nothing was saved.");
// No constraint name to read: still a real message, just not a field-specific one.
assert.equal(describeDbError({ code: "23505" }, FALLBACK), "One of the values already exists. Nothing was saved.");

// --- An action that knows its own constraints keeps its own wording ----------
assert.equal(
  describeDbError({ code: "23505", constraint_name: "bank_accounts_company_id_account_number_unique" }, FALLBACK, {
    "23505": "Can't save — this account number already exists for this company.",
  }),
  "Can't save — this account number already exists for this company.",
);
// …but only for the code it overrode. Everything else still gets the general rule.
assert.match(describeDbError({ code: "40001" }, FALLBACK, { "23505": "unused" }), /Nothing was changed/);

// --- Contention and timeouts say "nothing was changed", because nothing was ---
for (const code of ["40001", "40P01", "57014", "53300"]) {
  const message = describeDbError({ code }, FALLBACK);
  assert.match(message, /Nothing was changed/, `${code} must promise the write didn't land`);
}

// --- A connection that never opened means the statement never ran ------------
assert.match(describeDbError({ code: "EAI_AGAIN", syscall: "getaddrinfo" }, FALLBACK), /Nothing was saved/);

// --- Wrapped errors are unwrapped: drizzle nests the driver error in `cause` --
assert.equal(
  describeDbError(Object.assign(new Error("Failed query"), { cause: { code: "23505", constraint_name: "units_name_unique" } }), FALLBACK),
  "The name already exists. Nothing was saved.",
);
// A cycle in the cause chain must terminate rather than blow the stack.
const cyclic: { cause?: unknown } = {};
cyclic.cause = cyclic;
assert.equal(describeDbError(cyclic, FALLBACK), FALLBACK);

async function asyncChecks() {
  // --- guard() itself: the success value passes straight through -------------
  const ok = await guard(FALLBACK, async () => ({ created: [{ id: "1" }] }));
  assert.deepEqual(ok, { created: [{ id: "1" }] });

  const failed = await guard(FALLBACK, async () => {
    throw Object.assign(new Error("dup"), { code: "23505", constraint_name: "brands_name_unique" });
  });
  assert.deepEqual(failed, { error: "The name already exists. Nothing was saved." });

  // --- A replayed operation id is refused with its own message, not the ------
  // --- fallback: the first save landed even though the user never saw it. -----
  const replayed = await guard(FALLBACK, async () => {
    throw new DuplicateOperationError();
  });
  assert.deepEqual(replayed, { error: DUPLICATE_OPERATION_MESSAGE });

  // --- redirect()/notFound() work by throwing and must not be swallowed ------
  await assert.rejects(
    () => guard(FALLBACK, async () => { throw Object.assign(new Error("NEXT_REDIRECT"), { digest: "NEXT_REDIRECT;replace;/login;307;" }); }),
    /NEXT_REDIRECT/,
  );
}

void asyncChecks().then(() => console.log("guard checks passed"));
