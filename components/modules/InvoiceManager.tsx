"use client";

import { useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { getInvoice, getSale, listChequesForSales } from "@/lib/actions/sales";
import { SaleFormPage } from "@/components/modules/SaleForm";
import { DataTable } from "@/components/ui/DataTable";
import { DetailHover } from "@/components/ui/DetailHover";
import { Dialog } from "@/components/ui/Dialog";
import { PageHeader } from "@/components/ui/PageHeader";
import { money, todayISO } from "@/lib/format";
import { cancelSalesReturn, createSalesReturn, getReturnableSale } from "@/lib/actions/returns";
import { downloadInvoicePdf, type Invoice } from "@/lib/invoice-pdf";
import { downloadInvoicePng } from "@/lib/invoice-png";
import { InvoiceImageRenderer } from "@/components/modules/InvoiceDocument";
import { useOptimisticRecords } from "@/lib/use-optimistic-records";
import type { ColumnDef, Row } from "@/lib/table";
import type { UnitConversionOption } from "@/lib/unit-conversion";

type Option = { id: string; name: string };
type ScopedOption = Option & { companyId: string };
type ItemOption = ScopedOption & { rate: string | null; salesRate: string | null; baseUnitId: string | null; taxable: boolean };

// Options the edit form needs. Loaded once with the page rather than on every
// popup — they're the same lists for every invoice.
export type SaleFormOptions = {
  companyOptions: Option[];
  customerOptions: ScopedOption[];
  itemOptions: ItemOption[];
  unitOptions: Option[];
  bankAccountOptions: Option[];
  cashAccountOptions: ScopedOption[];
  chequeOptions: Option[];
  taxOptions: (Option & { rate: string })[];
  conversionOptions: UnitConversionOption[];
  taxSettings: Record<string, Record<string, string>>;
};

type SaleDetail = NonNullable<Awaited<ReturnType<typeof getSale>>>;
type ChequeOptions = Awaited<ReturnType<typeof listChequesForSales>>;
type ReturnableSale = NonNullable<Awaited<ReturnType<typeof getReturnableSale>>>;

// The invoice number column lives in the component — it needs the line items,
// which the row itself can't carry (a Row holds primitives).
// Read left to right the way an invoice is asked about: which one, when, who,
// then the money, then how it stands. Age and type come after that — they
// qualify a row you've already found rather than help you find it — and the two
// download buttons sit at the far end.
type InvoiceItem = { name: string; qty: string; rate: string; unit: string };

const columns: ColumnDef[] = [
  { key: "date", label: "Date" },
  { key: "customer", label: "Customer" },
  { key: "company", label: "Company" },
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
  itemsBySaleId,
}: {
  rows: Row[];
  count: number;
  outstanding: number;
  filtered: boolean;
  formOptions: SaleFormOptions;
  itemsBySaleId?: Map<string, InvoiceItem[]>;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [editing, setEditing] = useState<SaleDetail | null>(null);
  const [chequeOptions, setChequeOptions] = useState(formOptions.chequeOptions);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [pdfId, setPdfId] = useState<string | null>(null);
  const [pngId, setPngId] = useState<string | null>(null);
  const [returning, setReturning] = useState<ReturnableSale | null>(null);
  const [returnQuantities, setReturnQuantities] = useState<Record<string, string>>({});
  const [returnBusy, setReturnBusy] = useState(false);
  const [returnError, setReturnError] = useState<string | null>(null);
  const returnOperationId = useRef("");
  // The invoice currently being turned into a picture, mounted off-screen for
  // the moment it takes to photograph it.
  const [imaging, setImaging] = useState<Invoice | null>(null);
  const capturing = useRef(false);

  // Rows the list shows, which is the server's list plus whatever is in flight.
  // The rows here are already-formatted table rows, so a saved edit changes no
  // cell until the payload lands — nothing is guessed at, least of all money.
  // What it does buy is the fade and the instant delete, and those are what the
  // wait was actually costing.
  const { records: shown, pending, patch, remove } = useOptimisticRecords(rows, "id");

  // Details already fetched, keyed by sale id. Opening a row costs two round
  // trips to a database 170ms away; a pointer resting on the row is enough notice
  // to have made them already. Kept on a ref so warming never renders.
  const warmed = useRef(new Map<string, { detail: SaleDetail; cheques: ChequeOptions }>());
  const warming = useRef(new Set<string>());

  async function warm(id: string) {
    if (warmed.current.has(id) || warming.current.has(id)) return;
    warming.current.add(id);
    try {
      const [detail, cheques] = await Promise.all([getSale(id), listChequesForSales(id)]);
      if (detail) warmed.current.set(id, { detail, cheques });
    } catch {
      // A failed warm is not a failure — the click below will ask again, and if
      // the network is genuinely gone that is where it belongs to be reported.
    } finally {
      warming.current.delete(id);
    }
  }

  // Called from inside the form's own action when a save or a cancellation starts,
  // and it is not housekeeping: the warm copy above was taken before this write,
  // so handing it to the next open would show the sale as it used to be — worse
  // than the round trip it saves.
  function forgetWarm(id: string) {
    warmed.current.delete(id);
  }

  function close() {
    setEditing(null);
  }

  async function openEdit(id: string) {
    const ready = warmed.current.get(id);
    if (ready) {
      setChequeOptions(ready.cheques);
      setEditing(ready.detail);
      return;
    }
    setLoadingId(id);
    const [detail, cheques] = await Promise.all([getSale(id), listChequesForSales(id)]);
    setLoadingId(null);
    if (!detail) return;
    // Worth keeping even though this open is already paid for: the same row is
    // often opened twice in a row while a correction is being worked out.
    warmed.current.set(id, { detail, cheques });
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

  async function openReturn(id: string) {
    setReturnError(null);
    setLoadingId(id);
    try {
      const sale = await getReturnableSale(id);
      if (!sale) return;
      setReturning(sale);
      setReturnQuantities(Object.fromEntries(sale.lines.map((line) => [line.sourceLineId, ""])));
      returnOperationId.current = crypto.randomUUID();
    } finally {
      setLoadingId(null);
    }
  }

  async function saveReturn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!returning || returnBusy) return;
    setReturnBusy(true);
    setReturnError(null);
    const formData = new FormData(event.currentTarget);
    formData.set("linesJson", JSON.stringify(returning.lines.map((line) => ({ sourceLineId: line.sourceLineId, quantity: returnQuantities[line.sourceLineId] ?? "" }))));
    formData.set("operationId", returnOperationId.current || crypto.randomUUID());
    try {
      const result = await createSalesReturn(undefined, formData);
      if (result.error) return setReturnError(result.error);
      setReturning(null);
    } catch {
      setReturnError("Couldn't reach the server. The return was not confirmed; check the invoice before trying again.");
    } finally {
      setReturnBusy(false);
    }
  }

  async function cancelReturn(documentId: string) {
    if (!returning || returnBusy || !confirm("Cancel this sales return? Its stock and customer-credit effects will be reversed.")) return;
    setReturnBusy(true);
    setReturnError(null);
    const formData = new FormData();
    formData.set("documentId", documentId);
    try {
      const result = await cancelSalesReturn(undefined, formData);
      if (result.error) return setReturnError(result.error);
      const refreshed = await getReturnableSale(returning.id);
      if (refreshed) setReturning(refreshed);
    } catch {
      setReturnError("Couldn't confirm the cancellation. Check the return history before trying again.");
    } finally {
      setReturnBusy(false);
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

  const returnColumn: ColumnDef = {
    key: "return",
    label: "",
    render: (row) => String(row.status) === "Cancelled" ? "—" : (
      <button
        type="button"
        onMouseDown={(event) => event.stopPropagation()}
        onClick={(event) => { event.stopPropagation(); void openReturn(String(row.id)); }}
        className="rounded border border-sand px-2 py-1 text-xs font-medium text-navy-800 hover:bg-ivory"
      >
        Return
      </button>
    ),
  };

  // Customer column with a hover showing the items on that invoice.
  const customerCol: ColumnDef = {
    key: "customer",
    label: "Customer",
    sortable: true,
    render: (row) => {
      const id = String(row.id);
      const items = itemsBySaleId?.get(id);
      if (!items || items.length === 0) return String(row.customer ?? "—");
      return (
        <DetailHover trigger={<span className="border-b border-dotted border-steel">{String(row.customer ?? "—")}</span>} width={380}>
          <div className="flex flex-col">
            <div className="grid grid-cols-[1fr_auto_auto] gap-x-4 border-b-2 border-sand pb-1 text-[10px] font-semibold uppercase tracking-wide text-steel">
              <span>Item</span>
              <span className="text-right">Qty</span>
              <span className="text-right">Rate</span>
            </div>
            {items.map((it, i) => (
              <div key={i} className="grid grid-cols-[1fr_auto_auto] gap-x-4 border-b border-sand/50 py-1.5 last:border-0">
                <span className="truncate pr-2 text-sm text-ink">{it.name}</span>
                <span className="w-16 text-right text-sm tabular-nums text-ink">{it.qty}</span>
                <span className="w-24 text-right text-sm tabular-nums font-medium text-ink">{it.rate}</span>
              </div>
            ))}
          </div>
        </DetailHover>
      );
    },
  };

  const allColumns = columns.map((c) => (c.key === "customer" ? customerCol : c));

  const subtitle =
    selected.length > 0
      ? `${selected.length} of ${count} invoice(s) selected`
      : `${count} invoice(s)${filtered ? " matching" : ""} · ${money(outstanding)} outstanding`;

  return (
    <div className="flex h-full flex-col gap-2">
      <PageHeader title="Invoices" subtitle={subtitle} />

      <DataTable
        columns={[...allColumns, returnColumn, downloadColumn("pdf", pdfId), downloadColumn("png", pngId)]}
        rows={shown}
        idKey="id"
        onRowClick={(row) => void openEdit(String(row.id))}
        onRowIntent={(row) => void warm(String(row.id))}
        pendingIds={pending}
        selected={selected}
        onSelectedChange={setSelected}
        // One invoice at a time: a sale is a document with its own lines and
        // settlement, so "edit these six together" isn't a thing that exists
        // here. Ctrl+Enter opens the first of the ticked rows.
        onBatchEdit={() => selected[0] && void openEdit(selected[0])}
        emptyMessage={filtered ? "No invoices match these filters." : "No invoices yet — raise one from Sales."}
        searchPlaceholder="Search invoices…"
        storageKey="sales-invoices"
      />

      {loadingId && <p className="shrink-0 text-sm text-steel">Opening…</p>}

      {imaging && <InvoiceImageRenderer invoice={imaging} onReady={(node) => void captureImage(node)} />}

      {returning && (
        <Dialog title={`Sales Return · ${returning.number}`} onClose={() => !returnBusy && setReturning(null)} size="wide">
          <form onSubmit={(event) => void saveReturn(event)} className="flex flex-col gap-4">
            <input type="hidden" name="sourceDocumentId" value={returning.id} />
            <label className="w-fit text-sm text-ink">Return date
              <input name="documentDate" type="date" required defaultValue={todayISO()} className="mt-1 block rounded border border-sand bg-white px-3 py-2" />
            </label>
            <p className="text-sm text-steel">Returned quantities restore stock at the recorded sale cost and create a customer credit. A refund can then be recorded as a normal payment out.</p>
            <div className="overflow-x-auto rounded border border-sand">
              <table className="w-full text-sm"><thead className="bg-ivory text-left text-steel"><tr><th className="p-2">Item</th><th className="p-2 text-right">Sold</th><th className="p-2 text-right">Already returned</th><th className="p-2 text-right">Return now</th></tr></thead>
                <tbody>{returning.lines.map((line) => <tr key={line.sourceLineId} className="border-t border-sand"><td className="p-2 text-ink">{line.itemName ?? "Uncatalogued line"}{line.unitSymbol ? ` · ${line.unitSymbol}` : ""}</td><td className="p-2 text-right tabular-nums">{line.quantity}</td><td className="p-2 text-right tabular-nums">{line.returnedQuantity}</td><td className="p-2 text-right"><input type="number" min="0" max={line.availableQuantity} step="0.001" value={returnQuantities[line.sourceLineId] ?? ""} onChange={(event) => setReturnQuantities((current) => ({ ...current, [line.sourceLineId]: event.target.value }))} className="w-24 rounded border border-sand px-2 py-1 text-right" aria-label={`Return quantity for ${line.itemName ?? "line"}`} /></td></tr>)}</tbody>
              </table>
            </div>
            {returning.returns.length > 0 && <div className="rounded border border-sand p-3 text-sm"><p className="font-medium text-navy-800">Return history</p><ul className="mt-2 divide-y divide-sand">{returning.returns.map((entry) => <li key={entry.id} className="flex items-center justify-between gap-3 py-2"><span>{entry.number} · {entry.documentDate} · {money(entry.grandTotal)} · {entry.status}</span>{entry.status === "posted" && <button type="button" disabled={returnBusy} onClick={() => void cancelReturn(entry.id)} className="rounded border border-sand px-2 py-1 text-xs hover:bg-ivory">Cancel return</button>}</li>)}</ul></div>}
            {returnError && <p className="rounded border border-error/30 bg-error-tint p-3 text-sm text-error">{returnError}</p>}
            <div className="flex justify-end gap-2"><button type="button" onClick={() => setReturning(null)} disabled={returnBusy} className="rounded border border-sand px-4 py-2 text-sm">Cancel</button><button type="submit" disabled={returnBusy} className="rounded bg-navy-800 px-4 py-2 text-sm font-medium text-white disabled:opacity-60">{returnBusy ? "Saving…" : "Create return"}</button></div>
          </form>
        </Dialog>
      )}

      {editing && (
        // Hidden rather than closed while this sale's write is in the air. The
        // server may still have something to say — a stock shortfall, a question
        // about receipts to release — and a hidden popup keeps every typed line
        // and the question itself standing; a closed one would have thrown both
        // away. `pending` empties when the action settles, so a refusal brings the
        // popup straight back, and a success closes it for real from onDone.
        <Dialog title="Edit Sale" onClose={close} size="xwide" hidden={pending.includes(editing.id)}>
          <div className="flex flex-col gap-3">
            {/* The printable copy still exists, one click away — it just isn't
                what a row opens any more. */}
            <Link href={`/sales/invoices/${editing.id}`} className="w-fit text-sm font-medium text-navy-800 hover:underline">
              Printable invoice ↗
            </Link>
            <SaleFormPage
              saleId={editing.id}
              defaults={editing}
              {...formOptions}
              chequeOptions={chequeOptions}
              onDone={close}
              onSaving={() => {
                forgetWarm(editing.id);
                patch(editing.id);
              }}
              onDeleting={() => {
                forgetWarm(editing.id);
                remove(editing.id);
              }}
            />
          </div>
        </Dialog>
      )}
    </div>
  );
}
