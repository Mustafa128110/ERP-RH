import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { DUPLICATE_OPERATION_MESSAGE, OPERATION_ID_FIELD } from "@/lib/operation-constants";

// Re-exported so existing importers (guard.check.ts) keep their single import
// path; the values themselves now live in the client-safe module.
export { DUPLICATE_OPERATION_MESSAGE, OPERATION_ID_FIELD } from "@/lib/operation-constants";

// Duplicate-submission protection for the critical creates (sales, purchases,
// payments, expenses, transfers, adjustments, quotations, ledger entries).
//
// The failure mode this exists for: the server commits a save, the response is
// lost on the wire, the browser shows the form still standing, and the user
// clicks Save again — two documents, two stock movements, a doubled ledger.
// Disabling the button while pending is not enough; the browser tab that loses
// its network right after clicking has no pending state left to disable.
//
// The fix is a client-generated id, minted once per open form, sent with every
// submit of that form. The create action claims it as the first statement of
// its transaction: INSERT .. ON CONFLICT DO NOTHING .. RETURNING returns a row
// exactly when the id is new. A repeat of a committed save finds the id already
// claimed and is refused — the transaction aborts before anything is written.
// A repeat after a *failed* save finds nothing, because the failed transaction
// rolled the claim back with everything else, so retrying a genuine failure
// still works. The id rides inside the same transaction as the record it
// guards, so "claimed" can never mean anything other than "committed".
//
// Old keys are pruned by the claiming statement itself (a day's worth is the
// longest a double-click can lag a human), so the table stays small with no
// cron and no cleanup pass to forget.


// Distinct from every database error so guard() and the actions' catch blocks
// can name it: nothing was written, the user just needs to know the first one
// landed.
export class DuplicateOperationError extends Error {
  constructor() {
    super(DUPLICATE_OPERATION_MESSAGE);
    this.name = "DuplicateOperationError";
  }
}

// Read the client's id off the form. Forms always send one; anything that
// calls an action without a form (a test, a future integration) gets a fresh
// random id — which buys it nothing, but also breaks nothing: the web UI is
// where the lost-response scenario can happen, and it always sends a real id.
export function readOperationId(formData: FormData): string {
  const sent = String(formData.get(OPERATION_ID_FIELD) ?? "").trim();
  return sent || crypto.randomUUID();
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

// One round trip: sweep yesterday's keys, then try to claim. Returns true when
// the id is new (the caller should proceed), false when it was already claimed
// (the caller must abort). Runs on the transaction handle so the claim commits
// or rolls back with the operation it guards.
//
// The sweep is a data-modifying CTE, which runs concurrently with the main
// statement against the same snapshot — the INSERT can't see what the DELETE
// removes, so a stale key can't be reclaimed by a plain ON CONFLICT DO NOTHING.
// That's what the DO UPDATE arm is for: on a conflict it refreshes the row only
// when the existing claim is older than the retention window (a re-claim of a
// stale key is a genuinely new operation), and refuses when the claim is fresh
// (a replay). One statement, so a claim costs the same single round trip it
// always did.
export async function claimOperation(tx: Tx, operationId: string): Promise<boolean> {
  const [row] = await tx.execute<{ key: string }>(sql`
    WITH pruned AS (
      DELETE FROM submitted_operations WHERE created_at < now() - interval '24 hours'
    )
    INSERT INTO submitted_operations (key) VALUES (${operationId})
    ON CONFLICT (key) DO UPDATE SET key = EXCLUDED.key, created_at = now()
    WHERE submitted_operations.created_at < now() - interval '24 hours'
    RETURNING key
  `);
  return Boolean(row);
}
