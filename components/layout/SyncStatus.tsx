"use client";

// The persistent but unobtrusive sync indicator. One small pill in the Topbar
// that is invisible when everything is fine, turns into a state word when it
// isn't, and opens a tray listing exactly what is waiting, syncing or failed —
// every user-generated operation has a known state, and none of them disappear.
//
// States:
//   ONLINE   — nothing queued, nothing failed: no pill at all.
//   OFFLINE  — the browser believes the network is gone. Drafts and queueing
//              still work; the pill says so without alarming anyone.
//   PENDING  — N operations are queued, waiting to sync.
//   SYNCING  — the queue is draining right now.
//   FAILED   — at least one operation the server refused; its reason is in the
//              tray, with a Retry and a Cancel.
//
// Cancelling is deliberate, never one click: Cancel moves the operation to a
// recoverable archive (payload intact, kept a month), and erasing it from the
// archive takes a second explicit confirmation. The only way business input
// dies is the user asking twice to delete it.

import { useEffect, useRef, useState } from "react";
import { useSync } from "@/components/layout/SyncProvider";
import { useOfflineReadiness } from "@/lib/offline-readiness";

const KIND_LABEL: Record<string, string> = {
  quotation: "Quotation",
  expense: "Expenses",
  payment: "Payments",
};

export function SyncStatus() {
  const { online, entries, syncing, retry, cancel, cancelled, restore, deleteCancelled, storageWarning, syncNow } = useSync();
  // Truthful offline readiness: "ready" only when every reference kind the
  // quotation/expense/payment forms need is in this browser's cache, "limited"
  // when some are missing, "preparing" while the prep fetch is in flight.
  const readiness = useOfflineReadiness();
  const [open, setOpen] = useState(false);
  // The id armed for its second, confirming click — cancel first, then "Yes".
  const [cancelArmedId, setCancelArmedId] = useState<string | null>(null);
  const [deleteArmedId, setDeleteArmedId] = useState<string | null>(null);
  const trayRef = useRef<HTMLDivElement>(null);

  const pending = entries.filter((e) => e.status === "pending").length;
  const failed = entries.filter((e) => e.status === "failed").length;

  // Click anywhere else, or Esc, closes the tray and drops any armed confirm.
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (!trayRef.current?.contains(e.target as Node)) {
        setOpen(false);
        setCancelArmedId(null);
        setDeleteArmedId(null);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
        setCancelArmedId(null);
        setDeleteArmedId(null);
      }
    }
    document.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Nothing to say: online, nothing queued, nothing failed, and nothing being
  // prepared. (Online + limited is not a problem — the server is authoritative
  // and reachable — so the pill stays quiet; offline + limited is the honest
  // warning.)
  if (online && readiness !== "preparing" && pending === 0 && failed === 0 && cancelled.length === 0) return null;

  const label = !online
    ? readiness === "ready"
      ? "Offline — ready"
      : "Offline — limited"
    : syncing
      ? "Syncing…"
      : pending > 0
        ? `${pending} to sync`
        : failed > 0
          ? `${failed} failed`
          : readiness === "preparing"
            ? "Preparing offline data…"
            : "Synced";

  const tone = !online
    ? "border-amber-600 bg-amber-100 text-amber-900"
    : failed > 0
      ? "border-red-600 bg-red-100 text-red-900"
      : "border-navy-800/30 bg-navy-800/5 text-navy-800";

  return (
    <div ref={trayRef} className="relative shrink-0">
      <button
        type="button"
        onClick={() => {
          if (open) setOpen(false);
          else {
            setOpen(true);
            setCancelArmedId(null);
            setDeleteArmedId(null);
            void syncNow();
          }
        }}
        aria-expanded={open}
        aria-label="Synchronisation status"
        className={`flex h-7 items-center gap-1.5 rounded border px-2 text-xs font-medium ${tone}`}
      >
        {/* A tiny pulse for the syncing state — motion that says "working", not
            an alarm. */}
        <span
          className={`h-1.5 w-1.5 rounded-full bg-current ${syncing ? "animate-pulse" : ""}`}
          aria-hidden
        />
        {label}
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-1 w-80 rounded-md border border-sand bg-white p-3 shadow-xl">
          <div className="flex items-center justify-between pb-2">
            <p className="text-sm font-semibold text-navy-800">
              {!online
                ? readiness === "ready"
                  ? "Offline — ready"
                  : "Offline — limited data"
                : "Waiting to sync"}
            </p>
            {!online && (
              <p className="text-xs text-steel">
                {readiness === "ready"
                  ? "Everything the quotation, expense and payment forms need is cached — queueing works normally."
                  : "Queueing still works; some form lists may be missing until you reconnect."}
              </p>
            )}
          </div>

          {storageWarning && (
            <p className="mb-2 rounded border border-red-600 bg-red-100 px-2 py-1.5 text-xs text-red-900">
              {storageWarning}
            </p>
          )}

          {entries.length === 0 && cancelled.length === 0 ? (
            <p className="py-2 text-sm text-steel">Nothing waiting.</p>
          ) : (
            <ul className="max-h-72 overflow-auto">
              {entries.map((entry) => (
                <li key={entry.id} className="flex items-start justify-between gap-2 border-t border-sand py-2 text-sm">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-ink">{entry.label}</p>
                    <p className="text-xs text-steel">
                      {KIND_LABEL[entry.kind] ?? entry.kind} · {new Date(entry.createdAt).toLocaleString()}
                    </p>
                    {entry.status === "failed" && entry.lastError && (
                      <p className="mt-1 text-xs text-error">{entry.lastError}</p>
                    )}
                    {entry.status === "syncing" && <p className="mt-1 text-xs text-steel">Syncing…</p>}
                    {entry.status === "pending" && <p className="mt-1 text-xs text-steel">Waiting…</p>}
                    {cancelArmedId === entry.id && (
                      <p className="mt-1 text-xs text-error">
                        Cancelled work is kept recoverable for 30 days — you can restore it.
                      </p>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    {entry.status === "failed" && (
                      <button
                        type="button"
                        onClick={() => retry(entry.id)}
                        className="rounded border border-sand px-2 py-1 text-xs font-medium text-navy-800 hover:bg-ivory"
                      >
                        Retry
                      </button>
                    )}
                    {/* Cancel, never one click: the first click arms the
                        confirmation, the second moves the entry to the archive.
                        Anything else (Retry, closing the tray) disarms it. */}
                    <button
                      type="button"
                      onClick={() => {
                        if (cancelArmedId === entry.id) {
                          cancel(entry.id);
                          setCancelArmedId(null);
                        } else {
                          setCancelArmedId(entry.id);
                          setDeleteArmedId(null);
                        }
                      }}
                      className={`rounded border px-2 py-1 text-xs ${
                        cancelArmedId === entry.id
                          ? "border-red-600 bg-red-100 font-semibold text-red-900"
                          : "border-sand text-steel hover:bg-ivory"
                      }`}
                      title="Cancel this operation. It is not destroyed — it moves to a recoverable archive for 30 days."
                    >
                      {cancelArmedId === entry.id ? "Yes, cancel" : "Cancel"}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}

          {cancelled.length > 0 && (
            <div className="border-t border-sand pt-2">
              <p className="pb-1 text-xs font-semibold uppercase tracking-wide text-steel">
                Cancelled ({cancelled.length}) — kept 30 days
              </p>
              <ul className="max-h-40 overflow-auto">
                {cancelled.map((entry) => (
                  <li key={entry.id} className="flex items-start justify-between gap-2 border-t border-sand py-1.5 text-sm">
                    <div className="min-w-0">
                      <p className="truncate font-medium text-ink">{entry.label}</p>
                      <p className="text-xs text-steel">
                        {KIND_LABEL[entry.kind] ?? entry.kind} · {new Date(entry.cancelledAt).toLocaleString()}
                      </p>
                      {deleteArmedId === entry.id && (
                        <p className="mt-1 text-xs text-error">This permanently erases the only copy.</p>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => restore(entry.id)}
                        className="rounded border border-sand px-2 py-1 text-xs font-medium text-navy-800 hover:bg-ivory"
                      >
                        Restore
                      </button>
                      {/* Two clicks to destroy: the archive exists so that a
                          cancel is never fatal, and leaving it needs the same
                          care. */}
                      <button
                        type="button"
                        onClick={() => {
                          if (deleteArmedId === entry.id) {
                            deleteCancelled(entry.id);
                            setDeleteArmedId(null);
                          } else {
                            setDeleteArmedId(entry.id);
                            setCancelArmedId(null);
                          }
                        }}
                        className={`rounded border px-2 py-1 text-xs ${
                          deleteArmedId === entry.id
                            ? "border-red-600 bg-red-100 font-semibold text-red-900"
                            : "border-sand text-steel hover:bg-ivory"
                        }`}
                      >
                        {deleteArmedId === entry.id ? "Delete forever" : "Delete"}
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <p className="border-t border-sand pt-2 text-xs text-steel">
            Queued work is sent exactly once — a retry after a lost response is refused by the server as a duplicate.
          </p>
        </div>
      )}
    </div>
  );
}
