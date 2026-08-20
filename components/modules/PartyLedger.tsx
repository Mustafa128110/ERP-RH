"use client";

import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { formatDate, money } from "@/lib/format";
import { getPartyLedger, type PartyLedgerEntry, type PartyLedgerResult } from "@/lib/actions/ledger";
import { PageHeader } from "@/components/ui/PageHeader";
import { INVOICE_COMPANY_NAME } from "@/lib/invoice-pdf";

type ContactOption = { id: string; name: string; companyId: string };

const TYPE_LABELS: Record<PartyLedgerEntry["type"], string> = {
  item_sold: "Item Sold",
  item_bought: "Item Bought",
  payment_received: "Payment Received",
  payment_made: "Payment Made",
  journal_entry: "Journal Entry",
};

const TYPE_OPTIONS: { value: PartyLedgerEntry["type"]; label: string }[] = [
  { value: "item_sold", label: "Item Sold" },
  { value: "item_bought", label: "Item Bought" },
  { value: "payment_received", label: "Payment Received" },
  { value: "payment_made", label: "Payment Made" },
  { value: "journal_entry", label: "Journal Entry" },
];

export function PartyLedgerPage({
  contactId: initialContactId,
  contactOptions,
}: {
  contactId: string | null;
  contactOptions: ContactOption[];
}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [data, setData] = useState<PartyLedgerResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [typeFilter, setTypeFilter] = useState<Set<PartyLedgerEntry["type"]>>(new Set());
  const [search, setSearch] = useState("");
  const [desc, setDesc] = useState(false);

  // Fetch data when a contact is selected
  async function loadLedger(cid: string) {
    setLoading(true);
    setError(null);
    try {
      const result = await getPartyLedger(cid);
      if (!result) {
        setError("Contact not found.");
        setData(null);
      } else {
        setData(result);
      }
    } catch {
      setError("Failed to load ledger.");
      setData(null);
    } finally {
      setLoading(false);
    }
  }

  // Load when contact changes via URL
  const currentContactId = searchParams.get("contact") ?? initialContactId;

  // Auto-load when contact changes
  const [lastLoaded, setLastLoaded] = useState<string | null>(initialContactId);
  if (currentContactId && currentContactId !== lastLoaded && !loading) {
    setLastLoaded(currentContactId);
    void loadLedger(currentContactId);
  }

  function selectContact(id: string) {
    setData(null);
    setLastLoaded(null);
    router.push(id ? `/finance/party-ledger?contact=${id}` : "/finance/party-ledger");
  }

  // Filter and sort entries
  const processedEntries = useMemo(() => {
    if (!data) return [];

    let filtered = [...data.entries];

    // Date range filter
    if (fromDate) filtered = filtered.filter((e) => e.date >= fromDate);
    if (toDate) filtered = filtered.filter((e) => e.date <= toDate);

    // Type filter
    if (typeFilter.size > 0) {
      filtered = filtered.filter((e) => typeFilter.has(e.type));
    }

    // Search filter
    if (search.trim()) {
      const q = search.toLowerCase();
      filtered = filtered.filter(
        (e) =>
          e.description.toLowerCase().includes(q) ||
          (e.reference && e.reference.toLowerCase().includes(q)),
      );
    }

    // Sort by date
    filtered.sort((a, b) => (desc ? b.date.localeCompare(a.date) || b.id.localeCompare(a.id) : a.date.localeCompare(b.date) || a.id.localeCompare(b.id)));

    return filtered;
  }, [data, fromDate, toDate, typeFilter, search, desc]);

  // Running balance: start from 0 (all entries are the full history for the contact)
  const entriesWithBalance = useMemo(() => {
    let running = 0;
    return processedEntries.map((e) => {
      running += e.debit - e.credit;
      return { ...e, balance: running };
    });
  }, [processedEntries]);

  // Summary stats
  const summary = useMemo(() => {
    if (!data) return { opening: 0, totalDebit: 0, totalCredit: 0, closing: 0 };
    // Opening balance = sum of all entries not in the filtered set
    const allDebit = data.entries.reduce((s, e) => s + e.debit, 0);
    const allCredit = data.entries.reduce((s, e) => s + e.credit, 0);
    const filteredDebit = processedEntries.reduce((s, e) => s + e.debit, 0);
    const filteredCredit = processedEntries.reduce((s, e) => s + e.credit, 0);
    const opening = (allDebit - allCredit) - (filteredDebit - filteredCredit);
    return {
      opening,
      totalDebit: filteredDebit,
      totalCredit: filteredCredit,
      closing: opening + filteredDebit - filteredCredit,
    };
  }, [data, processedEntries]);

  function toggleType(t: PartyLedgerEntry["type"]) {
    setTypeFilter((prev) => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t);
      else next.add(t);
      return next;
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Party Ledger"
        subtitle={data ? `Statement of Account — ${data.displayName}` : "Select a party to view their statement"}
      />

      {/* Contact selector */}
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-semibold uppercase tracking-wide text-steel">Party</span>
          <select
            value={currentContactId ?? ""}
            onChange={(e) => selectContact(e.target.value)}
            className="h-10 w-72 rounded border border-sand bg-white px-3 text-sm text-ink"
          >
            <option value="">Select a party…</option>
            {contactOptions.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={() => currentContactId && void loadLedger(currentContactId)}
          disabled={!currentContactId || loading}
          className="h-10 rounded border border-sand px-4 text-sm font-medium text-steel hover:bg-ivory disabled:opacity-40"
        >
          {loading ? "Loading…" : "Refresh"}
        </button>
      </div>

      {error && <p className="text-sm text-error">{error}</p>}

      {data && (
        <>
          {/* Header — business info, party info, date range */}
          <div className="flex flex-wrap items-start justify-between gap-6 rounded-lg border border-sand bg-white p-6 print:border-0 print:p-0">
            <div>
              <h2 className="text-lg font-semibold text-navy-800">{INVOICE_COMPANY_NAME}</h2>
              <h3 className="mt-2 text-base font-medium text-ink">Statement of Account</h3>
              <p className="mt-1 text-sm text-steel">
                {data.displayName}
                {data.companyName ? ` (${data.companyName})` : ""}
              </p>
              {data.address && <p className="whitespace-pre-line text-sm text-steel">{data.address}</p>}
              <p className="text-sm text-steel">
                {[data.city, data.phone, data.email].filter(Boolean).join(" · ")}
              </p>
            </div>
            <div className="text-right text-sm text-steel">
              {fromDate && <p>From: {formatDate(fromDate)}</p>}
              {toDate && <p>To: {formatDate(toDate)}</p>}
              {!fromDate && !toDate && <p>All dates</p>}
            </div>
          </div>

          {/* Summary cards */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded border border-sand bg-white p-4 text-center">
              <p className="text-xs font-semibold uppercase tracking-wide text-steel">Opening Balance</p>
              <p className="mt-1 text-lg font-semibold tabular-nums text-ink">{money(summary.opening)}</p>
            </div>
            <div className="rounded border border-sand bg-white p-4 text-center">
              <p className="text-xs font-semibold uppercase tracking-wide text-steel">Total Debit</p>
              <p className="mt-1 text-lg font-semibold tabular-nums text-ink">{money(summary.totalDebit)}</p>
            </div>
            <div className="rounded border border-sand bg-white p-4 text-center">
              <p className="text-xs font-semibold uppercase tracking-wide text-steel">Total Credit</p>
              <p className="mt-1 text-lg font-semibold tabular-nums text-success">{money(summary.totalCredit)}</p>
            </div>
            <div className="rounded border border-sand bg-white p-4 text-center">
              <p className="text-xs font-semibold uppercase tracking-wide text-steel">Closing Balance</p>
              <p className={`mt-1 text-lg font-semibold tabular-nums ${summary.closing > 0 ? "text-error" : summary.closing < 0 ? "text-success" : "text-ink"}`}>
                {money(summary.closing)}
              </p>
            </div>
          </div>

          {/* Filters */}
          <div className="flex flex-wrap items-end gap-3 rounded border border-sand bg-white p-3">
            <label className="flex flex-col gap-1">
              <span className="text-xs font-semibold uppercase tracking-wide text-steel">From</span>
              <input
                type="date"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
                className="h-9 w-36 rounded border border-sand px-2 text-sm text-ink"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-semibold uppercase tracking-wide text-steel">To</span>
              <input
                type="date"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
                className="h-9 w-36 rounded border border-sand px-2 text-sm text-ink"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-semibold uppercase tracking-wide text-steel">Search</span>
              <input
                type="text"
                placeholder="Description or reference…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-9 w-48 rounded border border-sand px-2 text-sm text-ink"
              />
            </label>
            <div className="flex flex-col gap-1">
              <span className="text-xs font-semibold uppercase tracking-wide text-steel">Type</span>
              <div className="flex flex-wrap gap-1">
                {TYPE_OPTIONS.map((t) => (
                  <button
                    key={t.value}
                    type="button"
                    onClick={() => toggleType(t.value)}
                    className={`rounded border px-2 py-1 text-xs font-medium transition-colors ${
                      typeFilter.has(t.value)
                        ? "border-navy-800 bg-navy-800 text-white"
                        : "border-sand text-steel hover:bg-ivory"
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setDesc((d) => !d)}
              className="h-9 rounded border border-sand px-3 text-xs font-medium text-steel hover:bg-ivory"
              title="Toggle sort order"
            >
              {desc ? "↓ Newest first" : "↑ Oldest first"}
            </button>
            <div className="ml-auto flex gap-2">
              <button
                type="button"
                disabled
                className="h-9 rounded border border-sand px-3 text-xs font-medium text-steel opacity-40"
                title="Coming soon"
              >
                Export PNG
              </button>
              <button
                type="button"
                disabled
                className="h-9 rounded border border-sand px-3 text-xs font-medium text-steel opacity-40"
                title="Coming soon"
              >
                Export PDF
              </button>
            </div>
          </div>

          {/* Ledger table — desktop */}
          {entriesWithBalance.length === 0 ? (
            <div className="rounded border border-sand bg-white p-12 text-center">
              <p className="text-sm text-steel">No transactions in this period.</p>
              <p className="mt-1 text-sm text-steel">
                Opening balance: <span className="tabular-nums font-semibold text-ink">{money(summary.opening)}</span>
              </p>
            </div>
          ) : (
            <>
              {/* Desktop table */}
              <div className="scroll-thin overflow-x-auto rounded-lg border border-sand bg-white print:overflow-visible print:border-0">
                <table className="w-full min-w-[48rem] border-collapse text-sm print:min-w-0">
                  <thead>
                    <tr className="border-b border-sand bg-ivory/50 print:bg-white">
                      <th className="w-24 py-2.5 pl-4 text-left text-xs font-semibold uppercase tracking-wide text-steel">Date</th>
                      <th className="py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-steel">Description</th>
                      <th className="w-28 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-steel">Ref/Invoice</th>
                      <th className="w-28 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-steel pr-2">Debit</th>
                      <th className="w-28 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-steel pr-2">Credit</th>
                      <th className="w-32 py-2.5 pr-4 text-right text-xs font-semibold uppercase tracking-wide text-steel">Balance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {entriesWithBalance.map((e, i) => (
                      <tr key={`${e.id}-${i}`} className={`border-b border-sand/50 ${i % 2 === 1 ? "bg-ivory/30 print:bg-gray-50" : ""} hover:bg-ivory/50`}>
                        <td className="py-2 pl-4 tabular-nums text-steel">{formatDate(e.date)}</td>
                        <td className="py-2">
                          <span>{e.description}</span>
                          <span className="ml-2 rounded bg-sand/50 px-1.5 py-0.5 text-[10px] font-medium text-steel">{TYPE_LABELS[e.type]}</span>
                        </td>
                        <td className="py-2 text-xs tabular-nums text-steel">{e.reference ?? "—"}</td>
                        <td className="py-2 pr-2 text-right tabular-nums text-ink">{e.debit > 0 ? money(e.debit) : ""}</td>
                        <td className="py-2 pr-2 text-right tabular-nums text-success">{e.credit > 0 ? money(e.credit) : ""}</td>
                        <td className={`py-2 pr-4 text-right font-medium tabular-nums ${e.balance > 0 ? "text-error" : e.balance < 0 ? "text-success" : "text-ink"}`}>
                          {money(e.balance)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-sand bg-ivory/50 font-semibold print:bg-white">
                      <td colSpan={3} className="py-2.5 pl-4 text-xs uppercase tracking-wide text-steel">Totals</td>
                      <td className="py-2.5 pr-2 text-right tabular-nums text-ink">{money(summary.totalDebit)}</td>
                      <td className="py-2.5 pr-2 text-right tabular-nums text-success">{money(summary.totalCredit)}</td>
                      <td className={`py-2.5 pr-4 text-right tabular-nums ${summary.closing > 0 ? "text-error" : summary.closing < 0 ? "text-success" : "text-ink"}`}>
                        {money(summary.closing)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>

              {/* Mobile card layout */}
              <div className="flex flex-col gap-2 sm:hidden">
                {entriesWithBalance.map((e, i) => (
                  <div key={`${e.id}-${i}`} className={`rounded border border-sand p-3 ${i % 2 === 1 ? "bg-ivory/30" : "bg-white"}`}>
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="text-sm font-medium text-ink">{e.description}</p>
                        <p className="text-xs text-steel">
                          {formatDate(e.date)}
                          {e.reference ? ` · ${e.reference}` : ""}
                        </p>
                      </div>
                      <span className="rounded bg-sand/50 px-1.5 py-0.5 text-[10px] font-medium text-steel">{TYPE_LABELS[e.type]}</span>
                    </div>
                    <div className="mt-2 flex items-center justify-between text-sm">
                      <div className="flex gap-4">
                        {e.debit > 0 && (
                          <span className="tabular-nums text-ink">Dr {money(e.debit)}</span>
                        )}
                        {e.credit > 0 && (
                          <span className="tabular-nums text-success">Cr {money(e.credit)}</span>
                        )}
                      </div>
                      <span className={`font-medium tabular-nums ${e.balance > 0 ? "text-error" : e.balance < 0 ? "text-success" : "text-ink"}`}>
                        Bal: {money(e.balance)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      )}

      {/* Empty state when no contact selected */}
      {!currentContactId && !loading && (
        <div className="rounded border border-sand bg-white p-12 text-center">
          <p className="text-sm text-steel">Select a party from the dropdown above to view their statement of account.</p>
        </div>
      )}

      {/* Print styles */}
      <style>{`
        @media print {
          .force-light * { color: inherit !important; }
          table { page-break-inside: auto; }
          tr { page-break-inside: avoid; }
          thead { display: table-header-group; }
        }
      `}</style>
    </div>
  );
}
