"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
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
import type { ColumnDef, Row } from "@/lib/table";

// No S.No column here — DataTable numbers every row itself.
const columns: ColumnDef[] = [
  {
    key: "name",
    label: "Item Name",
    // The list is four rate columns wide and says nothing about whether there is
    // any of the thing, what it is, or whose catalogue it belongs to. That is
    // the first question anyone asks about a product, so it hangs off the name.
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
        footer={row._incomplete === true ? "Created from a sale or purchase line — no category yet." : undefined}
        extraHeight={row._incomplete === true ? 16 : 0}
      />
    ),
  },
  { key: "rate1", label: "Purchase Rate 1", align: "right" },
  { key: "rate2", label: "Purchase Rate 2", align: "right" },
  { key: "rate3", label: "Purchase Rate 3", align: "right" },
  { key: "salesRate", label: "Sales Rate", align: "right" },
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
  const router = useRouter();

  function closeBatch() {
    setBatchOpen(false);
    router.refresh();
  }

  function closeMerge() {
    setMergeOpen(false);
    router.refresh();
  }

  function closeEdit() {
    setEditOpen(false);
    // The saved rows are no longer the ones that needed fixing, so leaving them
    // ticked invites a second pass over work already done.
    setSelected([]);
    router.refresh();
  }

  useNewEntry(() => setBatchOpen(true));

  return (
    <div className="flex h-full flex-col gap-2">
      <PageHeader
        title="Products"
        subtitle={selected.length > 0 ? `${selected.length} of ${rows.length} item(s) selected` : `${rows.length} item(s)`}
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
          onDone={() => router.refresh()}
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
        rows={rows}
        idKey="id"
        selected={selected}
        onSelectedChange={setSelected}
        onBatchEdit={() => setEditOpen(true)}
        searchPlaceholder="Search products…"
      />

      {editOpen && (
        <ProductsBatchEditDialog
          itemIds={selected}
          companyOptions={companyOptions}
          categoryOptions={categoryOptions}
          brandOptions={brandOptions}
          onClose={() => setEditOpen(false)}
          onDone={closeEdit}
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
