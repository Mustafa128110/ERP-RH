// The offline outbox: user-explicit PENDING operations that survive being
// offline and sync exactly once when connectivity returns.
//
// The engine's own rule: a submit that comes back with the duplicate refusal is
// proof the server committed a previous attempt (the response was lost), so the
// entry is confirmed and removed — it must never be retried as a failure.
// Imported here, client-side, so the browser recognises the exact sentence the
// server sends.
import { DUPLICATE_OPERATION_MESSAGE } from "@/lib/operation-constants";
//
// What this is NOT:
//   - Not a draft. A draft is what's on screen on this machine, offered back,
//     never submitted on its own. An outbox entry is a decision the user made:
//     "send this when you can." It holds a stable operation id minted at
//     enqueue time, and it stays in the queue until the server confirms it —
//     the requirement that the operation id stays associated with the logical
//     operation until confirmation.
//   - Not a retry mechanism for failed online saves. A normal Save that hits a
//     transport error keeps the form alive (TRANSPORT_ERROR_MESSAGE) and the
//     user re-Saves; that path is unchanged. This queue exists for the explicit
//     "Queue for later" action.
//
// Exactly-once rests on the existing duplicate-protection machinery: the entry's
// id is the operation id the server claims inside the same transaction as the
// write. A response lost after a commit makes the retry return
// DUPLICATE_OPERATION_MESSAGE, which this engine treats as *confirmed* — the
// first attempt landed, so the entry is removed rather than retried forever.
//
// Ordering is FIFO and sequential: one entry in flight at a time, in the order
// they were queued. A permanent failure marks that entry FAILED and the rest of
// the queue keeps draining — successful operations stay confirmed, the failed
// one stays visible and recoverable. A transient failure (the network went away
// mid-drain) pauses the whole drain: if the network is down, everything would
// fail, so retrying the rest now is wasted work. The caller schedules the next
// attempt with backoff, or waits for the next `online` event.
//
// Durability honesty: localStorage can refuse a write (private mode, a full
// quota) and can hold bytes that no longer parse (a half-written value, a
// format from before a deployment). Neither is ever swallowed silently —
// save() reports whether the write landed, and a store whose contents can't be
// read reports the corruption and preserves the raw bytes instead of dropping
// the only copy of queued business input. The UI turns both into an explicit
// warning; the user is never told work is safely stored when it isn't.

export type OutboxKind = "quotation" | "expense" | "payment";
export type OutboxStatus = "pending" | "syncing" | "failed";

export type OutboxEntry = {
  // The operation id. Minted once, at enqueue; reused for every attempt until
  // the server confirms — that is what makes a replayed sync a refused
  // duplicate rather than a second transaction.
  id: string;
  kind: OutboxKind;
  // A human sentence for the tray, e.g. "Quotation for Imran Hardware".
  label: string;
  payload: unknown;
  createdAt: number;
  attempts: number;
  status: OutboxStatus;
  lastError?: string;
};

// A deliberately cancelled operation. The payload — the only copy of the
// business input — is retained, so the user can change their mind and restore
// it as a fresh pending attempt. cancelledAt drives the archive's retention.
export type CancelledEntry = OutboxEntry & { cancelledAt: number };

// The outcome of one submit attempt. The engine only distinguishes the three
// cases that change its behaviour:
//   confirmed  — the server has it (success, or the duplicate refusal a lost
//                response produces). Remove the entry.
//   failed     — the server said no for a real reason (validation, stock,
//                balance). Mark FAILED, keep draining the rest.
//   transient  — the request never got a definitive answer (network). Pause
//                the drain; the caller retries with backoff or on reconnect.
export type SubmitOutcome = { status: "confirmed" } | { status: "failed"; error: string } | { status: "transient" };


// Storage is injectable so the check suite can run the engine against an
// in-memory array instead of localStorage. The browser store keys per user id,
// so a different user on the same browser reads a different queue.
export interface OutboxStore {
  list(): OutboxEntry[];
  // False when the write did not land (quota, private mode). The caller must
  // not pretend the entry is durably stored when this is false.
  save(entries: OutboxEntry[]): boolean;
  // The cancelled archive: work the user deliberately abandoned, kept
  // recoverable for a while instead of destroyed. Same per-user keying.
  listCancelled(): CancelledEntry[];
  saveCancelled(entries: CancelledEntry[]): boolean;
  // True once a read found bytes that could not be parsed as a queue. The UI
  // turns this into a warning — the old contents were not silently dropped.
  corrupted?(): boolean;
}

export type DrainReport = { synced: number; failed: number; paused: boolean; remaining: number; saveFailed: boolean };

// A module-level flag stops two triggers (an `online` event landing while a
// manual "Sync now" is mid-flight) from draining the same entries twice.
let draining = false;

export async function drainOutbox(
  store: OutboxStore,
  submit: (entry: OutboxEntry) => Promise<SubmitOutcome>,
): Promise<DrainReport> {
  if (draining) return { synced: 0, failed: 0, paused: false, remaining: store.list().filter((e) => e.status === "pending").length, saveFailed: false };
  draining = true;
  try {
    const report: DrainReport = { synced: 0, failed: 0, paused: false, remaining: 0, saveFailed: false };
    const entries = store.list().sort((a, b) => a.createdAt - b.createdAt);
    for (const entry of entries) {
      if (entry.status !== "pending") continue;
      if (!store.save(store.list().map((e) => (e.id === entry.id ? { ...e, status: "syncing" as const } : e)))) {
        // The status flip didn't land. The entry is still pending on disk and
        // will simply be submitted again — the operation id makes that safe.
        // Say so, so the caller can warn instead of letting it look normal.
        report.saveFailed = true;
      }
      const outcome = await submit(entry);
      const current = store.list();
      const stillThere = current.find((e) => e.id === entry.id);

      if (outcome.status === "confirmed") {
        if (stillThere && !store.save(current.filter((e) => e.id !== entry.id))) report.saveFailed = true;
        report.synced += 1;
        continue;
      }
      if (outcome.status === "failed") {
        // A refused replay is a confirmation, not a failure: the first attempt
        // committed and its response was lost, so this attempt found the id
        // already claimed. Same outcome as "confirmed" — remove the entry.
        if (outcome.error === DUPLICATE_OPERATION_MESSAGE) {
          if (stillThere && !store.save(current.filter((e) => e.id !== entry.id))) report.saveFailed = true;
          report.synced += 1;
          continue;
        }
        if (stillThere) {
          if (
            !store.save(
              current.map((e) =>
                e.id === entry.id
                  ? { ...e, status: "failed" as const, lastError: outcome.error, attempts: e.attempts + 1 }
                  : e,
              ),
            )
          ) {
            report.saveFailed = true;
          }
        }
        report.failed += 1;
        continue;
      }
      // Transient: put the entry back to pending (with its attempt counted) and
      // stop. Whatever stopped the network is stopping every entry.
      if (stillThere) {
        if (
          !store.save(
            current.map((e) => (e.id === entry.id ? { ...e, status: "pending" as const, attempts: e.attempts + 1 } : e)),
          )
        ) {
          report.saveFailed = true;
        }
      }
      report.paused = true;
      break;
    }
    report.remaining = store.list().filter((e) => e.status === "pending").length;
    return report;
  } finally {
    draining = false;
  }
}

// --- Browser store ----------------------------------------------------------

const PREFIX = "erp-outbox:";
// The archive lives under its own key so the drain never sees cancelled work —
// a cancelled entry must not be submitted again unless the user restores it.
const CANCELLED_PREFIX = "erp-outbox-cancelled:";
// Deliberately abandoned work is kept recoverable for a month, then aged out.
// This is the one deliberate retention policy in the queue system: it applies
// only to *cancelled* operations — pending and failed work is never dropped
// for being old.
const CANCELLED_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

// localStorage throws in private mode and when the quota is full; an outbox
// that fails to persist must never take the app down with it. save() reports
// the failure instead of hiding it, so the caller can warn the user rather
// than claim the work is stored safely. list() does the same for reads: bytes
// that won't parse are preserved under a backup key and reported as corrupted,
// never silently treated as an empty queue.
export function createLocalOutboxStore(userId: string): OutboxStore {
  const key = `${PREFIX}${userId}`;
  const cancelledKey = `${CANCELLED_PREFIX}${userId}`;
  let corrupted = false;
  let preservedCorruptBytes = false;

  return {
    list() {
      try {
        const raw = localStorage.getItem(key);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) {
          // Parses, but isn't a queue — a shape from before a deployment. Not
          // silently discardable: flag it so the UI warns once.
          corrupted = true;
          return [];
        }
        return parsed as OutboxEntry[];
      } catch {
        // Unreadable bytes. Preserve the raw copy (never silently destroy the
        // only copy of queued business input) and flag the corruption.
        corrupted = true;
        if (!preservedCorruptBytes) {
          preservedCorruptBytes = true;
          try {
            const raw = localStorage.getItem(key);
            if (raw) localStorage.setItem(`${key}:corrupt-${Date.now()}`, raw);
          } catch {
            // Nothing more we can do — the bytes are unrecoverable.
          }
        }
        return [];
      }
    },
    save(entries) {
      try {
        localStorage.setItem(key, JSON.stringify(entries));
        return true;
      } catch {
        return false;
      }
    },
    listCancelled() {
      try {
        const raw = localStorage.getItem(cancelledKey);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        const now = Date.now();
        return (parsed as CancelledEntry[]).filter((e) => now - e.cancelledAt < CANCELLED_RETENTION_MS);
      } catch {
        // A corrupted archive is less critical than a corrupted queue (the work
        // was deliberately abandoned) — still, don't throw.
        return [];
      }
    },
    saveCancelled(entries) {
      try {
        localStorage.setItem(cancelledKey, JSON.stringify(entries));
        return true;
      } catch {
        return false;
      }
    },
    corrupted: () => corrupted,
  };
}

export function enqueueOutbox(
  store: OutboxStore,
  kind: OutboxKind,
  label: string,
  payload: unknown,
  now = Date.now(),
): { entry: OutboxEntry; persisted: boolean } {
  // The operation id is minted here, at enqueue, and reused for every attempt —
  // never re-minted at submit time. A fresh id per attempt would make each
  // retry a genuinely new operation and the server would accept them all.
  const entry: OutboxEntry = {
    id: crypto.randomUUID(),
    kind,
    label,
    payload,
    createdAt: now,
    attempts: 0,
    status: "pending",
  };
  const persisted = store.save([...store.list(), entry]);
  return { entry, persisted };
}

// A failed entry comes back only when the user asks: Retry resets it to
// pending (and re-arms the drain). Neither happens silently.
export function retryOutboxEntry(store: OutboxStore, id: string): void {
  store.save(store.list().map((e) => (e.id === id && e.status === "failed" ? { ...e, status: "pending" as const, attempts: 0, lastError: undefined } : e)));
}

// --- Cancelling: the deliberate end of a pending/failed operation ------------
// One click must never destroy the only copy of business input, so a cancel
// does NOT erase: it moves the entry to the archive, payload intact, where it
// stays recoverable for CANCELLED_RETENTION_MS. Restore puts it back in the
// live queue as a fresh pending attempt; Delete permanently is the only way to
// erase it, and the UI requires an explicit second click for that too.

export function cancelOutboxEntry(store: OutboxStore, id: string): CancelledEntry | null {
  const entries = store.list();
  const entry = entries.find((e) => e.id === id);
  if (!entry) return null;
  store.save(entries.filter((e) => e.id !== id));
  const cancelled: CancelledEntry = { ...entry, cancelledAt: Date.now() };
  store.saveCancelled([...store.listCancelled(), cancelled]);
  return cancelled;
}

export function restoreCancelledOutbox(store: OutboxStore, id: string): OutboxEntry | null {
  const cancelled = store.listCancelled();
  const entry = cancelled.find((e) => e.id === id);
  if (!entry) return null;
  store.saveCancelled(cancelled.filter((e) => e.id !== id));
  // Back into the live queue as a fresh pending attempt. The operation id is
  // REUSED on purpose: if the server already committed the original send (a
  // lost response), the replay is refused as a duplicate and the entry
  // confirms; if it never arrived, the same id is accepted. Either way the
  // server ends with exactly one logical transaction — a fresh id would risk
  // a genuine second one.
  const restored: OutboxEntry = {
    id: entry.id,
    kind: entry.kind,
    label: entry.label,
    payload: entry.payload,
    createdAt: entry.createdAt,
    attempts: 0,
    status: "pending",
  };
  store.save([...store.list(), restored]);
  return restored;
}

export function deleteCancelledOutbox(store: OutboxStore, id: string): void {
  store.saveCancelled(store.listCancelled().filter((e) => e.id !== id));
}

// Crash recovery: an entry left "syncing" means a page life died mid-drain — a
// reload, a closed tab, a crashed renderer. The operation id makes a retry safe
// (the server refuses a replayed duplicate), so the entry can go straight back
// to pending and drain again on the next mount. Without this, an entry frozen
// at "syncing" would sit invisible forever: the drain only looks at pending,
// and the tray's "N to sync" counts only pending — a silent loss.
export function reconcileOutbox(store: OutboxStore): void {
  const entries = store.list();
  if (!entries.some((e) => e.status === "syncing")) return;
  store.save(entries.map((e) => (e.status === "syncing" ? { ...e, status: "pending" as const } : e)));
}
