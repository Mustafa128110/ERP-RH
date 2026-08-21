"use client";

import { useEffect, useMemo, useState } from "react";
import { formatDate, money, todayISO } from "@/lib/format";
import { getPartyLedger, deleteLedgerRow, type PartyLedgerEntry, type PartyLedgerResult } from "@/lib/actions/ledger";
import { Dialog } from "@/components/ui/Dialog";
import { DetailHover } from "@/components/ui/DetailHover";
import { INVOICE_COMPANY_NAME } from "@/lib/invoice-pdf";

const TYPE_LABELS: Record<PartyLedgerEntry["type"], string> = {
  item_sold: "Item Sold",
  item_bought: "Item Bought",
  payment_received: "Payment Received",
  payment_made: "Payment Made",
  journal_entry: "Journal Entry",
};

/** Plain text description with dotted underline. Hover shows detail. */
function DescriptionCell({ entry }: { entry: PartyLedgerEntry }) {
  const label = TYPE_LABELS[entry.type];

  // Items: hover shows line items table
  if (entry.lineItems && entry.lineItems.length > 0) {
    return (
      <DetailHover
        trigger={<span className="cursor-help border-b border-dotted border-steel">{label}</span>}
        width={480}
      >
        <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-steel">Line Items</p>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b-2 border-sand">
              <th className="py-1.5 pr-6 text-left text-xs font-semibold text-steel">Item</th>
              <th className="py-1.5 w-28 text-right text-xs font-semibold text-steel">Qty</th>
              <th className="py-1.5 w-24 text-right text-xs font-semibold text-steel">Rate</th>
              <th className="py-1.5 w-28 text-right text-xs font-semibold text-steel">Amount</th>
            </tr>
          </thead>
          <tbody>
            {entry.lineItems.map((l, i) => (
              <tr key={i} className="border-b border-sand/50 last:border-0">
                <td className="py-2 pr-6 text-ink">{l.itemName}</td>
                <td className="py-2 text-right tabular-nums text-ink">{l.quantity}{l.unitSymbol ? ` ${l.unitSymbol}` : ""}</td>
                <td className="py-2 text-right tabular-nums text-steel">{money(l.rate)}</td>
                <td className="py-2 text-right tabular-nums font-medium text-ink">{money(l.lineTotal)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </DetailHover>
    );
  }

  // Payments: hover shows payment method
  if (entry.paymentMethod) {
    return (
      <DetailHover
        trigger={<span className="cursor-help border-b border-dotted border-steel">{label}</span>}
        width={260}
      >
        <div className="flex flex-col gap-2">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-steel">Payment Method</p>
          <p className="text-sm font-medium text-ink">{entry.paymentMethod}</p>
        </div>
      </DetailHover>
    );
  }

  // Journal entries: no hover, just plain text
  return <span>{label}</span>;
}

export function PartyLedgerDialog({ contactId, companyId, contactName, onClose, onExport }: { contactId: string; companyId: string; contactName: string; onClose: () => void; onExport: (fmt: "pdf" | "png", data: PartyLedgerResult, entries: (PartyLedgerEntry & { balance: number })[], summary: { opening: number; totalDebit: number; totalCredit: number; closing: number }) => void }) {
  const [data, setData] = useState<PartyLedgerResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Filters
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [search, setSearch] = useState("");
  const [desc, setDesc] = useState<boolean>(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("party-ledger-sort-desc");
      if (saved !== null) return saved === "true";
    }
    return true;
  });
  const [openingOverride, setOpeningOverride] = useState<string | null>(null);

  // Persist sort direction
  useEffect(() => {
    if (typeof window !== "undefined") {
      localStorage.setItem("party-ledger-sort-desc", String(desc));
    }
  }, [desc]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const result = await getPartyLedger(contactId, companyId);
        if (!cancelled) {
          if (!result) setError("Contact not found.");
          else setData(result);
        }
      } catch {
        if (!cancelled) setError("Failed to load ledger.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [contactId, companyId]);

  const processedEntries = useMemo(() => {
    if (!data) return [];
    let filtered = [...data.entries];
    if (fromDate) filtered = filtered.filter((e) => e.date >= fromDate);
    if (toDate) filtered = filtered.filter((e) => e.date <= toDate);
    if (search.trim()) {
      const q = search.toLowerCase();
      filtered = filtered.filter((e) => {
        const refMatch = e.reference && e.reference.toLowerCase().includes(q);
        const lineMatch = e.lineItems?.some((l) => l.itemName.toLowerCase().includes(q));
        return refMatch || lineMatch;
      });
    }
    filtered.sort((a, b) =>
      desc
        ? b.date.localeCompare(a.date) || b.id.localeCompare(a.id)
        : a.date.localeCompare(b.date) || a.id.localeCompare(b.id),
    );
    return filtered;
  }, [data, fromDate, toDate, search, desc]);

  const computedOpening = useMemo(() => {
    if (!data) return 0;
    const allDebit = data.entries.reduce((s, e) => s + e.debit, 0);
    const allCredit = data.entries.reduce((s, e) => s + e.credit, 0);
    const filteredDebit = processedEntries.reduce((s, e) => s + e.debit, 0);
    const filteredCredit = processedEntries.reduce((s, e) => s + e.credit, 0);
    return allDebit - allCredit - (filteredDebit - filteredCredit);
  }, [data, processedEntries]);

  const effectiveOpening = openingOverride !== null ? Number(openingOverride) || 0 : computedOpening;

  const entriesWithBalance = useMemo(() => {
    let running = effectiveOpening;
    return processedEntries.map((e) => {
      running += e.debit - e.credit;
      return { ...e, balance: running };
    });
  }, [processedEntries, effectiveOpening]);

  const summary = useMemo(() => {
    const filteredDebit = processedEntries.reduce((s, e) => s + e.debit, 0);
    const filteredCredit = processedEntries.reduce((s, e) => s + e.credit, 0);
    return {
      opening: effectiveOpening,
      totalDebit: filteredDebit,
      totalCredit: filteredCredit,
      closing: effectiveOpening + filteredDebit - filteredCredit,
    };
  }, [processedEntries, effectiveOpening]);

  // Delete with double confirmation
  const [confirmDelete, setConfirmDelete] = useState<{ entry: PartyLedgerEntry & { balance: number } } | null>(null);
  const [confirmDelete2, setConfirmDelete2] = useState<{ entry: PartyLedgerEntry & { balance: number } } | null>(null);

  async function handleDelete(docId: string) {
    setConfirmDelete(null);
    setConfirmDelete2(null);
    setDeletingId(docId);
    try {
      const result = await deleteLedgerRow(docId);
      if (result?.error) {
        setError(result.error);
      } else {
        const fresh = await getPartyLedger(contactId, companyId);
        if (fresh) setData(fresh);
      }
    } catch {
      setError("Failed to delete entry.");
    } finally {
      setDeletingId(null);
    }
  }

  function handleExport(fmt: "pdf" | "png") {
    if (!data || entriesWithBalance.length === 0) return;
    onExport(fmt, data, entriesWithBalance, summary);
  }

  return (
    <>
    <Dialog title={`Statement of Account — ${contactName}`} onClose={onClose} size="xwide">
      {loading && <p className="py-8 text-center text-sm text-steel">Loading…</p>}
      {error && <p className="py-8 text-center text-sm text-error">{error}</p>}

      {data && (
        <div className="flex flex-col gap-3">
          {/* Header */}
          <div className="flex flex-wrap items-start justify-between gap-4 rounded border border-sand bg-ivory/50 p-4">
            <div>
              <p className="text-sm font-semibold text-navy-800">{INVOICE_COMPANY_NAME}</p>
              <p className="text-sm text-steel">
                {data.displayName}
                {data.companyName ? ` (${data.companyName})` : ""}
              </p>
              <p className="text-xs text-steel">
                {[data.city, data.phone, data.email].filter(Boolean).join(" · ")}
              </p>
            </div>
            <div className="text-right text-xs text-steel">
              {fromDate && <p>From: {formatDate(fromDate)}</p>}
              {toDate && <p>To: {formatDate(toDate)}</p>}
              {!fromDate && !toDate && <p>All dates</p>}
            </div>
          </div>

          {/* Summary cards */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <div className="rounded border border-sand bg-white p-3 text-center">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-steel">Opening Balance</p>
              <div className="mt-1 flex items-center justify-center gap-1">
                <input
                  type="number"
                  step="0.01"
                  value={openingOverride ?? computedOpening}
                  onChange={(e) => setOpeningOverride(e.target.value)}
                  className="w-28 rounded border border-sand bg-ivory px-1.5 py-0.5 text-center text-sm font-semibold tabular-nums text-ink focus:border-navy-800 focus:outline-none"
                />
                {openingOverride !== null && (
                  <button type="button" onClick={() => setOpeningOverride(null)} className="rounded border border-sand px-1 py-0.5 text-[9px] font-medium text-steel hover:bg-ivory" title="Reset">Reset</button>
                )}
              </div>
            </div>
            <div className="rounded border border-sand bg-white p-3 text-center">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-steel">Total Debit</p>
              <p className="mt-1 text-sm font-semibold tabular-nums text-ink">{money(summary.totalDebit)}</p>
            </div>
            <div className="rounded border border-sand bg-white p-3 text-center">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-steel">Total Credit</p>
              <p className="mt-1 text-sm font-semibold tabular-nums text-success">{money(summary.totalCredit)}</p>
            </div>
            <div className="rounded border border-sand bg-white p-3 text-center">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-steel">Closing Balance</p>
              <p className={`mt-1 text-sm font-semibold tabular-nums ${summary.closing > 0 ? "text-error" : summary.closing < 0 ? "text-success" : "text-ink"}`}>
                {money(summary.closing)}
              </p>
            </div>
          </div>

          {/* Filters */}
          <div className="flex flex-wrap items-end gap-2 rounded border border-sand bg-white p-2">
            <label className="flex flex-col gap-0.5">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-steel">From</span>
              <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="h-8 w-32 rounded border border-sand px-1.5 text-xs text-ink" />
            </label>
            <label className="flex flex-col gap-0.5">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-steel">To</span>
              <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="h-8 w-32 rounded border border-sand px-1.5 text-xs text-ink" />
            </label>
            <label className="flex flex-col gap-0.5">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-steel">Search</span>
              <input type="text" placeholder="Item or ref…" value={search} onChange={(e) => setSearch(e.target.value)} className="h-8 w-36 rounded border border-sand px-1.5 text-xs text-ink" />
            </label>
            <div className="ml-auto flex gap-1.5">
              <button type="button" onClick={() => handleExport("png")} className="h-8 rounded border border-sand px-2 text-[10px] font-medium text-steel hover:bg-ivory">
                PNG
              </button>
              <button type="button" onClick={() => handleExport("pdf")} className="h-8 rounded border border-sand px-2 text-[10px] font-medium text-steel hover:bg-ivory">
                PDF
              </button>
            </div>
          </div>

          {/* Ledger table */}
          {entriesWithBalance.length === 0 ? (
            <div className="rounded border border-sand bg-white p-8 text-center">
              <p className="text-sm text-steel">No transactions in this period.</p>
              <p className="mt-1 text-sm text-steel">
                Opening balance: <span className="tabular-nums font-semibold text-ink">{money(summary.opening)}</span>
              </p>
            </div>
          ) : (
            <div className="scroll-thin max-h-[55vh] overflow-auto rounded-lg border border-sand bg-white">
              <table className="w-full min-w-[66rem] border-collapse text-sm">
                <thead className="sticky top-0 z-10 bg-ivory/90 backdrop-blur">
                  <tr className="border-b border-sand">
                    <th className="w-40 cursor-pointer select-none py-2.5 pl-8 pr-8 text-center text-xs font-semibold uppercase tracking-wide text-steel hover:text-navy-800" onClick={() => setDesc((d) => !d)}>
                      Date {desc ? "↓" : "↑"}
                    </th>
                    <th className="w-64 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-steel">Description</th>
                    <th className="w-36 py-2.5 text-center text-xs font-semibold uppercase tracking-wide text-steel">Ref</th>
                    <th className="w-40 py-2.5 text-center text-xs font-semibold uppercase tracking-wide text-steel">Debit</th>
                    <th className="w-40 py-2.5 text-center text-xs font-semibold uppercase tracking-wide text-steel">Credit</th>
                    <th className="w-44 py-2.5 pr-6 text-center text-xs font-semibold uppercase tracking-wide text-steel">Balance</th>
                    <th className="w-12 py-2.5"></th>
                  </tr>
                </thead>
                <tbody>
                  {entriesWithBalance.map((e, i) => (
                    <tr key={`${e.id}-${i}`} className={`border-b border-sand/50 ${i % 2 === 1 ? "bg-ivory/30" : ""}`}>
                      <td className="whitespace-nowrap py-2.5 pl-8 pr-8 tabular-nums text-steel">{formatDate(e.date)}</td>
                      <td className="py-2"><DescriptionCell entry={e} /></td>
                      <td className="py-2 text-center text-xs tabular-nums text-steel">{e.reference ?? "—"}</td>
                      <td className="py-2.5 pr-4 text-right tabular-nums text-ink">{e.debit > 0 ? money(e.debit) : ""}</td>
                      <td className="py-2.5 pr-4 text-right tabular-nums text-success">{e.credit > 0 ? money(e.credit) : ""}</td>
                      <td className={`py-2.5 pr-6 text-right font-medium tabular-nums ${e.balance > 0 ? "text-error" : e.balance < 0 ? "text-success" : "text-ink"}`}>
                        {money(e.balance)}
                      </td>
                      <td className="py-2 pr-2 text-center">
                        <button
                          type="button"
                          title="Delete this entry"
                          disabled={deletingId === e.documentId}
                          onClick={() => setConfirmDelete({ entry: e })}
                          className="rounded px-1.5 py-0.5 text-xs text-steel hover:bg-error/10 hover:text-error disabled:opacity-40"
                        >
                          {deletingId === e.documentId ? "…" : "✕"}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-sand bg-ivory/50 font-semibold">
                    <td colSpan={3} className="py-2 pl-4 text-xs uppercase tracking-wide text-steel">Totals</td>
                    <td className="py-2 pr-4 text-right tabular-nums text-ink">{money(summary.totalDebit)}</td>
                    <td className="py-2 pr-4 text-right tabular-nums text-success">{money(summary.totalCredit)}</td>
                    <td className={`py-2 pr-4 text-right tabular-nums ${summary.closing > 0 ? "text-error" : summary.closing < 0 ? "text-success" : "text-ink"}`}>
                      {money(summary.closing)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>
      )}

    </Dialog>

      {/* Delete confirmation — first click */}
      {confirmDelete && !confirmDelete2 && (
        <Dialog title="Confirm Delete" onClose={() => setConfirmDelete(null)} size="form">
          <div className="flex flex-col gap-3">
            <p className="text-sm text-ink">
              Are you sure you want to delete this {TYPE_LABELS[confirmDelete.entry.type].toLowerCase()} entry?
            </p>
            <p className="text-xs text-steel">
              Reference: {confirmDelete.entry.reference ?? "—"} · {formatDate(confirmDelete.entry.date)}
            </p>
            {confirmDelete.entry.debit > 0 && <p className="text-xs text-steel">Debit: {money(confirmDelete.entry.debit)}</p>}
            {confirmDelete.entry.credit > 0 && <p className="text-xs text-steel">Credit: {money(confirmDelete.entry.credit)}</p>}
            <div className="flex gap-2">
              <button type="button" onClick={() => setConfirmDelete2(confirmDelete)} className="rounded bg-error px-4 py-2 text-sm font-semibold text-white hover:bg-error/80">
                Yes, delete it
              </button>
              <button type="button" onClick={() => setConfirmDelete(null)} className="rounded px-4 py-2 text-sm font-medium text-steel hover:bg-ivory">
                Cancel
              </button>
            </div>
          </div>
        </Dialog>
      )}

      {/* Delete confirmation — second click */}
      {confirmDelete2 && (
        <Dialog title="Final Confirmation" onClose={() => setConfirmDelete2(null)} size="form">
          <div className="flex flex-col gap-3">
            <p className="text-sm font-semibold text-error">
              This action cannot be undone.
            </p>
            <p className="text-sm text-ink">
              The {TYPE_LABELS[confirmDelete2.entry.type].toLowerCase()} entry ({confirmDelete2.entry.reference ?? "—"}) will be permanently removed from the ledger.
            </p>
            <div className="flex gap-2">
              <button type="button" onClick={() => void handleDelete(confirmDelete2.entry.documentId)} className="rounded bg-error px-4 py-2 text-sm font-semibold text-white hover:bg-error/80">
                Delete permanently
              </button>
              <button type="button" onClick={() => { setConfirmDelete(null); setConfirmDelete2(null); }} className="rounded px-4 py-2 text-sm font-medium text-steel hover:bg-ivory">
                Cancel
              </button>
            </div>
          </div>
        </Dialog>
      )}

      {/* Off-screen render for export — rendered outside Dialog to avoid overflow clipping */}
    </>
  );
}

// ---------------------------------------------------------------------------
// Print-ready document for PDF/PNG export
// ---------------------------------------------------------------------------

export function PartyLedgerPrintDocument({
  data,
  entries,
  summary,
}: {
  data: PartyLedgerResult;
  entries: (PartyLedgerEntry & { balance: number })[];
  summary: { opening: number; totalDebit: number; totalCredit: number; closing: number };
}) {
  return (
    <div className="force-light w-full bg-white p-10 text-ink">
      <div className="flex items-start justify-between gap-6 border-b-2 border-navy-800 pb-4">
        <div>
          <h1 className="text-2xl font-semibold text-navy-800">{INVOICE_COMPANY_NAME}</h1>
          <h2 className="mt-2 text-lg font-medium text-ink">Statement of Account</h2>
          <p className="mt-1 text-sm text-steel">
            {data.displayName}
            {data.companyName ? ` (${data.companyName})` : ""}
          </p>
          {data.address && <p className="whitespace-pre-line text-sm text-steel">{data.address}</p>}
          <p className="text-sm text-steel">
            {[data.city, data.phone, data.email].filter(Boolean).join(" · ")}
          </p>
        </div>
        <div className="text-right">
          <p className="text-xs font-semibold uppercase tracking-wide text-steel">As at</p>
          <p className="mt-1 text-sm text-ink">{formatDate(todayISO())}</p>
        </div>
      </div>

      <div className="mt-6 flex justify-end">
        <dl className="grid w-96 grid-cols-[1fr_auto] gap-y-1 border-t-2 border-navy-800 pt-2 text-sm">
          <dt className="text-steel">Opening Balance</dt>
          <dd className="text-right tabular-nums">{money(summary.opening)}</dd>
          <dt className="text-steel">Total Debit</dt>
          <dd className="text-right tabular-nums">{money(summary.totalDebit)}</dd>
          <dt className="text-steel">Total Credit</dt>
          <dd className="text-right tabular-nums text-success">{money(summary.totalCredit)}</dd>
          <dt className="mt-1 border-t border-sand pt-1 font-semibold">Closing Balance</dt>
          <dd className={`mt-1 border-t border-sand pt-1 text-right font-semibold tabular-nums ${summary.closing > 0 ? "text-error" : summary.closing < 0 ? "text-success" : "text-ink"}`}>{money(summary.closing)}</dd>
        </dl>
      </div>

      <table className="mt-6 w-full border-collapse text-sm">
        <thead>
          <tr className="border-y-2 border-navy-800">
            <th className="w-28 py-2 text-left text-xs font-semibold uppercase tracking-wide text-steel">Date</th>
            <th className="w-56 py-2 text-left text-xs font-semibold uppercase tracking-wide text-steel">Description</th>
            <th className="w-32 py-2 text-left text-xs font-semibold uppercase tracking-wide text-steel">Ref</th>
            <th className="w-36 py-2 text-right text-xs font-semibold uppercase tracking-wide text-steel">Debit</th>
            <th className="w-36 py-2 text-right text-xs font-semibold uppercase tracking-wide text-steel">Credit</th>
            <th className="w-40 py-2 text-right text-xs font-semibold uppercase tracking-wide text-steel">Balance</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((e, i) => (
            <tr key={`${e.id}-${i}`} className={`border-b border-sand ${i % 2 === 1 ? "bg-zinc-50" : ""}`}>
              <td className="py-1.5 tabular-nums text-steel whitespace-nowrap">{formatDate(e.date)}</td>
              <td className="py-1.5 pr-4">
                <span>{TYPE_LABELS[e.type]}</span>
                {e.lineItems && e.lineItems.length > 0 && (
                  <span className="ml-1 text-xs text-steel">({e.lineItems.map((l) => `${l.itemName} ${l.quantity}${l.unitSymbol ? ` ${l.unitSymbol}` : ""}`).join(", ")})</span>
                )}
                {e.paymentMethod && <span className="ml-1 text-xs text-steel">({e.paymentMethod})</span>}
              </td>
              <td className="py-1.5 text-xs tabular-nums text-steel">{e.reference ?? "—"}</td>
              <td className="py-1.5 text-right tabular-nums text-ink">{e.debit > 0 ? money(e.debit) : ""}</td>
              <td className="py-1.5 text-right tabular-nums text-success">{e.credit > 0 ? money(e.credit) : ""}</td>
              <td className={`py-1.5 text-right font-medium tabular-nums ${e.balance > 0 ? "text-error" : e.balance < 0 ? "text-success" : "text-ink"}`}>{money(e.balance)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-navy-800 font-semibold">
            <td colSpan={3} className="py-2 text-xs uppercase tracking-wide text-steel">Totals</td>
            <td className="py-2 text-right tabular-nums text-ink">{money(summary.totalDebit)}</td>
            <td className="py-2 text-right tabular-nums text-success">{money(summary.totalCredit)}</td>
            <td className={`py-2 text-right tabular-nums ${summary.closing > 0 ? "text-error" : summary.closing < 0 ? "text-success" : "text-ink"}`}>{money(summary.closing)}</td>
          </tr>
        </tfoot>
      </table>

      <p className="mt-8 border-t border-sand pt-3 text-xs text-steel">
        {INVOICE_COMPANY_NAME} · Statement of Account · {data.displayName} · Generated {formatDate(todayISO())}
      </p>
    </div>
  );
}
