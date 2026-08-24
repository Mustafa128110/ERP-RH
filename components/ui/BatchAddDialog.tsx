"use client";

import { useEffect, useRef, useState } from "react";
import { useOffline } from "next/offline";
import { Dialog } from "@/components/ui/Dialog";
import { gridKeyDown, gridSelectionProps } from "@/components/ui/grid-keys";
import { clearDraft, readDraft, saveDraft } from "@/lib/draft";
import { TRANSPORT_ERROR_MESSAGE } from "@/components/ui/form-styles";

const ADD_ROWS = 2;

// Generic "one row per record, N rows at a time" bulk-create popup — the single
// way to create master data anywhere in the app (products, contacts, currencies,
// taxes, users, ...). The per-record forms it replaced did the same job one
// record at a time, so they were removed rather than kept alongside it.
//
// The caller owns the row shape and how each cell renders; this owns the row
// array, the table chrome, and the submit/error state.
//
// Two generics: T is the editable row, C is whatever the server action reports
// back as created. C matters for quick-add — adding a product from inside a
// sale returns the new product so the caller can drop it straight into the line
// the user was editing, instead of making them hunt for it in the dropdown.
export function BatchAddDialog<T, C = unknown>({
  title,
  onClose,
  emptyRow,
  headers,
  renderRow,
  onSubmit,
  onQueue,
  onDone,
  initialRows = 5,
  toolbar,
  autoAppend = false,
  draftKey,
}: {
  title: string;
  onClose: () => void;
  emptyRow: () => T;
  headers: string[];
  renderRow: (row: T, index: number, update: (patch: Partial<T>) => void) => React.ReactNode;
  onSubmit: (rows: T[]) => Promise<{ error?: string; created?: C[] }>;
  // When set, a "Queue for later" button appears beside Save — the rows are
  // kept locally and sent when the connection returns, instead of posted now.
  // Only the flows whose server actions are safe to replay with a stable
  // operation id pass this (expenses, payments); the master-data dialogs
  // don't. The caller maps rows to its server payload and calls useSync().
  // Must return true only when the work was DURABLY queued (written to local
  // storage); false keeps the dialog open so the rows are not lost.
  onQueue?: (rows: T[]) => boolean;
  onDone: (created?: C[]) => void;
  // Quick-add from inside another form usually means "I need one thing"; the
  // master-data pages mean "I'm entering a batch". Same dialog, different start.
  initialRows?: number;
  // When set, the rows are kept in localStorage as they're typed and offered
  // back the next time the dialog opens — a crash, a closed tab or an offline
  // blip costs nothing. Used by the dialogs people paste many rows into
  // (expenses, payments); the master-data dialogs don't pass it. Clearing on a
  // successful save is handled here, inside submit().
  draftKey?: string;
  // Sits above the table — used for the "+ Add Category" / "+ Add Brand" quick
  // buttons when a row's dropdowns reference records the user may not have yet,
  // or for a dialog-level field that applies to every row, like a shared date.
  // Kept out of the rows themselves because those options are shared by every
  // row, so one button per entity beats one per cell.
  toolbar?: React.ReactNode;
  // The dialog grows its own rows: editing the last row appends a fresh blank
  // one beneath it, so a dialog that starts with a single row (initialRows={1})
  // never needs the "+ Add rows" button — the expense and payment dialogs enter
  // one record at a time and run this way. Blank rows are dropped by the server
  // actions, so a spare at the bottom costs nothing.
  autoAppend?: boolean;
}) {
  // A draft key means the rows survive a crash mid-entry: they open with the
  // last unsaved batch in place and save back as they're typed. The initial
  // state is read once, when the dialog mounts — the draft is the rows, so
  // restoring is opening, and a "restored N unsaved rows" note tells the user
  // they aren't looking at a fresh grid.
  const [initial] = useState<T[] | null>(() => {
    if (!draftKey) return null;
    const saved = readDraft<T[]>(draftKey);
    return Array.isArray(saved) && saved.length > 0 ? saved : null;
  });
  const [rows, setRows] = useState<T[]>(initial ?? Array.from({ length: initialRows }, emptyRow));
  const [restoredFromDraft, setRestoredFromDraft] = useState(initial !== null);
  const [pending, setPending] = useState(false);
  // With experimental.useOffline a save pressed with no network stays pending
  // instead of failing, so "Saving…" would sit there looking frozen for a reason
  // the user can't see. This is that reason. (Read straight from next/offline
  // rather than the sync provider: this is a ui/ leaf, and by the time a save is
  // pending a request has been attempted, which is exactly when the hook is
  // accurate.)
  const offline = useOffline();
  const [error, setError] = useState<string | null>(null);
  // True when the queue for later couldn't be written to local storage — the
  // dialog stays open because the rows are only safe in this page, and the
  // user must be told rather than believe the work is stored.
  const [queueError, setQueueError] = useState<string | null>(null);
  // True when the crash-draft (the copy that survives a reload) failed to
  // save. The rows are still in the grid, so nothing is lost yet — but a
  // reload would be. Say so.
  const [draftSaveFailed, setDraftSaveFailed] = useState(false);
  const bodyRef = useRef<HTMLTableSectionElement>(null);

  // The draft only starts once the user has actually touched a row — an
  // untouched dialog must not write an "empty batch" draft that then reads as
  // a restore. Touch happens in update, removeRow and the +Add rows button.
  const [touched, setTouched] = useState(initial !== null);
  useEffect(() => {
    if (!draftKey || !touched) return;
    // saveDraft reports whether the write landed; a draft that couldn't be
    // saved must not be silently presented as crash-proof. The warning update
    // is deferred off the synchronous effect body (the lint rule against
    // setState in effects); the value is stable, so a failed save warns once.
    const ok = saveDraft(draftKey, rows);
    queueMicrotask(() => setDraftSaveFailed(!ok));
  }, [draftKey, rows, touched]);

  function update(i: number, patch: Partial<T>) {
    setTouched(true);
    setRows((prev) => {
      const next = prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r));
      // A row that grows itself: once the last row is touched, a fresh blank
      // row follows it, so there is always somewhere to type next — the same
      // rule the sale and purchase line grids use. Only when autoAppend asks
      // for it; the master-data dialogs keep the "+ Add rows" button instead.
      if (autoAppend && i === prev.length - 1) next.push(emptyRow());
      return next;
    });
  }

  function removeRow(i: number) {
    setTouched(true);
    setRows((prev) => (prev.length > 1 ? prev.filter((_, idx) => idx !== i) : prev));
  }

  async function submit() {
    setPending(true);
    setError(null);
    setQueueError(null);
    let result;
    try {
      result = await onSubmit(rows);
    } catch {
      // The transport failed — the request may or may not have reached the
      // server, so say exactly that rather than leaving the dialog stuck on
      // "Saving…" or pretending nothing happened. The rows are still in the
      // grid (and in the draft), so Save stays available: a replayed click
      // after a save that did land is refused server-side by the operation id.
      setPending(false);
      setError(TRANSPORT_ERROR_MESSAGE);
      return;
    }
    setPending(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    // Saved — the local copy has nothing left to protect.
    if (draftKey) clearDraft(draftKey);
    onDone(result.created);
  }

  return (
    <Dialog
      title={title}
      onClose={onClose}
      size="wide"
      footer={
        <div className="flex items-center gap-3">
          {!autoAppend && (
            <button
              type="button"
              onClick={() => {
                setTouched(true);
                setRows((prev) => [...prev, ...Array.from({ length: ADD_ROWS }, emptyRow)]);
              }}
              className="mr-auto text-sm font-medium text-navy-800 hover:underline"
            >
              + Add {ADD_ROWS} rows
            </button>
          )}
          <div className="ml-auto flex items-center gap-3">
            {error && <p className="text-sm text-error">{error}</p>}
            {queueError && <p className="text-sm text-error">{queueError}</p>}
            {onQueue && (
              <button
                type="button"
                // Disabled while a save is in flight, and that is not cosmetic.
                // With experimental.useOffline a Save pressed offline does not
                // fail — Next holds the request and re-runs it when the
                // connection returns — so queueing on top of it would send the
                // same rows twice under two different operation ids, which is
                // the one thing the duplicate guard cannot catch. Exactly one
                // in-flight copy of a batch, always.
                disabled={pending}
                onClick={() => {
                  // The rows have moved out of this grid into the outbox — the
                  // local draft would otherwise offer them back next time and a
                  // restore could queue the same work twice. Only when the queue
                  // actually took them: a queue that couldn't be written leaves
                  // the dialog open, rows intact, and says so.
                  if (onQueue(rows)) {
                    if (draftKey) clearDraft(draftKey);
                    onClose();
                  }
                }}
                className="h-10 rounded border border-sand px-4 text-sm font-medium text-navy-800 hover:bg-ivory disabled:opacity-40"
                title={
                  pending
                    ? "A save is already in flight — it lands on its own when the connection returns"
                    : "Keep this work locally and send it when the connection returns"
                }
              >
                Queue for later
              </button>
            )}
            <button type="button" onClick={onClose} className="h-10 rounded px-4 text-sm text-steel hover:bg-ivory">
              Cancel
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={pending}
              // data-dialog-submit: this dialog has no form (Save calls a
              // function), so the app-wide Ctrl+Enter handler clicks this
              // button from anywhere in the dialog body, including the toolbar.
              data-dialog-submit
              className="h-10 rounded bg-navy-800 px-5 text-sm font-semibold text-white hover:bg-navy-700 disabled:opacity-40"
            >
              {pending ? (offline ? "Saving — will send when back online…" : "Saving…") : "Save"}
            </button>
          </div>
        </div>
      }
    >
      {draftSaveFailed && draftKey && (
        <p className="mb-3 rounded border border-red-600 bg-red-100 px-3 py-2 text-sm text-red-900">
          This browser could not save a copy of this batch (storage is full or blocked). Keep this page open — the
          rows are safe only while it is.
        </p>
      )}

      {restoredFromDraft && draftKey && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded border border-brass-600 bg-brass-100 px-3 py-2 text-sm text-ink">
          <span>
            Restored {rows.length} unsaved {rows.length === 1 ? "row" : "rows"} from earlier.
          </span>
          <button
            type="button"
            onClick={() => {
              clearDraft(draftKey);
              setRows(Array.from({ length: initialRows }, emptyRow));
              setRestoredFromDraft(false);
            }}
            className="font-medium text-steel hover:underline"
          >
            Discard
          </button>
        </div>
      )}

      {toolbar && <div className="mb-3 flex flex-wrap items-center gap-2">{toolbar}</div>}

      {/* Blank rows are ignored by the server actions, so leaving spares at the
          bottom is harmless — the header stays put while the rows scroll. */}
      <div className="scroll-thin overflow-auto rounded border border-sand">
        <table className="w-full min-w-max border-collapse text-sm">
          <thead>
            <tr className="sticky top-0 z-10 bg-ivory">
              {headers.map((h) => (
                <th key={h} className="whitespace-nowrap border border-sand px-2 py-2 text-left text-xs font-semibold uppercase tracking-wide text-steel">
                  {h}
                </th>
              ))}
              <th className="w-8 border border-sand" />
            </tr>
          </thead>
          <tbody ref={bodyRef} {...gridSelectionProps} onKeyDown={(e) => gridKeyDown(e, bodyRef, () => !pending && void submit())}>
            {rows.map((row, i) => (
              <tr key={i}>
                {renderRow(row, i, (patch) => update(i, patch))}
                <td className="border border-sand text-center">
                  <button
                    type="button"
                    onClick={() => removeRow(i)}
                    className="text-steel hover:text-error"
                    aria-label={`Remove row ${i + 1}`}
                  >
                    ✕
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Dialog>
  );
}

// Cells share a single collapsed border (grid look, like the sales/purchase
// line editors); the input itself is borderless and fills the cell.
export const batchCellClass = "border border-sand p-0 align-middle";
export const batchInputClass = "h-9 w-full min-w-[8rem] bg-transparent px-2 text-sm text-ink outline-none focus:bg-navy-800/5";
