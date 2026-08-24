import "server-only";
import { PermissionError } from "@/lib/auth/permissions";
import { DuplicateOperationError } from "@/lib/actions/operation-id";
import { ChequeUnavailableError } from "@/lib/actions/cheque-link";
import { SettlementScopeError } from "@/lib/actions/settlement";

// Every write in this app used to be one unhandled database error away from
// losing typed work. A server action that throws doesn't return a value the form
// can render — React replaces the tree with the error boundary, and the twenty
// rows someone had just pasted into a batch grid go with it.
//
// So no action throws any more. `guard` runs the body, and anything the database
// or the permission layer raises comes back as `{ error }` — the exact shape
// every form already renders inline, beside a grid that still holds its rows.
//
// This is deliberately not a retry: a statement that reached the database may
// have committed, and sending it again could write twice (lib/db/retry.ts spells
// out that rule). It turns a crash into a sentence, nothing more.

// SQLSTATEs worth naming. Anything else is a real bug and gets the caller's own
// fallback, which says what operation failed rather than guessing why.
const SQLSTATE: Record<string, string> = {
  "23505": "already exists",
  "23502": "is required and was left empty",
  "23514": "has a value the database rejected",
  "22001": "is too long for its field",
  "22003": "is a number too large for its field",
  "22P02": "is in the wrong format",
  // Two people saving the same rows at the same moment. Nothing was written.
  "40001": "couldn't be saved — someone else was editing the same records. Nothing was changed; try again.",
  "40P01": "couldn't be saved — two operations blocked each other. Nothing was changed; try again.",
  // Statement/lock timeout. Also nothing written — the transaction was rolled back.
  "57014": "took too long and was cancelled. Nothing was changed; try again.",
  "53300": "couldn't be saved — the database is out of connections. Nothing was changed; try again in a moment.",
};

// Same set lib/db/retry.ts treats as "never reached the database", which is what
// makes "nothing was saved" a statement of fact rather than a hope.
const CONNECT_CODES = new Set(["EAI_AGAIN", "ENOTFOUND", "ECONNREFUSED", "ETIMEDOUT", "EHOSTUNREACH", "ENETUNREACH", "ECONNRESET"]);

type PgError = { code?: string; constraint_name?: string; constraint?: string; detail?: string; message?: string; cause?: unknown };

function find(e: unknown, seen = new Set<unknown>()): PgError | null {
  if (!e || typeof e !== "object" || seen.has(e)) return null;
  seen.add(e);
  const err = e as PgError;
  if (err.code) return err;
  return find(err.cause, seen);
}

// "documents_company_id_document_type_id_number_unique" -> "number".
// Drizzle names a constraint <table>_<columns…>_<kind>, so the last column named
// in it is the one that collided — and a message naming the field is the
// difference between "fix that cell" and "start over". Only used for uniqueness:
// a foreign-key constraint names the *other* table, which is no use as a field.
function fieldFromConstraint(name: string | undefined): string | null {
  if (!name) return null;
  const parts = name
    .replace(/_(unique|key|pkey|check)$/, "")
    .split("_")
    .filter((p) => p && p !== "id");
  const field = parts.length > 1 ? parts[parts.length - 1] : null;
  return field && field.length > 2 ? field : null;
}

// Per-call overrides, keyed by SQLSTATE. An action that knows its own
// constraints ("this account number already exists for this company") says it
// better than anything derivable from a constraint name, so it wins.
export type ErrorMessages = Record<string, string>;

export function describeDbError(e: unknown, fallback: string, messages?: ErrorMessages): string {
  if (e instanceof PermissionError) return e.message;

  const err = find(e);
  const code = err?.code;

  if (code && messages?.[code]) return messages[code];

  if (code && CONNECT_CODES.has(code)) {
    return "Couldn't reach the database. Nothing was saved — check the connection and try again.";
  }

  // A foreign key cuts both ways — inserting a child whose parent is gone, and
  // deleting a parent something still points at — so the message has to cover
  // both rather than name a field.
  if (code === "23503") {
    return "Can't save — this record is still referenced by others, or something it depends on no longer exists. Nothing was changed.";
  }

  const phrase = code ? SQLSTATE[code] : undefined;
  if (!phrase) return fallback;

  // The 4000x/57014/53300 phrases are whole sentences already.
  if (phrase.startsWith("couldn't") || phrase.startsWith("took")) return `${fallback.replace(/[.!]$/, "")} — it ${phrase}`;

  const field = fieldFromConstraint(err?.constraint_name ?? err?.constraint);
  const subject = field ? `The ${field}` : "One of the values";
  return `${subject} ${phrase}. Nothing was saved.`;
}

// The two shapes every mutation in this app answers with. Annotating an action
// with one of them (rather than letting TypeScript infer a union of its return
// statements) is what keeps `state?.error` readable in the form that renders it,
// and what lets `guard` add an error branch to any action without changing its
// public type.
//
// `needsConfirmation` marks the one refusal that isn't a fault: the write is
// legal, it just moves settled money, and the person asking for it has to say
// yes. The `error` beside it is the sentence saying what would move; the flag is
// how a form knows to turn its Save into a Confirm rather than treating this like
// a validation failure. Set it wherever an action asks for `confirmAllocations`,
// so no form has to recognise the refusal by reading its wording.
export type ActionResult = { error?: string; success?: boolean; needsConfirmation?: boolean };
export type CreateResult<C> = { error?: string; created?: C[] };

// Wraps an action body. `fallback` is what the user sees when the failure isn't
// one of the recognised ones — write it as a full sentence about *this*
// operation ("Couldn't save the products.").
export async function guard<T extends object>(
  fallback: string,
  run: () => Promise<T>,
  messages?: ErrorMessages,
): Promise<T | { error: string }> {
  try {
    return await run();
  } catch (e) {
    // A replayed save id: nothing was written on this attempt, and the message
    // says exactly that.
    if (e instanceof DuplicateOperationError) return { error: e.message };
    // A cheque another document already holds: the guarded link refused, and
    // the message says which resource is contested rather than falling back to
    // the operation's generic sentence.
    if (e instanceof ChequeUnavailableError) return { error: e.message };
    if (e instanceof SettlementScopeError) return { error: e.message };
    // Next's redirect() and notFound() work by throwing; swallowing those would
    // turn a redirect into an error message.
    if (e && typeof e === "object" && "digest" in e && typeof (e as { digest: unknown }).digest === "string") throw e;
    // The server log is where the stack belongs; the user gets the sentence.
    console.error(`[action] ${fallback}`, e);
    return { error: describeDbError(e, fallback, messages) };
  }
}

// The SQLSTATE a unique constraint raises. Named so call sites read as intent
// rather than as a five-character literal nobody recognises.
export const DUPLICATE = "23505";
