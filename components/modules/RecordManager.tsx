"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useNewEntry } from "@/components/layout/KeyboardShortcuts";
import { Dialog } from "@/components/ui/Dialog";
import { DataTable } from "@/components/ui/DataTable";
import { PageHeader } from "@/components/ui/PageHeader";
import { Icon } from "@/components/ui/Icon";
import { primaryIconButtonClass } from "@/components/ui/form-styles";
import type { ColumnDef, Row } from "@/lib/table";

// The master-data list screen, written once.
//
// Brands, units, taxes, locations and companies each had their own copy of this
// component — same imports, same three pieces of state, same close() calling
// router.refresh(), same PageHeader/DataTable/Dialog layout — and the only real
// differences were the noun, the columns, and which forms went in the popups.
// Five copies meant five places to fix when the list needed a search box, and
// five chances for one of them to drift.
//
// The shape every one of them follows:
//
//   header  — title, "N noun(s)", an "+ Add …" button opening the batch dialog
//   table   — click a row to edit it, search box, keyboard navigation
//   popups  — batch create; edit one, with delete beneath it in a danger panel
//
// Anything that doesn't fit that shape (products' batch edit, contacts' scope
// column, the ledger's per-row balance form) keeps its own component — this is
// the template for the plain ones, not a framework for all of them.
export function RecordManager<T extends { id: string }>({
  title,
  noun,
  plural,
  records,
  columns,
  toRow,
  searchPlaceholder,
  emptyMessage,
  dialogTitle,
  headerActions,
  renderBatchDialog,
  renderEditBody,
}: {
  title: string;
  // Used in the "+ Add …" button and the record count: "brand" -> "+ Add
  // Brands", "3 brand(s)".
  noun: string;
  // Only when the plural isn't `${noun}s` — "taxes", "companies".
  plural?: string;
  records: T[];
  columns: ColumnDef[];
  toRow: (record: T) => Row;
  searchPlaceholder: string;
  emptyMessage: string;
  // Heading of the edit popup, usually the record's name.
  dialogTitle: (record: T) => string;
  // Anything that belongs beside "+ Add …" (CSV import/export, a merge button).
  headerActions?: ReactNode;
  // onDone carries the rows the dialog just created (when its server action
  // reports them), so this list can show them immediately — see the call site
  // below. A plain `() => void` also satisfies it.
  renderBatchDialog: (args: { onClose: () => void; onDone: (created?: unknown[]) => void }) => ReactNode;
  // The whole body of the edit popup — the form, and the delete button under it.
  // Passed as one slot rather than two because a few of these put something
  // between them, and a `renderDelete` that most callers pass would be a prop
  // that exists to be ignored.
  renderEditBody: (args: { record: T; onDone: () => void }) => ReactNode;
}) {
  const [modal, setModal] = useState<{ kind: "batch" } | { kind: "edit"; record: T } | null>(null);
  const router = useRouter();

  // A local copy of the list that a successful batch create lands in before the
  // refresh round-trips — the save has already succeeded, so showing the rows
  // now is honest, and the refresh below reconciles the order/ids with what the
  // server actually stored.
  const [local, setLocal] = useState(records);
  // The server is the source of truth: whenever the page re-renders with fresh
  // records (router.refresh() after a save), the optimistic copy steps aside.
  // Done with the "adjust state during render" pattern (guarded by a comparison)
  // rather than an effect, which the linter rightly flags for cascading renders.
  const [prevRecords, setPrevRecords] = useState(records);
  if (records !== prevRecords) {
    setPrevRecords(records);
    setLocal(records);
  }

  // router.refresh() re-runs the server component behind this list, so the table
  // reflects the change without a full navigation.
  function close() {
    setModal(null);
    router.refresh();
  }

  const rows = local.map(toRow);
  const many = plural ?? `${noun}s`;

  useNewEntry(() => setModal({ kind: "batch" }));

  return (
    <div className="flex h-full flex-col gap-2">
      <PageHeader title={title} subtitle={`${local.length} ${local.length === 1 ? noun : many}`}>
        {headerActions}
        {/* The noun moved out of the button and into its label: the plus is the
            same gesture on every list, and the heading directly above it
            already says which list you are on. */}
        <button
          type="button"
          onClick={() => setModal({ kind: "batch" })}
          className={primaryIconButtonClass}
          aria-label={`Add ${many}`}
          title={`Add ${many} — Alt+N`}
        >
          <Icon name="plus" />
        </button>
      </PageHeader>

      <DataTable
        columns={columns}
        rows={rows}
        idKey="id"
        onRowClick={(row) => {
          const record = local.find((r) => r.id === String(row.id));
          if (record) setModal({ kind: "edit", record });
        }}
        emptyMessage={emptyMessage}
        searchPlaceholder={searchPlaceholder}
      />

      {modal?.kind === "batch" &&
        renderBatchDialog({
          onClose: () => setModal(null),
          // The created rows appear immediately — the save already succeeded,
          // and close()'s router.refresh() reconciles the list with what the
          // server stored.
          onDone: (created) => {
            if (created?.length) setLocal((prev) => [...(created as T[]), ...prev]);
            close();
          },
        })}

      {modal?.kind === "edit" && (
        <Dialog title={dialogTitle(modal.record)} onClose={close}>
          <div className="flex flex-col gap-4">{renderEditBody({ record: modal.record, onDone: close })}</div>
        </Dialog>
      )}
    </div>
  );
}

// The red-bordered panel a delete button sits in, so "this is the dangerous one"
// isn't re-styled in every edit popup.
export function DangerZone({ children }: { children: ReactNode }) {
  return <div className="rounded border border-error/30 bg-error-tint p-4">{children}</div>;
}
