"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { getInvoice, getSale, listChequesForSales, type SaleItemRow } from "@/lib/actions/sales";
import { SaleFormPage } from "@/components/modules/SaleForm";
import { SaleItemsHover } from "@/components/modules/SaleItemsHover";
import { DataTable } from "@/components/ui/DataTable";
import { Dialog } from "@/components/ui/Dialog";
import { PageHeader } from "@/components/ui/PageHeader";
import { ListFilters } from "@/components/ui/ListFilters";
import { StockFilter } from "@/components/modules/StockFilters";
import { SALE_TYPES } from "@/lib/sale-constants";
import { money } from "@/lib/format";
import { downloadInvoicePdf, type Invoice } from "@/lib/invoice-pdf";
import { downloadInvoicePng } from "@/lib/invoice-png";
import { InvoiceImageRenderer } from "@/components/modules/InvoiceDocument";
import type { ColumnDef, Row } from "@/lib/table";

type Option = { id: string; name: string };
type ScopedOption = Option & { companyId: string };
type ItemOption = ScopedOption & { rate: string | null; salesRate: string | null };

// Options the edit form needs. Loaded once with the page rather than on every
// popup — they're the same lists for every invoice.
export type SaleFormOptions = {
  companyOptions: Option[];
  customerOptions: ScopedOption[];
  itemOptions: ItemOption[];
  locationOptions: Option[];
  unitOptions: Option[];
  bankAccountOptions: Option[];
  cashAccountOptions: ScopedOption[];
  chequeOptions: Option[];
};

type SaleDetail = NonNullable<Awaited<ReturnType<typeof getSale>>>;

// The invoice number column lives in the component — it needs the line items,
// which the row itself can't carry (a Row holds primitives).
// Read left to right the way an invoice is asked about: which one, when, who,
// then the money, then how it stands. Age and type come after that — they
// qualify a row you've already found rather than help you find it — and the two
// download buttons sit at the far end.
const columns: ColumnDef[] = [
  { key: "date", label: "Date" },
  { key: "customer", label: "Customer" },
  { key: "total", label: "Total", align: "right" },
  { key: "paid", label: "Paid", align: "right" },
  { key: "balance", label: "Balance", align: "right" },
  { key: "status", label: "Status", badge: true },
  { key: "age", label: "Age", align: "right" },
  { key: "saleType", label: "Type" },
];

// The invoice list is where sales are read back and corrected. A row opens the
// sale itself in a popup — the same form that entered it, so Save and Delete are
// right there — rather than the printable copy, which is a different job and
// lives behind the Print button on the popup.
export function InvoiceManager({
  rows,
  count,
  outstanding,
  filtered,
  formOptions,
  itemsById,
}: {
  rows: Row[];
  count: number;
  outstanding: number;
  filtered: boolean;
  formOptions: SaleFormOptions;
  // Line items per invoice id. A Row only holds primitives, so the hover panel
  // reads them from here rather than off the row.
  itemsById: Record<string, SaleItemRow[]>;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<string[]>([]);
  const [editing, setEditing] = useState<SaleDetail | null>(null);
  const [chequeOptions, setChequeOptions] = useState(formOptions.chequeOptions);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [pdfId, setPdfId] = useState<string | null>(null);
  const [pngId, setPngId] = useState<string | null>(null);
  // The invoice currently being turned into a picture, mounted off-screen for
  // the moment it takes to photograph it.
  const [imaging, setImaging] = useState<Invoice | null>(null);
  const capturing = useRef(false);

  function close() {
    setEditing(null);
    router.refresh();
  }

  async function openEdit(id: string) {
    setLoadingId(id);
    const [detail, cheques] = await Promise.all([getSale(id), listChequesForSales(id)]);
    setLoadingId(null);
    if (!detail) return;
    setChequeOptions(cheques);
    setEditing(detail);
  }

  // The list rows carry only what the table shows, so the line items and both
  // addresses are fetched per download — one round trip, on click, for either
  // format. The image renders the invoice component off-screen to photograph it
  // (InvoiceDocument.tsx); the PDF draws itself.
  async function download(id: string, format: "pdf" | "png") {
    const setPending = format === "pdf" ? setPdfId : setPngId;
    setPending(id);
    try {
      const invoice = await getInvoice(id);
      if (!invoice) return;
      if (format === "pdf") {
        downloadInvoicePdf(invoice);
        return;
      }
      // The picture is taken off a rendered invoice, and there isn't one in a
      // list — so mount one out of sight and let it say when it's ready. The
      // pending state clears there, not here.
      setImaging(invoice);
    } finally {
      if (format === "pdf") setPending(null);
    }
  }

  // Called by the off-screen copy once the browser has laid it out.
  //
  // Latched on a ref, not on state: in development React mounts that copy twice
  // to check it cleans up after itself, and each mount is its own component with
  // its own refs — so the guard has to live out here, above both of them, or one
  // click saves the invoice twice.
  async function captureImage(node: HTMLElement) {
    if (!imaging || capturing.current) return;
    capturing.current = true;
    try {
      await downloadInvoicePng(node, imaging);
    } finally {
      capturing.current = false;
      setImaging(null);
      setPngId(null);
    }
  }

  // Hovering the number shows what was on the invoice — item names and
  // quantities — so "what was SI-0007?" is answered without opening it.
  const numberColumn: ColumnDef = {
    key: "number",
    label: "Invoice #",
    render: (row) => <SaleItemsHover number={String(row.number)} items={itemsById[String(row.id)] ?? []} />,
  };

  // Appended here rather than in the module-level list because they need the
  // per-row pending state.
  const downloadColumn = (format: "pdf" | "png", pendingId: string | null): ColumnDef => ({
    key: format,
    label: "",
    render: (row) => (
      <button
        type="button"
        title={`Download ${format.toUpperCase()}`}
        aria-label={`Download invoice ${String(row.number)} as ${format.toUpperCase()}`}
        disabled={pendingId === String(row.id)}
        // Both stopped: the cell opens the edit popup on click, and the row
        // takes the selection on mousedown. Neither should fire for this button.
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          void download(String(row.id), format);
        }}
        className="rounded border border-sand px-2 py-1 text-xs font-medium text-navy-800 hover:bg-ivory disabled:opacity-40"
      >
        {pendingId === String(row.id) ? "…" : format.toUpperCase()}
      </button>
    ),
  });

  const subtitle =
    selected.length > 0
      ? `${selected.length} of ${count} invoice(s) selected`
      : `${count} invoice(s)${filtered ? " matching" : ""} · ${money(outstanding)} outstanding`;

  return (
    <div className="flex h-full flex-col gap-2">
      <PageHeader title="Invoices" subtitle={subtitle}>
        <ListFilters>
          <StockFilter
            param="saleType"
            allLabel="All Types"
            options={SALE_TYPES.map((t) => ({ id: t.value, name: t.label }))}
          />
          <StockFilter
            param="status"
            allLabel="All Invoices"
            options={[
              { id: "outstanding", name: "Outstanding" },
              { id: "paid", name: "Settled" },
            ]}
          />
        </ListFilters>
      </PageHeader>

      <DataTable
        columns={[numberColumn, ...columns, downloadColumn("pdf", pdfId), downloadColumn("png", pngId)]}
        rows={rows}
        idKey="id"
        onRowClick={(row) => void openEdit(String(row.id))}
        selected={selected}
        onSelectedChange={setSelected}
        // One invoice at a time: a sale is a document with its own lines and
        // settlement, so "edit these six together" isn't a thing that exists
        // here. Ctrl+Enter opens the first of the ticked rows.
        onBatchEdit={() => selected[0] && void openEdit(selected[0])}
        emptyMessage={filtered ? "No invoices match these filters." : "No invoices yet — raise one from Sales."}
        searchPlaceholder="Search invoices…"
      />

      {loadingId && <p className="shrink-0 text-sm text-steel">Opening…</p>}

      {imaging && <InvoiceImageRenderer invoice={imaging} onReady={(node) => void captureImage(node)} />}

      {editing && (
        <Dialog title="Edit Sale" onClose={close} size="xwide">
          <div className="flex flex-col gap-3">
            {/* The printable copy still exists, one click away — it just isn't
                what a row opens any more. */}
            <Link href={`/sales/invoices/${editing.id}`} className="w-fit text-sm font-medium text-navy-800 hover:underline">
              Printable invoice ↗
            </Link>
            <SaleFormPage saleId={editing.id} defaults={editing} {...formOptions} chequeOptions={chequeOptions} onDone={close} />
          </div>
        </Dialog>
      )}
    </div>
  );
}
