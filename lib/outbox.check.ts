// Offline check for the outbox engine (lib/outbox.ts). Exercises the drain
// logic against an in-memory store: FIFO order, the three outcome branches, the
// retry/cancel/restore verbs, persistence reporting and crash recovery. No
// database, no browser — node:assert and a main().
import assert from "node:assert";
import { drainOutbox, enqueueOutbox, retryOutboxEntry, cancelOutboxEntry, restoreCancelledOutbox, deleteCancelledOutbox, reconcileOutbox, type OutboxEntry, type OutboxStore, type SubmitOutcome, type CancelledEntry } from "./outbox";
import { DUPLICATE_OPERATION_MESSAGE } from "./operation-constants";

// The in-memory store mirrors the browser store's contract, including the
// cancelled archive and a switch for simulating a failing write.
function memStore(failWrites = false): OutboxStore {
  let entries: OutboxEntry[] = [];
  let cancelled: CancelledEntry[] = [];
  return {
    list: () => entries,
    save: (next) => {
      if (failWrites) return false;
      entries = next;
      return true;
    },
    listCancelled: () => cancelled,
    saveCancelled: (next) => {
      if (failWrites) return false;
      cancelled = next;
      return true;
    },
  };
}

async function main() {
  // --- FIFO: entries drain in the order they were queued, one at a time -------
  {
    const store = memStore();
    const calls: string[] = [];
    const submit = async (entry: OutboxEntry): Promise<SubmitOutcome> => {
      calls.push(entry.id);
      return { status: "confirmed" };
    };
    const a = enqueueOutbox(store, "expense", "expense A", { rows: [] }, 100);
    const b = enqueueOutbox(store, "expense", "expense B", { rows: [] }, 200);
    const c = enqueueOutbox(store, "payment", "payment C", { rows: [] }, 300);
    assert.equal(a.persisted, true, "a healthy store reports the write landed");
    const report = await drainOutbox(store, submit);
    assert.deepEqual(calls, [a.entry.id, b.entry.id, c.entry.id], "entries must drain in queue order");
    assert.equal(report.synced, 3);
    assert.equal(report.remaining, 0);
    assert.equal(report.saveFailed, false);
    assert.equal(store.list().length, 0, "confirmed entries are removed");
  }

  // --- Duplicate refusal = confirmed (the lost-response case) ----------------
  {
    const store = memStore();
    // First attempt commits server-side but the response is lost — the retry
    // comes back as the duplicate refusal, which must be treated as confirmed,
    // not as a failure to keep retrying.
    let attempt = 0;
    const submit = async (): Promise<SubmitOutcome> => {
      attempt += 1;
      return attempt === 1 ? { status: "transient" } : { status: "failed", error: DUPLICATE_OPERATION_MESSAGE };
    };
    enqueueOutbox(store, "expense", "dup", { rows: [] });
    await drainOutbox(store, submit);
    assert.equal(store.list().length, 1, "transient keeps the entry");
    assert.equal(store.list()[0].attempts, 1);
    await drainOutbox(store, submit);
    assert.equal(store.list().length, 0, "a duplicate refusal removes the entry as confirmed");
    assert.equal(attempt, 2);
  }

  // --- Permanent failure marks FAILED and the rest of the queue keeps going ---
  {
    const store = memStore();
    const submitted: string[] = [];
    const submit = async (entry: OutboxEntry): Promise<SubmitOutcome> => {
      submitted.push(entry.id);
      return entry.kind === "expense" ? { status: "failed", error: "Amount must be greater than zero." } : { status: "confirmed" };
    };
    const bad = enqueueOutbox(store, "expense", "bad", { rows: [] }, 100);
    const good = enqueueOutbox(store, "payment", "good", { rows: [] }, 200);
    const report = await drainOutbox(store, submit);
    assert.deepEqual(submitted, [bad.entry.id, good.entry.id], "a failed entry must not block the rest");
    assert.equal(report.failed, 1);
    assert.equal(report.synced, 1);
    const remaining = store.list();
    assert.equal(remaining.length, 1);
    assert.equal(remaining[0].id, bad.entry.id);
    assert.equal(remaining[0].status, "failed");
    assert.equal(remaining[0].lastError, "Amount must be greater than zero.");
  }

  // --- Transient pauses the whole drain; nothing later is attempted -----------
  {
    const store = memStore();
    const submitted: string[] = [];
    const submit = async (entry: OutboxEntry): Promise<SubmitOutcome> => {
      submitted.push(entry.id);
      return entry.label === "flaky" ? { status: "transient" } : { status: "confirmed" };
    };
    const first = enqueueOutbox(store, "expense", "first", {}, 100);
    const flaky = enqueueOutbox(store, "expense", "flaky", {}, 200);
    enqueueOutbox(store, "expense", "later", {}, 300);
    const report = await drainOutbox(store, submit);
    assert.deepEqual(submitted, [first.entry.id, flaky.entry.id], "transient stops the drain before later entries");
    assert.equal(report.paused, true);
    const after = store.list().find((e) => e.id === flaky.entry.id)!;
    assert.equal(after.status, "pending", "transient returns the entry to pending");
    assert.equal(after.attempts, 1);
  }

  // --- A confirmed entry stays gone even if it appeared twice (no double sync) -
  {
    const store = memStore();
    enqueueOutbox(store, "payment", "once", {});
    await drainOutbox(store, async () => ({ status: "confirmed" }));
    assert.equal(store.list().length, 0);
    // A second drain must not resurrect it — there is nothing left to submit.
    const report = await drainOutbox(store, async () => {
      throw new Error("nothing should be submitted again");
    });
    assert.equal(report.synced, 0);
    assert.equal(report.remaining, 0);
  }

  // --- Retry resets a failed entry to pending --------------------------------
  {
    const store = memStore();
    const entry = enqueueOutbox(store, "quotation", "q", {});
    store.save(store.list().map((e) => ({ ...e, status: "failed" as const, lastError: "nope" })));
    retryOutboxEntry(store, entry.entry.id);
    const retried = store.list()[0];
    assert.equal(retried.status, "pending");
    assert.equal(retried.attempts, 0);
    assert.equal(retried.lastError, undefined);
    retryOutboxEntry(store, "missing-id"); // no-op, must not throw
  }

  // --- Cancel moves the entry to the archive, payload intact -----------------
  // One click must not destroy the only copy: cancel removes the entry from
  // the live queue but keeps the payload recoverable, and the drain never sees
  // it again unless the user restores it.
  {
    const store = memStore();
    const { entry } = enqueueOutbox(store, "expense", "₹12,000 fuel", { rows: [{ amount: "12000" }] });
    const cancelled = cancelOutboxEntry(store, entry.id);
    assert.ok(cancelled, "cancelling an existing entry returns the archived copy");
    assert.equal(store.list().length, 0, "cancelled entries leave the live queue");
    assert.equal(store.listCancelled().length, 1);
    assert.equal(store.listCancelled()[0].id, entry.id);
    assert.deepEqual(store.listCancelled()[0].payload, { rows: [{ amount: "12000" }] }, "the payload survives cancellation");
    assert.equal(typeof store.listCancelled()[0].cancelledAt, "number");
    // The drain must not submit cancelled work.
    const report = await drainOutbox(store, async () => {
      throw new Error("cancelled work must never be submitted");
    });
    assert.equal(report.synced, 0);
    // Cancelling a missing id is a no-op.
    assert.equal(cancelOutboxEntry(store, "missing"), null);
  }

  // --- Restore returns cancelled work to the queue as a fresh pending attempt -
  // The operation id is reused: if the server already committed it (a lost
  // response), the replay is refused as a duplicate and confirms; if not, the
  // same id is accepted. Never a fresh id, never a second transaction.
  {
    const store = memStore();
    const { entry } = enqueueOutbox(store, "payment", "payment", { rows: [] });
    cancelOutboxEntry(store, entry.id);
    const restored = restoreCancelledOutbox(store, entry.id);
    assert.ok(restored, "restore returns the entry");
    assert.equal(restored.id, entry.id, "the operation id is reused — exactly-once stays intact");
    assert.equal(restored.status, "pending");
    assert.equal(restored.attempts, 0);
    assert.equal(store.list().length, 1, "the entry is back in the live queue");
    assert.equal(store.listCancelled().length, 0, "and gone from the archive");
    // Restoring a missing id is a no-op.
    assert.equal(restoreCancelledOutbox(store, "missing"), null);
  }

  // --- Delete permanently is the only way to erase archived work --------------
  {
    const store = memStore();
    const { entry } = enqueueOutbox(store, "expense", "x", {});
    cancelOutboxEntry(store, entry.id);
    deleteCancelledOutbox(store, entry.id);
    assert.equal(store.listCancelled().length, 0);
  }

  // --- A failing write is reported, never swallowed ---------------------------
  // The store that cannot persist must tell the enqueuer — the user must not
  // be told work is queued safely when it is only in memory.
  {
    const store = memStore(true);
    const { persisted } = enqueueOutbox(store, "expense", "doomed", { rows: [] });
    assert.equal(persisted, false, "a failing store reports the enqueue did not persist");
    assert.equal(store.list().length, 0, "nothing durable was written");
    // And a drain whose status flips cannot be saved reports saveFailed —
    // build a store that reads fine but cannot write, with a pending entry.
    const healthy = memStore();
    enqueueOutbox(healthy, "expense", "flaky-write", {});
    const flaky = memStore(true);
    flaky.list = () => healthy.list();
    const report = await drainOutbox(flaky, async () => ({ status: "confirmed" }));
    assert.equal(report.saveFailed, true, "a drain whose writes fail reports it");
    assert.equal(report.synced, 1, "the server still got the entry");
  }

  // --- Crash recovery: an entry left "syncing" comes back to pending ----------
  // A page life died mid-drain (reload, tab closed, crash). The entry must not
  // sit invisible at "syncing" forever — reconcileOutbox puts it back to
  // pending so the next mount drains it. The operation id makes the retry safe.
  {
    const store = memStore();
    const entry = enqueueOutbox(store, "expense", "mid-drain", {});
    store.save(store.list().map((e) => ({ ...e, status: "syncing" as const })));
    reconcileOutbox(store);
    const after = store.list();
    assert.equal(after.length, 1, "reconcile keeps the entry");
    assert.equal(after[0].status, "pending", "a stuck syncing entry returns to pending");
    assert.equal(after[0].id, entry.entry.id, "the operation id is untouched — retry stays safe");
    // It must actually drain after reconciliation.
    const report = await drainOutbox(store, async () => ({ status: "confirmed" }));
    assert.equal(report.synced, 1);
    assert.equal(store.list().length, 0);
    // And with nothing stuck, reconcile is a no-op.
    reconcileOutbox(store);
    assert.equal(store.list().length, 0);
  }

  // --- The drain flag prevents two concurrent drains from double-submitting ---
  {
    const store = memStore();
    enqueueOutbox(store, "expense", "x", {});
    let inFlight = 0;
    let maxInFlight = 0;
    const gates: (() => void)[] = [];
    const submit = async (): Promise<SubmitOutcome> => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise<void>((resolve) => gates.push(resolve));
      inFlight -= 1;
      return { status: "confirmed" };
    };
    const p1 = drainOutbox(store, submit);
    const p2 = drainOutbox(store, submit);
    // Release the single in-flight submit.
    await new Promise((r) => setTimeout(r, 0));
    gates.forEach((release) => release());
    await Promise.all([p1, p2]);
    assert.ok(maxInFlight <= 1, "concurrent drains must not overlap");
    assert.equal(store.list().length, 0);
  }

  console.log("outbox.check: ok — FIFO, duplicate-as-confirmed, partial failure, transient pause, retry, cancel/restore/delete archive, persistence reporting, crash recovery, no double drain");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
