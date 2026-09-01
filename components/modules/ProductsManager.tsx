"use client";

import { useMemo, useState } from "react";
import { useNewEntry } from "@/components/layout/KeyboardShortcuts";
import { ProductBatchAddDialog, ProductsBatchEditDialog } from "@/components/modules/ProductForm";
import { MergeProductsDialog } from "@/components/modules/MergeProductsDialog";
import { ProductAssignmentDialog } from "@/components/modules/ProductAssignmentDialog";
import { DataTable } from "@/components/ui/DataTable";
import { Dialog } from "@/components/ui/Dialog";
import { PageHeader } from "@/components/ui/PageHeader";
import { DetailHover } from "@/components/ui/DetailHover";
import { CsvActions } from "@/components/ui/CsvActions";
import { exportProductsCsv, importProductsCsv } from "@/lib/actions/products";
import { PRODUCT_CSV_COLUMNS } from "@/lib/csv-columns";
import { primaryIconButtonClass } from "@/components/ui/form-styles";
import { Icon } from "@/components/ui/Icon";
import { useOptimisticRecords } from "@/lib/use-optimistic-records";
import type { ColumnDef, Row } from "@/lib/table";

// No S.No column here — DataTable numbers every row itself.
const columns: ColumnDef[] = [
  {
    key: "setup",
    label: "Setup",
    render: (row) => (
      <span className="inline-flex items-center gap-1" aria-label="Product setup status">
        {row._missingCategory === true && <span title="Missing category" className="h-2.5 w-2.5 rounded-full bg-red-500" />}
        {row._hasUnitRule !== true && <span title="No unit rule" className="h-2.5 w-2.5 rounded-full bg-blue-500" />}
        {row._hasBaseUnit !== true && <span title="No base stock unit" className="h-2.5 w-2.5 rounded-full bg-green-500" />}
      </span>
    ),
  },
  { key: "sku", label: "SKU", hideOnMobile: true },
  {
    key: "name",
    label: "Item Name",
    sortable: true,
    // Product names remain plain database values.  Setup state is intentionally
    // kept in its own column so a red marker never becomes part of the name.
    render: (row) => (
      <DetailHover
        trigger={String(row.name)}
        heading={String(row.name)}
        rows={[
          { label: "SKU", value: String(row.sku) },
          { label: "On hand", value: String(row.onHand) },
          { label: "Category", value: String(row.category) },
          { label: "Brand", value: String(row.brand) },
          { label: "Company", value: String(row.company) },
        ]}
        footer={row._missingCategory === true ? "Created from a sale or purchase line — no category yet." : undefined}
        extraHeight={row._missingCategory === true ? 16 : 0}
      />
    ),
  },
  { key: "salesRate", label: "Sales Rate", align: "right" },
  { key: "rate1", label: "Purchase Rate 1", align: "right" },
  { key: "rate2", label: "Purchase Rate 2", align: "right" },
  { key: "rate3", label: "Purchase Rate 3", align: "right" },
];

type Option = { id: string; name: string };
type SetupDot = Option & { kind: "rule" | "base-unit"; color: string };

// One palette is shared by rules and base units. Hues are spread evenly across
// the full wheel (the largest possible minimum gap for the current number of
// entries), while alternating lightness makes neighbouring hues easier to tell
// apart. Every entry receives a unique CSS colour.
function setupDots(ruleOptions: Option[], unitOptions: Option[]): SetupDot[] {
  const entries = [
    ...ruleOptions.map((option) => ({ ...option, kind: "rule" as const })),
    ...unitOptions.map((option) => ({ ...option, kind: "base-unit" as const })),
  ]
    .sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  const count = Math.max(entries.length, 1);
  return entries.map((entry, index) => ({
    ...entry,
    color: `hsl(${Math.round((index * 360) / count)} 78% ${index % 2 === 0 ? 43 : 58}%)`,
  }));
}

function LegendDot({ color, title }: { color: string; title: string }) {
  return <span title={title} className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: color }} />;
}

// Rates are derived, not stored — the three purchase rates come from the
// rate_list view, the sales rate from the item's last sales invoice line — so
// the rate columns are read-only. Products are created in batch (or on the fly
// from a sale/purchase line), which is how they end up half-filled; tick the
// ones to fix and Edit Selected opens them together in one grid. Rows are not
// click-to-edit — the tick box is the only way in, so dragging to read a long
// row can't open a dialog by accident.
export function ProductsManager({
  rows,
  companyOptions,
  categoryOptions,
  brandOptions,
  unitOptions,
  ruleOptions,
}: {
  rows: Row[];
  companyOptions: Option[];
  categoryOptions: Option[];
  brandOptions: Option[];
  unitOptions: Option[];
  ruleOptions: Option[];
}) {
  const [batchOpen, setBatchOpen] = useState(false);
  const [mergeOpen, setMergeOpen] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [editOpen, setEditOpen] = useState(false);
  const [assignment, setAssignment] = useState<"rule" | "base-unit" | null>(null);
  const [dotHelpOpen, setDotHelpOpen] = useState(false);
  const dots = useMemo(() => setupDots(ruleOptions, unitOptions), [ruleOptions, unitOptions]);
  const dotByKey = useMemo(() => new Map(dots.map((dot) => [`${dot.kind}:${dot.id}`, dot])), [dots]);
  const tableColumns = useMemo<ColumnDef[]>(() => [
    columns[0],
    {
      key: "unitRules",
      label: "Unit Rules",
      render: (row) => {
        const ruleIds = String(row._ruleIds ?? "").split(",").filter(Boolean);
        const assigned = ruleIds
          .map((id) => dotByKey.get(`rule:${id}`))
          .filter((dot): dot is SetupDot => Boolean(dot));
        if (assigned.length === 0) return <span className="text-steel">—</span>;
        return (
          <span className="inline-flex max-w-32 flex-wrap items-center gap-1.5" aria-label={assigned.map((dot) => `Rule: ${dot.name}`).join(", ")}>
            {assigned.map((dot) => (
              <span
                key={`${dot.kind}:${dot.id}`}
                title={`Rule: ${dot.name}`}
                className="h-2.5 w-2.5 rounded-full"
                style={{ backgroundColor: dot.color }}
              />
            ))}
          </span>
        );
      },
    },
    {
      key: "baseQuantity",
      label: "Base Quantity",
      render: (row) => {
        const baseUnitId = String(row._baseUnitId ?? "");
        const dot = baseUnitId ? dotByKey.get(`base-unit:${baseUnitId}`) : undefined;
        if (!dot) return <span className="text-steel">—</span>;
        return (
          <span className="inline-flex items-center" aria-label={`Base unit: ${dot.name}`}>
            <span title={`Base unit: ${dot.name}`} className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: dot.color }} />
          </span>
        );
      },
    },
    ...columns.slice(1),
  ], [dotByKey]);

  // Rows the list shows, which is the server's list plus whatever is in flight.
  // The edit grid changes several products at once, so this is where the batch
  // stops being a wait and becomes a list that has already moved: every ticked
  // row takes its typed name, code, category and brand on the press and fades
  // until the payload lands. The rate columns are derived server-side and the
  // grid can't edit them, so they are left alone rather than guessed at.
  const { records: shown, pending, patch } = useOptimisticRecords(rows, "id");

  function closeBatch() {
    setBatchOpen(false);
  }

  function closeMerge() {
    setMergeOpen(false);
  }

  function closeEdit() {
    setEditOpen(false);
    // The saved rows are no longer the ones that needed fixing, so leaving them
    // ticked invites a second pass over work already done.
    setSelected([]);
  }

  useNewEntry(() => setBatchOpen(true));

  return (
    <div className="flex h-full flex-col gap-2">
      <PageHeader
        title="Products"
        subtitle={selected.length > 0 ? `${selected.length} of ${shown.length} item(s) selected` : `${shown.length} item(s)`}
      >
        <button
          type="button"
          onClick={() => setDotHelpOpen(true)}
          className="h-11 rounded border border-sand px-4 text-sm font-medium text-steel hover:bg-ivory"
        >
          Dot Guide
        </button>
        <button
          type="button"
          onClick={() => setEditOpen(true)}
          disabled={selected.length === 0}
          title={selected.length === 0 ? "Tick the products you want to edit" : undefined}
          className="h-11 rounded border border-sand px-4 text-sm font-medium text-steel hover:bg-ivory disabled:opacity-40 disabled:hover:bg-transparent"
        >
          Edit Selected{selected.length > 0 && ` (${selected.length})`}
        </button>
        <button
          type="button"
          onClick={() => setAssignment("rule")}
          disabled={selected.length === 0}
          title={selected.length === 0 ? "Tick the products that should use the rule" : undefined}
          className="h-11 rounded border border-sand px-4 text-sm font-medium text-steel hover:bg-ivory disabled:opacity-40 disabled:hover:bg-transparent"
        >
          Assign Rule
        </button>
        <button
          type="button"
          onClick={() => setAssignment("base-unit")}
          disabled={selected.length === 0}
          title={selected.length === 0 ? "Tick the products that should use the base unit" : undefined}
          className="h-11 rounded border border-sand px-4 text-sm font-medium text-steel hover:bg-ivory disabled:opacity-40 disabled:hover:bg-transparent"
        >
          Assign Base Unit
        </button>
        <button
          type="button"
          onClick={() => setMergeOpen(true)}
          className="h-11 rounded border border-sand px-4 text-sm font-medium text-steel hover:bg-ivory"
        >
          Merge Products
        </button>
        <CsvActions
          columns={PRODUCT_CSV_COLUMNS}
          name="products"
          onImport={importProductsCsv}
          onExport={exportProductsCsv}
          onDone={() => undefined}
        />
        <button
          type="button"
          onClick={() => setBatchOpen(true)}
          className={primaryIconButtonClass}
          aria-label="Add products"
          title="Add products — Alt+N"
        >
          <Icon name="plus" />
        </button>
      </PageHeader>

      {/* Ctrl+Enter on a ticked set is the same button as Edit Selected — the
          keyboard route through the list ends where the mouse route does. */}
      <DataTable
        columns={tableColumns}
        rows={shown}
        idKey="id"
        selected={selected}
        onSelectedChange={setSelected}
        onBatchEdit={() => setEditOpen(true)}
        pendingIds={pending}
        searchPlaceholder="Search products…"
      />

      {editOpen && (
        // Hidden rather than closed while the batch is in the air. The grid holds
        // a screenful of typed cells across however many products were ticked, so
        // a refusal has to find them all still there — a closed dialog would have
        // thrown the lot away. `pending` empties when the save settles, so an
        // error brings the grid straight back and a success closes it for real
        // from onDone.
        <ProductsBatchEditDialog
          itemIds={selected}
          companyOptions={companyOptions}
          categoryOptions={categoryOptions}
          brandOptions={brandOptions}
          hidden={selected.some((id) => pending.includes(id))}
          onClose={() => setEditOpen(false)}
          onDone={closeEdit}
          onSaving={(edits) => edits.forEach((e) => patch(e.id, e.values))}
        />
      )}

      {batchOpen && (
        <ProductBatchAddDialog
          companyOptions={companyOptions}
          categoryOptions={categoryOptions}
          brandOptions={brandOptions}
          onClose={() => setBatchOpen(false)}
          onDone={closeBatch}
        />
      )}

      {mergeOpen && <MergeProductsDialog onClose={() => setMergeOpen(false)} onDone={closeMerge} />}

      {assignment && (
        <ProductAssignmentDialog
          kind={assignment}
          itemIds={selected}
          options={assignment === "rule" ? ruleOptions : unitOptions}
          onClose={() => setAssignment(null)}
          onDone={() => {
            setAssignment(null);
            setSelected([]);
          }}
        />
      )}

      {dotHelpOpen && (
        <Dialog title="Product Setup Dot Guide" size="wide" onClose={() => setDotHelpOpen(false)}>
          <div className="flex flex-col gap-5 text-sm">
            <div>
              <h3 className="font-semibold text-navy-800">Setup column</h3>
              <p className="mt-1 text-steel">These dots identify missing product setup.</p>
              <div className="mt-3 grid gap-2 sm:grid-cols-3">
                <div className="flex items-center gap-2"><span className="h-3 w-3 rounded-full bg-red-500" /> Missing category</div>
                <div className="flex items-center gap-2"><span className="h-3 w-3 rounded-full bg-blue-500" /> No unit rule</div>
                <div className="flex items-center gap-2"><span className="h-3 w-3 rounded-full bg-green-500" /> No base stock unit</div>
              </div>
            </div>

            <div>
              <h3 className="font-semibold text-navy-800">Assigned unit rules</h3>
              <p className="mt-1 text-steel">Every product assigned to a rule shows that rule&apos;s dot in Unit Rules.</p>
              <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {dots.filter((dot) => dot.kind === "rule").map((dot) => (
                  <div key={`rule:${dot.id}`} className="flex items-center gap-2"><LegendDot color={dot.color} title={`Rule: ${dot.name}`} /> {dot.name}</div>
                ))}
                {ruleOptions.length === 0 && <p className="text-steel">No unit rules yet.</p>}
              </div>
            </div>

            <div>
              <h3 className="font-semibold text-navy-800">Base stock units</h3>
              <p className="mt-1 text-steel">Products with the same base unit show the same dot in Base Quantity.</p>
              <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {dots.filter((dot) => dot.kind === "base-unit").map((dot) => (
                  <div key={`base:${dot.id}`} className="flex items-center gap-2"><LegendDot color={dot.color} title={`Base quantity: ${dot.name}`} /> {dot.name}</div>
                ))}
                {unitOptions.length === 0 && <p className="text-steel">No units yet.</p>}
              </div>
            </div>
          </div>
        </Dialog>
      )}
    </div>
  );
}
