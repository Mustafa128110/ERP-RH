"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useNewEntry } from "@/components/layout/KeyboardShortcuts";
import { StockPurchaseCreateForm, DeleteStockPurchaseButton } from "@/components/modules/StockPurchaseForm";
import { getStockPurchase, listChequesForPurchases } from "@/lib/actions/purchases";
import { Dialog } from "@/components/ui/Dialog";
import { DataTable } from "@/components/ui/DataTable";
import { PageHeader } from "@/components/ui/PageHeader";
import { CsvActions } from "@/components/ui/CsvActions";
import { exportStockPurchasesCsv, importStockPurchasesCsv } from "@/lib/actions/purchases";
import { PURCHASE_CSV_COLUMNS } from "@/lib/csv-columns";
import { iconButtonClass, primaryIconButtonClass } from "@/components/ui/form-styles";
import { Icon } from "@/components/ui/Icon";
import { StatusPill } from "@/components/ui/StatusPill";
import { DetailHover } from "@/components/ui/DetailHover";
import type { ColumnDef, Row } from "@/lib/table";
import { StockFilter } from "@/components/modules/StockFilters";
import { MergePurchasesDialog } from "@/components/modules/MergePurchasesDialog";

type PurchaseDetail = NonNullable<Awaited<ReturnType<typeof getStockPurchase>>>;

type Option = { id: string; name: string };
type ScopedOption = Option & { companyId: string };
type PurchaseItemRow = { itemName: string; qty: string; unitPrice: string; unitCost: string; lineTotal: string };
type PurchaseBreakdown = {
  subtotal: string;
  discount: string | null;
  tax: string | null;
  shipping: string | null;
  total: string;
};
type PurchaseRow = {
  id: string;
  number: string;
  company: string;
  supplier: string;
  total: string;
  date: string;
  paid: string;
  breakdown: PurchaseBreakdown;
  items: PurchaseItemRow[];
};


type DocumentTypeOption = {
  id: number;
  companyId: string;
  code: string;
  name: string;
  series: string;
  affectsInventory: boolean;
  affectsAccounting: boolean;
  affectsReceivable: boolean;
  affectsPayable: boolean;
  positiveStock: boolean | null;
  active: boolean;
};

export function StockPurchaseManager({
  rows,
  companyId,
  companyOptions,
  supplierOptions,
  itemOptions,
  documentTypeOptions,
  locationOptions,
  unitOptions,
  categoryOptions,
  brandOptions,
  bankAccountOptions,
  cashAccountOptions,
  chequeOptions,
}: {
  rows: PurchaseRow[];
  // Whatever the ?company= filter is set to, so an export hands back the same
  // purchases the list is showing rather than every company in scope.
  companyId?: string;
  companyOptions: Option[];
  supplierOptions: ScopedOption[];
  itemOptions: ScopedOption[];
  documentTypeOptions: DocumentTypeOption[];
  locationOptions: Option[];
  unitOptions: Option[];
  categoryOptions: Option[];
  brandOptions: Option[];
  bankAccountOptions: Option[];
  cashAccountOptions: Option[];
  chequeOptions: Option[];
}) {
  const [open, setOpen] = useState(false);
  const [mergeOpen, setMergeOpen] = useState(false);
  const [editing, setEditing] = useState<PurchaseDetail | null>(null);
  const [editChequeOptions, setEditChequeOptions] = useState<Option[]>(chequeOptions);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const router = useRouter();

  function close() {
    setOpen(false);
    setEditing(null);
    setMergeOpen(false);
    router.refresh();
  }

  async function openEdit(id: string) {
    setLoadingId(id);
    const [detail, cheques] = await Promise.all([getStockPurchase(id), listChequesForPurchases(id)]);
    setLoadingId(null);
    if (detail) {
      setEditing(detail);
      setEditChequeOptions(cheques);
    }
  }

  // Stacked cells: one purchase is several lines, so the item columns list them
  // down the row rather than repeating the header across several rows.
  const stacked = (row: Row, pick: (it: PurchaseItemRow) => string) => {
    const items = (row as unknown as PurchaseRow).items;
    return items.length === 0 ? (
      "—"
    ) : (
      <div className="flex flex-col gap-0.5">
        {items.map((it, i) => (
          <span key={i}>{pick(it)}</span>
        ))}
      </div>
    );
  };

  // Hand-rolled markup before, purely for the hover panel and the stacked line
  // cells — both of which a ColumnDef.render does, so this list gets the shared
  // table's keyboard navigation instead of being the one that hasn't got it.
  const columns: ColumnDef[] = [
    {
      key: "number",
      label: "Number",
      render: (row) => {
        const r = row as unknown as PurchaseRow;
        return (
          <DetailHover
            trigger={
              <span className="cursor-pointer font-semibold text-navy-800 hover:text-brass-700">
                {r.number}
                {loadingId === r.id ? "…" : ""}
              </span>
            }
            heading={r.number}
            // Subtotal, then only the adjustments this purchase actually has.
            rows={[
              { label: "Subtotal", value: r.breakdown.subtotal },
              ...(r.breakdown.discount ? [{ label: "Discount", value: <span className="text-success">-{r.breakdown.discount}</span> }] : []),
              ...(r.breakdown.tax ? [{ label: "Tax", value: `+${r.breakdown.tax}` }] : []),
              ...(r.breakdown.shipping ? [{ label: "Shipping", value: `+${r.breakdown.shipping}` }] : []),
              { label: "Total", value: <span className="font-semibold text-navy-800">{r.breakdown.total}</span> },
            ]}
            footer={`${r.items.length} line(s) · ${r.supplier}`}
          />
        );
      },
    },
    // Date second: after the number, it's what a row gets found by. Supplier and
    // company go to the far end — they're what a row is checked against once
    // it's found, not what it's scanned for.
    { key: "date", label: "Date" },
    { key: "item", label: "Item", render: (row) => stacked(row, (it) => it.itemName) },
    { key: "qty", label: "Qty", align: "right", render: (row) => stacked(row, (it) => it.qty) },
    { key: "unitPrice", label: "Unit Price", align: "right", render: (row) => stacked(row, (it) => it.unitPrice) },
    // Price plus this unit's share of the delivery's shipping, discount and tax
    // — what the piece actually cost, and what the rate list quotes the next
    // sale from.
    { key: "unitCost", label: "Unit Cost", align: "right", render: (row) => stacked(row, (it) => it.unitCost) },
    { key: "lineTotal", label: "Item Total", align: "right", render: (row) => stacked(row, (it) => it.lineTotal) },
    {
      key: "total",
      label: "Total",
      align: "right",
      render: (row) => (
        <div className="flex flex-col items-end gap-1">
          <span className="font-semibold">{String(row.total)}</span>
          <StatusPill value={row.paid} />
        </div>
      ),
    },
    { key: "supplier", label: "Supplier" },
    { key: "company", label: "Company" },
  ];

  useNewEntry(() => setOpen(true));

  return (
    <div className="flex h-full flex-col gap-2">
      <PageHeader title="Stock Purchase" subtitle={`${rows.length} purchase(s)`}>
        {/* Same ?company= filter the stock page uses. */}
        <StockFilter param="company" allLabel="All Companies" options={companyOptions} />
        <button
          type="button"
          onClick={() => setMergeOpen(true)}
          className={iconButtonClass}
          aria-label="Merge purchases"
          title="Merge purchases"
        >
          <Icon name="merge" />
        </button>
        <CsvActions
          columns={PURCHASE_CSV_COLUMNS}
          name="stock-purchases"
          onImport={importStockPurchasesCsv}
          onExport={() => exportStockPurchasesCsv(companyId)}
          onDone={() => router.refresh()}
        />
        <button
          type="button"
          onClick={() => setOpen(true)}
          className={primaryIconButtonClass}
          aria-label="New purchase"
          title="New purchase — Alt+N"
        >
          <Icon name="plus" />
        </button>
      </PageHeader>

      <DataTable
        columns={columns}
        rows={rows as unknown as Row[]}
        idKey="id"
        onRowClick={(row) => void openEdit(String(row.id))}
        emptyMessage="No purchases yet."
        searchPlaceholder="Search purchases…"
      />

      {mergeOpen && <MergePurchasesDialog onClose={() => setMergeOpen(false)} onDone={close} />}

      {open && (
        <Dialog title="New Stock Purchase" onClose={close} size="xwide">
          <StockPurchaseCreateForm
            companyOptions={companyOptions}
            supplierOptions={supplierOptions}
            itemOptions={itemOptions}
            documentTypeOptions={documentTypeOptions}
            locationOptions={locationOptions}
            unitOptions={unitOptions}
            categoryOptions={categoryOptions}
            brandOptions={brandOptions}
            bankAccountOptions={bankAccountOptions}
            cashAccountOptions={cashAccountOptions}
            chequeOptions={chequeOptions}
            onDone={close}
          />
        </Dialog>
      )}

      {editing && (
        <Dialog title="Edit Stock Purchase" onClose={close} size="xwide">
          <div className="flex flex-col gap-4">
            <StockPurchaseCreateForm
              purchaseId={editing.id}
              defaults={editing}
              companyOptions={companyOptions}
              supplierOptions={supplierOptions}
              itemOptions={itemOptions}
              documentTypeOptions={documentTypeOptions}
              locationOptions={locationOptions}
              unitOptions={unitOptions}
              categoryOptions={categoryOptions}
              brandOptions={brandOptions}
              bankAccountOptions={bankAccountOptions}
              cashAccountOptions={cashAccountOptions}
              chequeOptions={editChequeOptions}
              onDone={close}
            />
            <div className="rounded border border-error/30 bg-error-tint p-4">
              <DeleteStockPurchaseButton purchaseId={editing.id} onDone={close} />
            </div>
          </div>
        </Dialog>
      )}
    </div>
  );
}
