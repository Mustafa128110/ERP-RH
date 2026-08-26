"use client";

import { useState } from "react";
import { useNewEntry } from "@/components/layout/KeyboardShortcuts";
import { ProductBatchAddDialog, ProductsBatchEditDialog } from "@/components/modules/ProductForm";
import { MergeProductsDialog } from "@/components/modules/MergeProductsDialog";
import { DataTable } from "@/components/ui/DataTable";
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
}: {
  rows: Row[];
  companyOptions: Option[];
  categoryOptions: Option[];
  brandOptions: Option[];
}) {
  const [batchOpen, setBatchOpen] = useState(false);
  const [mergeOpen, setMergeOpen] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [editOpen, setEditOpen] = useState(false);

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
          onClick={() => setEditOpen(true)}
          disabled={selected.length === 0}
          title={selected.length === 0 ? "Tick the products you want to edit" : undefined}
          className="h-11 rounded border border-sand px-4 text-sm font-medium text-steel hover:bg-ivory disabled:opacity-40 disabled:hover:bg-transparent"
        >
          Edit Selected{selected.length > 0 && ` (${selected.length})`}
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
        columns={columns}
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
    </div>
  );
}
