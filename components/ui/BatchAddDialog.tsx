"use client";

import { useRef, useState } from "react";
import { Dialog } from "@/components/ui/Dialog";
import { gridKeyDown, gridSelectionProps } from "@/components/ui/grid-keys";

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
  onDone,
  initialRows = 5,
  toolbar,
  autoAppend = false,
}: {
  title: string;
  onClose: () => void;
  emptyRow: () => T;
  headers: string[];
  renderRow: (row: T, index: number, update: (patch: Partial<T>) => void) => React.ReactNode;
  onSubmit: (rows: T[]) => Promise<{ error?: string; created?: C[] }>;
  onDone: (created?: C[]) => void;
  // Quick-add from inside another form usually means "I need one thing"; the
  // master-data pages mean "I'm entering a batch". Same dialog, different start.
  initialRows?: number;
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
  const [rows, setRows] = useState<T[]>(() => Array.from({ length: initialRows }, emptyRow));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bodyRef = useRef<HTMLTableSectionElement>(null);

  function update(i: number, patch: Partial<T>) {
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
    setRows((prev) => (prev.length > 1 ? prev.filter((_, idx) => idx !== i) : prev));
  }

  async function submit() {
    setPending(true);
    setError(null);
    const result = await onSubmit(rows);
    setPending(false);
    if (result.error) {
      setError(result.error);
      return;
    }
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
              onClick={() => setRows((prev) => [...prev, ...Array.from({ length: ADD_ROWS }, emptyRow)])}
              className="mr-auto text-sm font-medium text-navy-800 hover:underline"
            >
              + Add {ADD_ROWS} rows
            </button>
          )}
          <div className="ml-auto flex items-center gap-3">
            {error && <p className="text-sm text-error">{error}</p>}
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
              {pending ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      }
    >
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
