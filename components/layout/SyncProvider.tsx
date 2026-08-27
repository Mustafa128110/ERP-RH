"use client";

// The one place the outbox comes alive: it owns the queue's state for this
// user, watches connectivity, drains FIFO with backoff, and reconciles the
// local reference cache when an entry confirms.
//
// Wiring to the server actions lives here, not in lib/outbox.ts — that module
// is pure queue logic, checked offline; the actions are the concrete submit
// for each kind. Each entry's payload is exactly what the corresponding form
// would have sent, rebuilt here into the call the form makes:
//   quotation — a FormData the same shape createQuotation reads
//   expense   — ExpenseBatchRow[] straight to createExpensesBatch
//   payment   — PaymentBatchRow[] straight to createPaymentsBatch
// The entry's id rides along as the operation id in every case, so the server
// refuses a replay of an entry whose first attempt actually committed.
//
// Durability honesty lives here too: when localStorage refuses a write, the
// enqueue reports it (the form keeps its rows and says so) and a drain whose
// status flips can't be saved sets a warning — the user is never told work is
// stored safely when the browser couldn't write it.

import { createContext, useCallback, useContext, useEffect, useRef, useState, useSyncExternalStore, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useOffline } from "next/offline";
import { useClientUserId } from "@/lib/client-user";
import {
  createLocalOutboxStore,
  drainOutbox,
  enqueueOutbox,
  retryOutboxEntry,
  cancelOutboxEntry,
  restoreCancelledOutbox,
  deleteCancelledOutbox,
  reconcileOutbox,
  type OutboxEntry,
  type OutboxKind,
  type OutboxStore,
  type SubmitOutcome,
  type CancelledEntry,
} from "@/lib/outbox";
import { createQuotation } from "@/lib/actions/quotations";
import { createExpensesBatch, type ExpenseBatchRow } from "@/lib/actions/expenses";
import { createPaymentsBatch, type PaymentBatchRow } from "@/lib/actions/payments";
import { invalidateClientCache } from "@/lib/client-cache";
import { noteOfflineCacheInvalidated } from "@/lib/offline-readiness";

type SyncContextValue = {
  // True when neither connectivity signal says otherwise: the browser reports an
  // interface, and Next's own detection has not seen a request fail. Advisory
  // only — the drain treats an actual submit failure as authoritative.
  online: boolean;
  // The queue for the current user, in queue order (oldest first).
  entries: OutboxEntry[];
  syncing: boolean;
  // Queue an operation for later. `payload` must be JSON-serialisable and
  // exactly what the form would have submitted. `persisted` is false when the
  // browser could not write the queue to local storage — the caller must keep
  // the form alive and say so, not pretend the work is durably queued.
  enqueue: (kind: OutboxKind, label: string, payload: unknown) => { entry: OutboxEntry; persisted: boolean } | null;
  retry: (id: string) => void;
  // Deliberately end a pending/failed operation. The entry is NOT destroyed —
  // it moves to the per-user cancelled archive (payload intact, recoverable
  // for a month), so one click can never erase the only copy of business input.
  cancel: (id: string) => void;
  // Deliberately cancelled work, newest first — still recoverable.
  cancelled: CancelledEntry[];
  // Put a cancelled operation back in the live queue (same operation id, so
  // exactly-once holds even if the server already committed it).
  restore: (id: string) => void;
  // Permanently erase an entry from the cancelled archive. The UI requires an
  // explicit second confirmation for this — it is the only path that destroys
  // business input, and it must never be one click.
  deleteCancelled: (id: string) => void;
  // Non-null when local persistence misbehaved: a queue that couldn't be
  // written, a drain whose flips couldn't be saved, or stored bytes that
  // couldn't be read. Shown in the tray so nothing is silently lost.
  storageWarning: string | null;
  syncNow: () => void;
};

const SyncContext = createContext<SyncContextValue | null>(null);

// Transient failures back off: 2s, 4s, 8s … capped at a minute. The cap on
// automatic attempts (8) exists so a genuinely stuck entry surfaces as FAILED
// with its last error instead of retrying forever; the user can then Retry it
// by hand. A permanent failure is never auto-retried.
const MAX_AUTO_ATTEMPTS = 8;
const BACKOFF_MS = (attempts: number) => Math.min(2000 * 2 ** Math.min(attempts - 1, 4), 60_000);

// The browser's connectivity as a subscription, so the indicator and the drain
// both react to `online`/`offline` events without setState-in-effect. The server
// and the pre-hydration frame report online (true) — the drain treats an actual
// submit failure as the authoritative signal, so a wrong first guess is harmless.
function subscribeOnline(cb: () => void) {
  window.addEventListener("online", cb);
  window.addEventListener("offline", cb);
  return () => {
    window.removeEventListener("online", cb);
    window.removeEventListener("offline", cb);
  };
}

function getOnlineSnapshot() {
  return navigator.onLine;
}

const getOnlineServerSnapshot = () => true;

// The drain's own deadline on a single submit.
//
// With experimental.useOffline enabled a Server Action called with no usable
// network no longer rejects — Next holds it pending and re-runs it when the
// connection returns. For a form the user is watching that is exactly right.
// The drain is not a form: it marks the entry `syncing`, holds the tray's
// spinner, and its `syncingRef` guard means every later drain queues behind the
// one promise. A submit that never settles would wedge the queue with no
// backoff and no FAILED surfacing — the queue would look busy forever.
//
// So the drain keeps a deadline of its own and treats the overrun as transient,
// which is the outcome it already knows how to handle: the entry stays pending,
// backoff retries it, and reconnecting restarts the drain. Abandoning an
// in-flight attempt is safe because the entry keeps its operation id — whichever
// copy reaches the server first commits, and the other is refused as a duplicate,
// which drainOutbox treats as confirmed. 30s is far longer than any real round
// trip to this database and far shorter than "stuck".
const SUBMIT_DEADLINE_MS = 30_000;

function withDeadline(work: Promise<SubmitOutcome>): Promise<SubmitOutcome> {
  return new Promise<SubmitOutcome>((resolve) => {
    const timer = setTimeout(() => resolve({ status: "transient" }), SUBMIT_DEADLINE_MS);
    const settle = (outcome: SubmitOutcome) => {
      clearTimeout(timer);
      resolve(outcome);
    };
    // sendEntry catches its own failures, so the rejection path is belt and
    // braces — but an unhandled rejection here would be a queue that never moves.
    work.then(settle, () => settle({ status: "transient" }));
  });
}

// Maps an entry to the server call its kind implies. The entry's id is the
// operation id in every branch, which is what makes the whole queue exactly-once
// even when a response is lost. Module scope on purpose: it closes over nothing
// but the imported actions, so it needs no identity churn per render.
async function sendEntry(entry: OutboxEntry): Promise<SubmitOutcome> {
  try {
    if (entry.kind === "quotation") {
      const p = entry.payload as {
        companyId: string;
        contactId: string;
        contactName: string;
        documentDate: string;
        validUntil: string;
        discountTotal: string;
        taxTotal: string;
        shippingTotal: string;
        linesJson: string;
      };
      const formData = new FormData();
      formData.set("operationId", entry.id);
      formData.set("companyId", p.companyId);
      formData.set("contactId", p.contactId);
      formData.set("contactName", p.contactName);
      formData.set("documentDate", p.documentDate);
      formData.set("validUntil", p.validUntil);
      formData.set("discountTotal", p.discountTotal);
      formData.set("taxTotal", p.taxTotal);
      formData.set("shippingTotal", p.shippingTotal);
      formData.set("linesJson", p.linesJson);
      const result = await createQuotation(undefined, formData);
      return result.error ? { status: "failed", error: result.error } : { status: "confirmed" };
    }
    if (entry.kind === "expense") {
      const result = await createExpensesBatch(entry.payload as ExpenseBatchRow[], entry.id);
      return result.error ? { status: "failed", error: result.error } : { status: "confirmed" };
    }
    const result = await createPaymentsBatch(entry.payload as PaymentBatchRow[], entry.id);
    return result.error ? { status: "failed", error: result.error } : { status: "confirmed" };
  } catch {
    // The request never got a definitive answer (network, server hiccup).
    // The entry stays pending; the caller retries with backoff or on the
    // next `online` event. Never claim failure, never claim success.
    return { status: "transient" };
  }
}

export function SyncProvider({ children }: { children: React.ReactNode }) {
  const userId = useClientUserId();
  const router = useRouter();
  // Two connectivity signals, both read pessimistically.
  //
  // navigator.onLine is accurate the instant the page hydrates — including a
  // cold open with the interface already down, where no `offline` event ever
  // fires because nothing transitioned — but it reports true for a device on
  // WiFi with no upstream, which is the shop's actual failure mode.
  //
  // useOffline() catches exactly that case: it flips on a failed navigation,
  // prefetch or Server Action, not just on the browser event. But it starts as
  // false (server render and first hydration frame) and only becomes accurate
  // once something has been attempted.
  //
  // Neither is sufficient alone, so offline-according-to-either is the honest
  // answer. Both hooks are called unconditionally — `a && !b` would short-circuit
  // past one of them.
  const browserOnline = useSyncExternalStore(subscribeOnline, getOnlineSnapshot, getOnlineServerSnapshot);
  const detectedOffline = useOffline();
  const online = browserOnline && !detectedOffline;
  const [, startTransition] = useTransition();
  const [entries, setEntries] = useState<OutboxEntry[]>([]);
  const [cancelled, setCancelled] = useState<CancelledEntry[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [storageWarning, setStorageWarning] = useState<string | null>(null);
  const storeRef = useRef<OutboxStore | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const userIdRef = useRef<string | null>(null);
  const onlineRef = useRef(true);
  const syncingRef = useRef(false);

  // Refs must not be written during render — keep them in an effect instead.
  useEffect(() => {
    onlineRef.current = online;
  }, [online]);
  useEffect(() => {
    syncingRef.current = syncing;
  }, [syncing]);

  // One store per user id. When the user changes (logout, another login on the
  // same browser), the queue switches too — User B can never see or sync User
  // A's queued operations.
  useEffect(() => {
    if (userId !== userIdRef.current) {
      userIdRef.current = userId;
      storeRef.current = userId ? createLocalOutboxStore(userId) : null;
      // Reconcile on mount: an entry left "syncing" means a previous page life
      // died mid-drain (reload, tab closed, a crash). Its submit may or may not
      // have committed — either way the operation id makes a retry safe (the
      // server refuses a replay), so the only wrong move is leaving it stuck
      // and invisible. Back to pending it goes; the drain below picks it up.
      const store = storeRef.current;
      if (store) {
        reconcileOutbox(store);
        // A queue whose stored bytes wouldn't parse is not an empty queue — the
        // raw copy was preserved under a backup key by the store, and the user
        // must be told rather than let the work seem to vanish.
        if (store.corrupted?.()) {
          setStorageWarning(
            "The saved queue for this account couldn't be read. Its contents were kept under a backup key — check the tray before re-entering any of it.",
          );
        }
      }
      setEntries(store?.list() ?? []);
      setCancelled(store?.listCancelled() ?? []);
    }
    // The entries only change through this provider's own actions (enqueue,
    // drain, retry, cancel, restore), all of which call reload() — no external
    // listener needed, and polling localStorage for changes would fight the
    // drain's own writes.
  }, [userId]);

  // Reads the store through a ref and only touches stable setters, so it is a
  // stable callback — everything that lists the queue depends on it.
  const reload = useCallback(() => {
    const store = storeRef.current;
    if (!store) {
      setEntries([]);
      return;
    }
    setEntries(store.list());
  }, []);

  const reloadCancelled = useCallback(() => {
    const store = storeRef.current;
    setCancelled(store?.listCancelled() ?? []);
  }, []);

  // --- The drain -------------------------------------------------------------
  // sendEntry (module scope, above) makes the call; withDeadline stops a submit
  // that Next is holding pending for a returning network from wedging the queue.
  const submit = useCallback((entry: OutboxEntry): Promise<SubmitOutcome> => withDeadline(sendEntry(entry)), []);

  // The drain reads the store through refs only, so it can be a stable callback
  // and effects may call it without re-subscribing every render.
  const runDrain = useCallback(async () => {
    const store = storeRef.current;
    if (!store) return;
    if (syncingRef.current) return;
    const pending = store.list().filter((e) => e.status === "pending");
    if (pending.length === 0) return;
    // The browser's current belief at submit time, not a ref that may be a tick
    // stale — an enqueue right as the offline event lands must not fire a POST.
    if (typeof navigator !== "undefined" && !navigator.onLine) return;
    syncingRef.current = true;
    setSyncing(true);
    try {
      const report = await drainOutbox(store, submit);
      reload();
      reloadCancelled();
      // A drain whose status flips or removals couldn't be written to local
      // storage leaves the on-disk queue behind what the server actually did.
      // The server is authoritative, so the work is not lost — but the local
      // view is now untrustworthy, and the user must be told.
      if (report.saveFailed) {
        setStorageWarning(
          "This browser could not update its saved queue (storage is full or blocked). The server still received your work, but the local copy may be out of date.",
        );
      }
      // A permanent confirmation means real records changed on the server — the
      // local cache of reference data is stale now (a queued quotation may have
      // created an item, a queued expense a category).
      if (report.synced > 0) {
        invalidateClientCache();
        // Offline readiness dropped with the cache — the prep refills it (the
        // counter wakes OfflineReadiness to run again), so the pill never
        // claims "ready" on a cache that was just emptied.
        noteOfflineCacheInvalidated();
        // Non-blocking: queued work confirmed on the server, the local list
        // reloads behind the scenes without freezing the UI.
        startTransition(() => router.refresh());
      }
      // Transient pause: retry with backoff, but stop once the entry has been
      // retried the automatic limit — after that it surfaces as FAILED and only
      // a human Retry brings it back. The `online` event also restarts the drain
      // below, which is the natural recovery when the network truly returns.
      if (report.paused) {
        const flaky = store.list().filter((e) => e.status === "pending");
        const soonest = flaky.reduce((min, e) => Math.min(min, e.attempts), MAX_AUTO_ATTEMPTS + 1);
        if (soonest <= MAX_AUTO_ATTEMPTS) {
          if (timerRef.current) clearTimeout(timerRef.current);
          timerRef.current = setTimeout(() => void runDrain(), BACKOFF_MS(soonest));
        } else {
          // Exhausted automatic retries: mark each stuck entry FAILED so it is
          // visible and recoverable instead of retrying forever.
          store.save(
            store.list().map((e) =>
              e.status === "pending" && e.attempts > MAX_AUTO_ATTEMPTS
                ? { ...e, status: "failed" as const, lastError: "Still couldn't reach the server — check the connection and retry." }
                : e,
            ),
          );
          reload();
        }
      }
    } finally {
      syncingRef.current = false;
      setSyncing(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [submit, router]);

  // Connectivity: the subscription above feeds the indicator; this effect owns
  // the drain's reaction — reconnect sends the queue, disconnect pauses it.
  useEffect(() => {
    function goOnline() {
      void runDrain();
    }
    function goOffline() {
      if (timerRef.current) clearTimeout(timerRef.current);
    }
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [runDrain]);

  // The other half of the reconnect signal. The `online` event above only fires
  // when the network interface itself comes back; on WiFi with a dead upstream
  // it never fires at all, and the queue used to sit there until a backoff timer
  // happened to come round (or ran out of attempts and went FAILED). useOffline()
  // flips back to false when Next's own connectivity check succeeds, which is the
  // first honest moment to try again.
  //
  // Note this only ever *starts* a drain. The drain's own gate stays on
  // navigator.onLine: if Next's detection were ever wrong in the pessimistic
  // direction, a queue that refused to drain would be worse than one that tries
  // and backs off.
  useEffect(() => {
    if (online) void runDrain();
  }, [online, runDrain]);

  // On mount (a reload with a queue waiting) and whenever the user id resolves,
  // try to drain. Reload during an outage leaves the queue exactly where it
  // was — pending, visible, not lost. Deferred a tick so the store for the new
  // user id is in place before the drain reads it.
  useEffect(() => {
    if (!userId) return;
    const id = window.setTimeout(() => void runDrain(), 0);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const enqueue = useCallback(
    (kind: OutboxKind, label: string, payload: unknown): { entry: OutboxEntry; persisted: boolean } | null => {
      const store = storeRef.current;
      if (!store) return null;
      const { entry, persisted } = enqueueOutbox(store, kind, label, payload);
      reload();
      // Online right now: send it immediately. Offline: it waits in the queue
      // and the next `online` event (or manual Sync now) sends it. Only when
      // the write actually landed — an entry that couldn't persist must not be
      // half-drained; the caller keeps the form alive and says so.
      if (persisted && onlineRef.current) void runDrain();
      return { entry, persisted };
    },
    [reload, runDrain],
  );

  const retry = useCallback(
    (id: string) => {
      const store = storeRef.current;
      if (!store) return;
      retryOutboxEntry(store, id);
      reload();
      void runDrain();
    },
    [reload, runDrain],
  );

  const cancel = useCallback(
    (id: string) => {
      const store = storeRef.current;
      if (!store) return;
      cancelOutboxEntry(store, id);
      reload();
      reloadCancelled();
    },
    [reload, reloadCancelled],
  );

  const restore = useCallback(
    (id: string) => {
      const store = storeRef.current;
      if (!store) return;
      restoreCancelledOutbox(store, id);
      reload();
      reloadCancelled();
      void runDrain();
    },
    [reload, reloadCancelled, runDrain],
  );

  const deleteCancelled = useCallback(
    (id: string) => {
      const store = storeRef.current;
      if (!store) return;
      deleteCancelledOutbox(store, id);
      reloadCancelled();
    },
    [reloadCancelled],
  );

  const value: SyncContextValue = {
    online,
    entries,
    syncing,
    enqueue,
    retry,
    cancel,
    cancelled,
    restore,
    deleteCancelled,
    storageWarning,
    syncNow: () => void runDrain(),
  };

  return <SyncContext.Provider value={value}>{children}</SyncContext.Provider>;
}

export function useSync(): SyncContextValue {
  const ctx = useContext(SyncContext);
  if (!ctx) throw new Error("useSync must be used inside <SyncProvider>");
  return ctx;
}
