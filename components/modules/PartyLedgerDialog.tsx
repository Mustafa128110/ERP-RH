"use client";

import Link from "next/link";
import { useActionState, useCallback, useEffect, useMemo, useRef, useState, type ClipboardEvent, type MouseEvent } from "react";
import { formatDate, formatTimestamp, money, todayISO } from "@/lib/format";
import {
  getPartyLedger,
  deleteLedgerRow,
  getPartyOpeningBalance,
  setPartyOpeningBalance,
  previewLedgerRowDelete,
  previewPartyOpeningBalance,
  getPartyAuditTrail,
  getLedgerInlineOptions,
  type LedgerImpactPreview,
  type PartyLedgerEntry,
  type PartyLedgerResult,
} from "@/lib/actions/ledger";
import { getPayment } from "@/lib/actions/payments";
import { getStockPurchase, listChequesForPurchases } from "@/lib/actions/purchases";
import type { AuditRow } from "@/lib/actions/audit";
import type { PaymentDirection } from "@/lib/actions/payments";
import { LEDGER_TYPE_LABELS, type SettlementState } from "@/lib/ledger-constants";
import { openingStatementAmount } from "@/lib/ledger-opening-constants";
import { Dialog } from "@/components/ui/Dialog";
import { DetailHover } from "@/components/ui/DetailHover";
import { DateField } from "@/components/ui/DateField";
import { PaymentEditForm } from "@/components/modules/PaymentForm";
import { StockPurchaseCreateForm } from "@/components/modules/StockPurchaseForm";
import { fieldClass, labelClass, labelTextClass, errorTextClass, confirmNoticeClass, primaryActionClass, TRANSPORT_ERROR_MESSAGE } from "@/components/ui/form-styles";
import { INVOICE_COMPANY_NAME } from "@/lib/invoice-pdf";
import { ledgerGridSelectionProps, computeCellStats, onSelectionChange } from "@/components/ui/ledger-grid";

// The statement's own labels come from the shared map — the same one the ledger
// list and the `?` sheet read, so a kind cannot be renamed in one place only.
const TYPE_LABELS = LEDGER_TYPE_LABELS;

const SETTLEMENT_LABELS: Record<SettlementState, string> = {
  outstanding: "Outstanding",
  partial: "Part paid",
  settled: "Settled",
};

const SETTLEMENT_CLASS: Record<SettlementState, string> = {
  outstanding: "border-sand bg-ivory text-steel",
  partial: "border-warning/40 bg-warning-tint text-warning",
  settled: "border-success/40 bg-success-tint text-success",
};

// The FIFO allocations an edit or a delete is about to move, named at both ends.
// Rendered wherever a confirmation has to say what else changes — which is the
// whole point of asking rather than refusing.
function ImpactList({ preview }: { preview: LedgerImpactPreview }) {
  if (preview.impacts.length === 0) {
    return <p className="text-xs text-steel">Nothing else on this account is settled against it — only the running balance moves.</p>;
  }
  return (
    <div className="flex flex-col gap-2">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-steel">
        {preview.impacts.length} settlement{preview.impacts.length === 1 ? "" : "s"} affected
      </p>
      <div className="scroll-thin max-h-48 overflow-auto rounded border border-sand">
        <table className="w-full text-xs">
          <tbody>
            {preview.impacts.map((impact, i) => (
              <tr key={i} className="border-b border-sand/50 last:border-0">
                <td className="px-2 py-1.5 text-steel">
                  {impact.payment ? `${TYPE_LABELS[impact.payment.type]} ${impact.payment.number}` : "Payment"}
                </td>
                <td className="px-2 py-1.5 text-ink">
                  {impact.item ? `${TYPE_LABELS[impact.item.type]} ${impact.item.number}` : "—"}
                </td>
                <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums text-steel">
                  {money(impact.before)} → <span className="font-medium text-ink">{money(impact.after)}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {preview.released > 0 && (
        <p className="text-xs text-steel">
          <span className="font-medium text-ink">{money(preview.released)}</span> stops being settled and is held on the party&apos;s account, to be
          absorbed by the next outstanding item in the same queue.
        </p>
      )}
    </div>
  );
}

// The context RefCell needs to open its inline edit popups: the option sets sit on
// the parent (fetched once, on demand) and the warm-fetch maps are owned there so
// a ref clicked twice in quick succession doesn't start the same fetch twice.
interface RefCellContext {
  onOpenPayment: (documentId: string) => void;
  onOpenPurchase: (documentId: string) => void;
  onOpenOpeningBalance: () => void;
}

/** Ref number cell: clicking opens the source document for editing. */
function RefCell({ entry, ctx }: { entry: PartyLedgerEntry & { balance: number }; ctx: RefCellContext }) {
  const label = entry.reference ?? "—";

  // Payments: open the payment edit form inline, same popup the payments page uses.
  if (entry.code === "PAYMENT_RECEIVED" || entry.code === "PAYMENT_MADE") {
    return (
      <button
        type="button"
        onClick={() => ctx.onOpenPayment(entry.documentId)}
        className="underline decoration-dotted decoration-zinc-400 underline-offset-4 hover:text-navy-800"
        onClickCapture={(e: MouseEvent) => e.stopPropagation()}
      >
        {label}
      </button>
    );
  }

  // Purchases/MARKET_PURCHASE: open the stock purchase edit form inline.
  if (entry.code === "PURCHASE_INVOICE" || entry.code === "MARKET_PURCHASE") {
    return (
      <button
        type="button"
        onClick={() => ctx.onOpenPurchase(entry.documentId)}
        className="underline decoration-dotted decoration-zinc-400 underline-offset-4 hover:text-navy-800"
        onClickCapture={(e: MouseEvent) => e.stopPropagation()}
      >
        {label}
      </button>
    );
  }

  // Sales invoices have an edit route at /sales/[id]
  if (entry.code === "SALES_INVOICE") {
    return (
      <Link
        href={`/sales/${entry.documentId}`}
        target="_blank"
        rel="noopener noreferrer"
        className="underline decoration-dotted decoration-zinc-400 underline-offset-4 hover:text-navy-800"
        onClick={(e: MouseEvent) => e.stopPropagation()}
      >
        {label}
      </Link>
    );
  }

  // Opening balance rows open the balance editor — same panel as the "Edit" button
  // on the opening-balance card, so the ref is editable the same way the button is.
  if (entry.isOpeningBalance) {
    return (
      <button
        type="button"
        onClick={() => ctx.onOpenOpeningBalance()}
        className="underline decoration-dotted decoration-zinc-400 underline-offset-4 hover:text-navy-800"
        onClickCapture={(e: MouseEvent) => e.stopPropagation()}
      >
        {label}
      </button>
    );
  }

  // Journal entries and anything else: read-only detail hover with the context.
  if (!entry.code || entry.code === "JOURNAL_ENTRY") {
    return <span className="text-steel">{label}</span>;
  }

  // No other code path is expected to reach here, but fall back to the detail
  // panel so a ref no one routed is still inspectable rather than inert.
  return (
    <DetailHover
      trigger={<span className="cursor-help underline decoration-dotted decoration-zinc-400 underline-offset-4">{label}</span>}
      width={320}
      placement="right"
      heading="Reference"
    >
      <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
        <span className="text-steel">Date</span>
        <span className="text-right tabular-nums text-ink">{formatDate(entry.date)}</span>
        <span className="text-steel">Type</span>
        <span className="text-right text-ink">{TYPE_LABELS[entry.type]}</span>
        {entry.debit > 0 && (
          <>
            <span className="text-steel">Debit</span>
            <span className="text-right tabular-nums text-ink">{money(entry.debit)}</span>
          </>
        )}
        {entry.credit > 0 && (
          <>
            <span className="text-steel">Credit</span>
            <span className="text-right tabular-nums text-success">{money(entry.credit)}</span>
          </>
        )}
        <span className="text-steel">Balance</span>
        <span className={`text-right font-medium tabular-nums ${entry.balance > 0 ? "text-error" : entry.balance < 0 ? "text-success" : "text-ink"}`}>
          {money(entry.balance)}
        </span>
      </div>
    </DetailHover>
  );
}

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

/** §2's second invariant, one row at a time: how much of this document FIFO has
 *  settled, and against what. A journal entry never settles anything, so it shows
 *  a dash rather than a misleading "Outstanding". */
function SettlementCell({ entry }: { entry: PartyLedgerEntry & { balance: number } }) {
  if (!entry.settlement) return <span className="text-xs text-steel">—</span>;

  const total = entry.debit > 0 ? entry.debit : entry.credit;
  const settled = entry.settledAmount ?? 0;
  const pill = (
    <span className={`inline-block cursor-help rounded-full border px-2 py-0.5 text-[10px] font-medium ${SETTLEMENT_CLASS[entry.settlement]}`}>
      {SETTLEMENT_LABELS[entry.settlement]}
    </span>
  );

  const links = entry.settledAgainst ?? [];
  if (links.length === 0) {
    // Nothing to list, so nothing to hover. An outstanding invoice is the common
    // case here and it has no story behind it yet.
    return (
      <span className={`inline-block rounded-full border px-2 py-0.5 text-[10px] font-medium ${SETTLEMENT_CLASS[entry.settlement]}`}>
        {SETTLEMENT_LABELS[entry.settlement]}
      </span>
    );
  }

  const isPayment = entry.type === "payment_received" || entry.type === "payment_made";
  return (
    <DetailHover trigger={pill} width={380}>
      <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-steel">
        {isPayment ? "Applied to" : "Settled by"}
      </p>
      <table className="w-full text-sm">
        <tbody>
          {links.map((link, i) => (
            <tr key={`${link.documentId}-${i}`} className="border-b border-sand/50 last:border-0">
              <td className="py-1.5 pr-4 whitespace-nowrap tabular-nums text-steel">{formatDate(link.date)}</td>
              <td className="py-1.5 pr-4 text-ink">
                {TYPE_LABELS[link.type]}
                {link.reference ? ` ${link.reference}` : ""}
              </td>
              <td className="py-1.5 text-right tabular-nums font-medium text-ink">{money(link.amount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 border-t border-sand pt-1.5 text-xs text-steel">
        {money(settled)} of {money(total)}
        {settled < total ? ` · ${money(total - settled)} still open` : ""}
      </p>
    </DetailHover>
  );
}

export function PartyLedgerDialog({ contactId, companyId, contactName, onClose, onExport }: { contactId: string; companyId: string; contactName: string; onClose: () => void; onExport: (fmt: "pdf" | "png", data: PartyLedgerResult, entries: (PartyLedgerEntry & { balance: number })[], summary: { opening: number; totalDebit: number; totalCredit: number; closing: number }) => void }) {
  const [data, setData] = useState<PartyLedgerResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Cell selection state for Excel-like copy/paste and the status bar
  const tbodyRef = useRef<HTMLTableSectionElement>(null);
  const [selectionStats, setSelectionStats] = useState<ReturnType<typeof computeCellStats> | null>(null);

  // Filters
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [search, setSearch] = useState("");
  const [showCancelled, setShowCancelled] = useState(false);
  const [desc, setDesc] = useState<boolean>(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("party-ledger-sort-desc");
      if (saved !== null) return saved === "true";
    }
    return true;
  });
  // The party's stored opening balance, and the panel that edits it. This is a
  // real document on the account — the oldest item in its FIFO queue — not a
  // number typed into the statement, so it arrives with the ledger and is saved
  // back through a server action.
  const [editOpening, setEditOpening] = useState(false);

  // §7: every edit and delete recorded against this party. Fetched on demand —
  // the panel is closed on open, and most readings of a statement never want it.
  const [history, setHistory] = useState<AuditRow[] | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);

  // Inline edit popups for payment refs and item-bought refs — the same forms the
  // Payments and Stock Purchase pages use, opened straight from the statement. The
  // option sets arrive once (lazily, on first open) and are reused; the warm maps
  // cache a document's detail so a ref clicked twice in quick succession doesn't
  // re-fetch. Mirrors PaymentManager/StockPurchaseManager.
  const [formOptions, setFormOptions] = useState<{
    payment: { companyOptions: { id: string; name: string }[]; contactOptions: { id: string; name: string; companyId: string }[]; bankAccountOptions: { id: string; name: string; companyId: string | null }[]; cashAccountOptions: { id: string; name: string; companyId: string | null; isDefault: boolean }[]; chequeOptions: { id: string; name: string; companyId: string | null }[] };
    purchase: Awaited<ReturnType<typeof getLedgerInlineOptions>>["purchaseOptions"];
  } | null>(null);
  const [editingPayment, setEditingPayment] = useState<{ id: string; detail: NonNullable<Awaited<ReturnType<typeof getPayment>>>; cheques: { id: string; name: string; companyId: string | null }[] } | null>(null);
  const [editingPurchase, setEditingPurchase] = useState<{ id: string; detail: NonNullable<Awaited<ReturnType<typeof getStockPurchase>>>; cheques: { id: string; name: string; companyId: string | null }[] } | null>(null);
  const warmPayment = useRef(new Map<string, NonNullable<Awaited<ReturnType<typeof getPayment>>>>());
  const warmPurchase = useRef(new Map<string, NonNullable<Awaited<ReturnType<typeof getStockPurchase>>>>());

  // Load the option sets once, on demand, and stash them so every open form
  // reuses them rather than each fetching its own copy.
  async function loadFormOptions() {
    if (formOptions) return;
    const bundle = await getLedgerInlineOptions();
    setFormOptions({ payment: bundle.paymentOptions, purchase: bundle.purchaseOptions });
  }

  async function openPaymentEdit(documentId: string) {
    if (!formOptions) await loadFormOptions();
    // The warm map is a ref, so it is fresh regardless of which render closure
    // produced it — a ref clicked twice in quick succession reuses the first fetch.
    const cached = warmPayment.current.get(documentId);
    if (cached) {
      setEditingPayment({ id: documentId, detail: cached, cheques: [] });
      return;
    }
    const [detail, cheques] = await Promise.all([getPayment(documentId), listChequesForPurchases(documentId)]);
    if (!detail) return;
    warmPayment.current.set(documentId, detail);
    setEditingPayment({ id: documentId, detail, cheques });
  }

  async function openPurchaseEdit(documentId: string) {
    if (!formOptions) await loadFormOptions();
    const cached = warmPurchase.current.get(documentId);
    if (cached) {
      setEditingPurchase({ id: documentId, detail: cached, cheques: [] });
      return;
    }
    const [detail, cheques] = await Promise.all([getStockPurchase(documentId), listChequesForPurchases(documentId)]);
    if (!detail) return;
    warmPurchase.current.set(documentId, detail);
    setEditingPurchase({ id: documentId, detail, cheques });
  }

  // Context for the Ref cells: they only need the openers, not the whole
  // component body. Rebuilt per render — the rows only ever read the current
  // set of callbacks, there's nothing to stabilize across renders.
  const refCellContext: RefCellContext = {
    onOpenPayment: openPaymentEdit,
    onOpenPurchase: openPurchaseEdit,
    onOpenOpeningBalance: () => setEditOpening(true),
  };

  function closePaymentEdit() {
    setEditingPayment(null);
  }
  function closePurchaseEdit() {
    setEditingPurchase(null);
  }

  // Persist sort direction
  useEffect(() => {
    if (typeof window !== "undefined") {
      localStorage.setItem("party-ledger-sort-desc", String(desc));
    }
  }, [desc]);

  // Subscribe to cell selection changes for the status bar
  useEffect(() => {
    return onSelectionChange((stats) => setSelectionStats(stats));
  }, []);

  // One way back to the server for everything on this screen. Both invariants are
  // derived and recomputed from scratch on any change, so after a write there is
  // no patching a row in place — the statement is re-read whole.
  const reload = useCallback(async () => {
    const fresh = await getPartyLedger(contactId, companyId);
    if (fresh) setData(fresh);
    return fresh;
  }, [contactId, companyId]);

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

  // Opened once, then kept. A trail is history: it doesn't change while the
  // statement is on screen except by an edit made here, which refetches it.
  useEffect(() => {
    if (!historyOpen || history !== null) return;
    let cancelled = false;
    (async () => {
      try {
        const rows = await getPartyAuditTrail(contactId, companyId);
        if (!cancelled) setHistory(rows);
      } catch {
        // A trail that won't load is not a reason to break the statement. The
        // panel says there is nothing rather than throwing an error at someone
        // who came here to read a balance.
        if (!cancelled) setHistory([]);
      }
    })();
    return () => { cancelled = true; };
  }, [historyOpen, history, contactId, companyId]);

  const activeEntries = useMemo(
    () => (data?.entries ?? []).filter((entry) => showCancelled || entry.documentStatus !== "cancelled"),
    [data, showCancelled],
  );

  const processedEntries = useMemo(() => {
    let filtered = [...activeEntries];
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
  }, [activeEntries, fromDate, toDate, search, desc]);

  // What the Balance column starts from. The opening-balance row is now rendered
  // as the first line of the statement (see lib/actions/ledger.ts), so it is part
  // of `entries` and walks the running balance forward itself — the seed is only
  // what happened *before* the rows on screen, dated strictly before the window.
  //
  // Date only — not "everything the filters hid". Narrowing to a date range is a
  // statement for that period and its opening figure has to carry the account
  // forward to it; typing in the search box is a way of finding a row, and it must
  // not move the balance the statement opens with.
  const effectiveOpening = useMemo(() => {
    if (!fromDate) return 0;
    const before = activeEntries.filter((e) => e.date < fromDate);
    return before.reduce((sum, e) => sum + e.debit - e.credit, 0);
  }, [activeEntries, fromDate]);

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

  // §6: what else on the account moves if this row goes. Tagged with the document
  // it answers for, so a preview that lands after the dialog moved to another row
  // is ignored rather than shown against the wrong document.
  const [impact, setImpact] = useState<{ documentId: string; preview: LedgerImpactPreview } | null>(null);
  const [impactError, setImpactError] = useState<string | null>(null);

  async function askDelete(entry: PartyLedgerEntry & { balance: number }) {
    setConfirmDelete({ entry });
    setImpact(null);
    setImpactError(null);
    try {
      const preview = await previewLedgerRowDelete(entry.documentId);
      if ("error" in preview) setImpactError(preview.error);
      else setImpact({ documentId: entry.documentId, preview });
    } catch {
      setImpactError(TRANSPORT_ERROR_MESSAGE);
    }
  }

  async function handleDelete(docId: string) {
    setConfirmDelete(null);
    setConfirmDelete2(null);
    setDeletingId(docId);
    try {
      // `true`: the impact list was on screen in the confirmation above, so the
      // settlement this releases has been shown to the person asking for it.
      const result = await deleteLedgerRow(docId, true);
      if (result?.error) {
        setError(result.error);
      } else {
        await reload();
        // The trail just gained a row. Dropping it makes the panel refetch the
        // next time it is opened rather than showing a history missing its
        // newest entry.
        setHistory(null);
      }
    } catch {
      setError("Failed to delete entry.");
    } finally {
      setDeletingId(null);
      setImpact(null);
      setImpactError(null);
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
              <p className={`mt-1 text-sm font-semibold tabular-nums ${(!fromDate ? data.openingBalance : effectiveOpening) > 0 ? "text-error" : (!fromDate ? data.openingBalance : effectiveOpening) < 0 ? "text-success" : "text-ink"}`}>
                {money(!fromDate ? data.openingBalance : effectiveOpening)}
              </p>
              <div className="mt-1 flex items-center justify-center gap-2">
                {fromDate && (
                  <span className="text-[9px] text-steel" title={`Stored opening ${money(data.openingBalance)} carried forward to ${formatDate(fromDate)}`}>
                    carried fwd
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => setEditOpening(true)}
                  className="rounded border border-sand px-1.5 py-0.5 text-[9px] font-medium text-steel hover:bg-ivory"
                  title="Set the party's opening balance"
                >
                  Edit
                </button>
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

          {/* §5 — money taken beyond what was outstanding. Not a correction to
              make and not an error: it sits on the account and the next invoice
              in the same queue absorbs it automatically. Shown only when there
              is some, so a normal account carries no extra furniture. */}
          {(data.advanceReceived > 0 || data.advancePaid > 0) && (
            <div className="flex flex-wrap items-center gap-x-6 gap-y-1 rounded border border-info/40 bg-info-tint px-3 py-2 text-xs">
              {data.advanceReceived > 0 && (
                <p className="text-ink">
                  Advance held from this party: <span className="font-semibold tabular-nums">{money(data.advanceReceived)}</span>
                </p>
              )}
              {data.advancePaid > 0 && (
                <p className="text-ink">
                  Advance paid to this party: <span className="font-semibold tabular-nums">{money(data.advancePaid)}</span>
                </p>
              )}
              <p className="text-steel">Applied to the next invoice on that side, without anyone linking it.</p>
            </div>
          )}

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
              <button
                type="button"
                onClick={() => setHistoryOpen((v) => !v)}
                className={`h-8 rounded border px-2 text-[10px] font-medium ${historyOpen ? "border-navy-800 bg-navy-800 text-white" : "border-sand text-steel hover:bg-ivory"}`}
              >
                History
              </button>
              <button
                type="button"
                onClick={() => setShowCancelled((v) => !v)}
                className={`h-8 rounded border px-2 text-[10px] font-medium ${showCancelled ? "border-navy-800 bg-navy-800 text-white" : "border-sand text-steel hover:bg-ivory"}`}
              >
                {showCancelled ? "Hide cancelled" : "Show cancelled"}
              </button>
              <button type="button" onClick={() => handleExport("png")} className="h-8 rounded border border-sand px-2 text-[10px] font-medium text-steel hover:bg-ivory">
                PNG
              </button>
              <button type="button" onClick={() => handleExport("pdf")} className="h-8 rounded border border-sand px-2 text-[10px] font-medium text-steel hover:bg-ivory">
                PDF
              </button>
            </div>
          </div>

          {/* §7 — what was changed on this account, and by whom. Field-level
              old → new comes from `changeSummary`, so it reads the same here as
              it does on the audit page. */}
          {historyOpen && (
            <div className="rounded border border-sand bg-white">
              {history === null ? (
                <p className="p-3 text-xs text-steel">Loading history…</p>
              ) : history.length === 0 ? (
                <p className="p-3 text-xs text-steel">Nothing has been edited or deleted on this account.</p>
              ) : (
                <div className="scroll-thin max-h-56 overflow-auto">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-ivory/90 backdrop-blur">
                      <tr className="border-b border-sand">
                        <th className="w-36 px-2 py-1.5 text-left font-semibold uppercase tracking-wide text-steel">When</th>
                        <th className="w-28 px-2 py-1.5 text-left font-semibold uppercase tracking-wide text-steel">Who</th>
                        <th className="w-20 px-2 py-1.5 text-left font-semibold uppercase tracking-wide text-steel">Action</th>
                        <th className="px-2 py-1.5 text-left font-semibold uppercase tracking-wide text-steel">What changed</th>
                      </tr>
                    </thead>
                    <tbody>
                      {history.map((row) => (
                        <tr key={row.id} className="border-b border-sand/50 last:border-0 align-top">
                          <td className="whitespace-nowrap px-2 py-1.5 tabular-nums text-steel">
                            {formatTimestamp(row.createdAt)}
                          </td>
                          <td className="px-2 py-1.5 text-steel">{row.userName}</td>
                          <td className="px-2 py-1.5 text-steel">{row.action}</td>
                          <td className="px-2 py-1.5 text-ink">
                            <span className="font-medium">{row.entity}</span>
                            {row.summary ? ` · ${row.summary}` : ""}
                            {/* One field per line: a save that moved four columns
                                is unreadable as a single run-on sentence. */}
                            {row.detail && (
                              <span className="mt-0.5 block text-steel">
                                {row.detail.split("; ").map((line, i) => (
                                  <span key={i} className="block">{line}</span>
                                ))}
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* Ledger table */}
          {entriesWithBalance.length === 0 ? (
            <div className="rounded border border-sand bg-white p-8 text-center">
              <p className="text-sm text-steel">No transactions in this period.</p>
              <p className="mt-1 text-sm text-steel">
                Opening balance: <span className="tabular-nums font-semibold text-ink">{money(data.openingBalance)}</span>
              </p>
            </div>
          ) : (
            <div className="scroll-thin max-h-[55vh] overflow-auto rounded-lg border border-sand bg-white">
              <table className="w-full min-w-[76rem] border-collapse text-sm">
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
                    <th className="w-28 py-2.5 text-center text-xs font-semibold uppercase tracking-wide text-steel">Status</th>
                    <th className="w-12 py-2.5"></th>
                  </tr>
                </thead>
                <tbody
                  ref={tbodyRef}
                  {...{
                    onMouseDown: ledgerGridSelectionProps.onMouseDown,
                    onCopy: (e: ClipboardEvent<HTMLTableSectionElement>) => ledgerGridSelectionProps.onCopy(e),
                    onPaste: (e: ClipboardEvent<HTMLTableSectionElement>) => ledgerGridSelectionProps.onPaste(e, reload),
                  }}
                >
                  {entriesWithBalance.map((e, i) => (
                    <tr key={`${e.id}-${i}`} className={`border-b border-sand/50 ${i % 2 === 1 ? "bg-ivory/30" : ""}`}>
                      <td className="whitespace-nowrap py-2.5 pl-8 pr-8 tabular-nums text-steel">{formatDate(e.date)}</td>
                      <td className="py-2"><DescriptionCell entry={e} /></td>
                      <td className="py-2 text-center text-xs tabular-nums text-steel">
                        <RefCell entry={e} ctx={refCellContext} />
                      </td>
                      <td className="py-2.5 pr-4 text-right tabular-nums text-ink" data-cell tabIndex={-1}>{e.debit > 0 ? money(e.debit) : ""}</td>
                      <td className="py-2.5 pr-4 text-right tabular-nums text-success" data-cell tabIndex={-1}>{e.credit > 0 ? money(e.credit) : ""}</td>
                      <td className={`py-2.5 pr-6 text-right font-medium tabular-nums ${e.balance > 0 ? "text-error" : e.balance < 0 ? "text-success" : "text-ink"}`} data-cell tabIndex={-1}>
                        {money(e.balance)}
                      </td>
                      <td className="py-2 text-center">
                        {e.documentStatus === "cancelled" ? (
                          <span className="rounded border border-steel/30 bg-ivory px-1.5 py-0.5 text-[10px] font-medium text-steel">Cancelled</span>
                        ) : (
                          <SettlementCell entry={e} />
                        )}
                      </td>
                      <td className="py-2 pr-2 text-center">
                        <button
                          type="button"
                          title="Delete this entry"
                          disabled={deletingId === e.documentId}
                          onClick={() => void askDelete(e)}
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
                    <td className="py-2 pr-4 text-right tabular-nums text-ink" data-cell tabIndex={-1}>{money(summary.totalDebit)}</td>
                    <td className="py-2 pr-4 text-right tabular-nums text-success" data-cell tabIndex={-1}>{money(summary.totalCredit)}</td>
                    <td className={`py-2 pr-4 text-right tabular-nums ${summary.closing > 0 ? "text-error" : summary.closing < 0 ? "text-success" : "text-ink"}`}>
                      {money(summary.closing)}
                    </td>
                    <td colSpan={2}></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}

          {/* Status bar — shows when cells are selected */}
          {selectionStats && (
            <div className="flex items-center justify-between rounded border border-sand bg-ivory/50 px-3 py-1.5 text-xs text-steel">
              <span className="tabular-nums text-ink">
                {selectionStats.count} cell{selectionStats.count === 1 ? "" : "s"} selected
              </span>
              <div className="flex gap-3">
                <span>Sum: <span className="tabular-nums font-medium text-ink">{money(selectionStats.sum)}</span></span>
                <span>Difference: <span className="tabular-nums font-medium text-ink">{money(selectionStats.max - selectionStats.min)}</span></span>
                <span>Product: <span className="tabular-nums font-medium text-ink">{selectionStats.count > 1 ? (selectionStats.product).toLocaleString() : "—"}</span></span>
                <span>Average: <span className="tabular-nums font-medium text-ink">{selectionStats.count > 0 ? money(selectionStats.sum / selectionStats.count) : "—"}</span></span>
              </div>
            </div>
          )}
        </div>
      )}

    </Dialog>

      {/* Delete confirmation — first click */}
      {confirmDelete && !confirmDelete2 && (
        <Dialog title="Confirm Delete" onClose={() => { setConfirmDelete(null); setImpact(null); setImpactError(null); }} size="form">
          <div className="flex flex-col gap-3">
            <p className="text-sm text-ink">
              Are you sure you want to delete this {TYPE_LABELS[confirmDelete.entry.type].toLowerCase()} entry?
            </p>
            <p className="text-xs text-steel">
              Reference: {confirmDelete.entry.reference ?? "—"} · {formatDate(confirmDelete.entry.date)}
            </p>
            {confirmDelete.entry.debit > 0 && <p className="text-xs text-steel">Debit: {money(confirmDelete.entry.debit)}</p>}
            {confirmDelete.entry.credit > 0 && <p className="text-xs text-steel">Credit: {money(confirmDelete.entry.credit)}</p>}

            {/* §6 — what else on the account this moves, named at both ends. The
                whole reason this is a confirmation and not a refusal: a document
                can be removed, and the person removing it gets to see the
                settlement it releases before deciding. */}
            <div className="rounded border border-sand bg-ivory/50 p-2.5">
              {impactError ? (
                <p className="text-xs text-error">{impactError}</p>
              ) : impact?.documentId === confirmDelete.entry.documentId ? (
                <ImpactList preview={impact.preview} />
              ) : (
                <p className="text-xs text-steel">Working out what else this affects…</p>
              )}
            </div>

            <div className="flex gap-2">
              <button type="button" onClick={() => setConfirmDelete2(confirmDelete)} className="rounded bg-error px-4 py-2 text-sm font-semibold text-white hover:bg-error/80">
                Yes, delete it
              </button>
              <button type="button" onClick={() => { setConfirmDelete(null); setImpact(null); setImpactError(null); }} className="rounded px-4 py-2 text-sm font-medium text-steel hover:bg-ivory">
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
            {impact?.documentId === confirmDelete2.entry.documentId && impact.preview.impacts.length > 0 && (
              <p className="text-xs text-steel">
                {impact.preview.impacts.length} settlement{impact.preview.impacts.length === 1 ? "" : "s"} will be recalculated
                {impact.preview.released > 0 ? `, and ${money(impact.preview.released)} will go back onto the party's account` : ""}.
              </p>
            )}
            <div className="flex gap-2">
              <button type="button" onClick={() => void handleDelete(confirmDelete2.entry.documentId)} className="rounded bg-error px-4 py-2 text-sm font-semibold text-white hover:bg-error/80">
                Delete permanently
              </button>
              <button type="button" onClick={() => { setConfirmDelete(null); setConfirmDelete2(null); setImpact(null); setImpactError(null); }} className="rounded px-4 py-2 text-sm font-medium text-steel hover:bg-ivory">
                Cancel
              </button>
            </div>
          </div>
        </Dialog>
      )}

      {/* §8 — inline edit popups opened from a ref number on the statement. These
          are the same forms the Payments and Stock Purchase pages mount, fetched
          on demand and reused via a warm cache so a ref opened twice doesn't
          re-fetch. After a save the statement is reloaded whole. */}
      {editingPayment && (
        <Dialog title={editingPayment.detail.direction === "made" ? "Edit Payment Made" : "Edit Payment Received"} onClose={closePaymentEdit} size="wide">
          <div className="flex flex-col gap-4">
            <PaymentEditForm
              paymentId={editingPayment.id}
              direction={editingPayment.detail.direction as PaymentDirection}
              defaults={editingPayment.detail}
              companyOptions={formOptions ? formOptions.payment.companyOptions : []}
              contactOptions={formOptions ? formOptions.payment.contactOptions : []}
              bankAccountOptions={formOptions ? formOptions.payment.bankAccountOptions : []}
              cashAccountOptions={formOptions ? formOptions.payment.cashAccountOptions : []}
              chequeOptions={editingPayment.cheques}
              onDone={() => {
                closePaymentEdit();
                void reload();
                setHistory(null);
              }}
            />
          </div>
        </Dialog>
      )}

      {editingPurchase && (
        <Dialog title="Edit Stock Purchase" onClose={closePurchaseEdit} size="xwide">
          <div className="flex flex-col gap-4">
            <StockPurchaseCreateForm
              purchaseId={editingPurchase.id}
              defaults={editingPurchase.detail}
              companyOptions={formOptions ? formOptions.purchase.companyOptions : []}
              supplierOptions={formOptions ? formOptions.purchase.supplierOptions : []}
              itemOptions={formOptions ? formOptions.purchase.itemOptions : []}
              documentTypeOptions={formOptions ? formOptions.purchase.documentTypeOptions : []}
              locationOptions={formOptions ? formOptions.purchase.locationOptions : []}
              unitOptions={formOptions ? formOptions.purchase.unitOptions : []}
              bankAccountOptions={formOptions ? formOptions.purchase.bankAccountOptions : []}
              cashAccountOptions={formOptions ? formOptions.purchase.cashAccountOptions : []}
              chequeOptions={editingPurchase.cheques}
              taxOptions={formOptions ? formOptions.purchase.taxOptions : []}
              conversionOptions={formOptions ? formOptions.purchase.conversionOptions : []}
              taxSettings={formOptions ? formOptions.purchase.taxSettings : {}}
              onDone={() => {
                closePurchaseEdit();
                void reload();
                setHistory(null);
              }}
            />
          </div>
        </Dialog>
      )}

      {/* §4 — the opening balance, edited where it is shown. */}
      {editOpening && data && (
        <OpeningBalanceDialog
          companyId={companyId}
          contactId={contactId}
          contactName={contactName}
          current={data.openingBalance}
          onClose={() => setEditOpening(false)}
          onSaved={async () => {
            setEditOpening(false);
            await reload();
            setHistory(null);
          }}
        />
      )}

      {/* Off-screen render for export — rendered outside Dialog to avoid overflow clipping */}
    </>
  );
}

// ---------------------------------------------------------------------------
// The party's opening balance
// ---------------------------------------------------------------------------

// §1's oldest item and §4's widest edit in one small form. Two things make it
// worth its own component: the figure is signed by a direction rather than a
// minus sign, because "40,000" on a statement is meaningless without which way it
// runs; and changing it can pull receipts off invoices, so the impact list is on
// screen before the save, and the release is confirmed rather than refused.
function OpeningBalanceDialog({
  companyId,
  contactId,
  contactName,
  current,
  onClose,
  onSaved,
}: {
  companyId: string;
  contactId: string;
  contactName: string;
  // The stored figure as the statement reads it: positive means the party owes us
  // (debit - credit). The write path uses the list convention (credit - debit,
  // positive = we owe), so this dialog negates before sending.
  current: number;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const [direction, setDirection] = useState<"owes_us" | "we_owe">(current < 0 ? "we_owe" : "owes_us");
  const [amount, setAmount] = useState(() => (current === 0 ? "" : Math.abs(current).toFixed(2)));
  const [documentDate, setDocumentDate] = useState("");
  const [note, setNote] = useState("");
  const [loaded, setLoaded] = useState(false);

  // The date and the note aren't on the statement — only the figure is — so the
  // rest of the document is read here.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const stored = await getPartyOpeningBalance(companyId, contactId);
        if (cancelled) return;
        setDocumentDate(stored.date ?? todayISO());
        setNote(stored.note ?? "");
      } catch {
        if (!cancelled) setDocumentDate(todayISO());
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, [companyId, contactId]);

  const signedAmount = useMemo(() => {
    const magnitude = Number(amount);
    if (!Number.isFinite(magnitude)) return 0;
    return openingStatementAmount(direction, magnitude);
  }, [amount, direction]);

  // What this figure would do to the settlement, shown while it is being typed.
  //
  // Two values, and the split is deliberate. `fetched` is what the server last
  // answered, which only an await can change. Whether there is anything to show
  // is a fact about *this* render — the figure either differs from the stored one
  // or it doesn't — so it is derived rather than stored. Writing it down from the
  // effect body instead made the same claim one render later, and is the cascading
  // render react-hooks/set-state-in-effect exists to catch.
  const [fetched, setFetched] = useState<LedgerImpactPreview | null>(null);
  const impact = signedAmount === current ? null : fetched;
  useEffect(() => {
    if (!loaded) return;
    // Nothing to preview for a figure that isn't a change. `impact` above is
    // already null on this render, so there is nothing left to clear here.
    if (signedAmount === current) return;
    let cancelled = false;
    (async () => {
      try {
        const preview = await previewPartyOpeningBalance(companyId, contactId, signedAmount);
        if (!cancelled) setFetched("error" in preview ? null : preview);
      } catch {
        if (!cancelled) setFetched(null);
      }
    })();
    return () => { cancelled = true; };
  }, [loaded, signedAmount, current, companyId, contactId]);

  // The server decides whether a release needs confirming — it holds the
  // allocations and the rule. Its refusal is the prompt: the sentence it returns
  // says what would be released, and the button below resends the same form with
  // the acknowledgement attached. Nothing about that rule is repeated here.
  const [state, action, pending] = useActionState(
    async (prev: { error?: string; success?: boolean; needsConfirmation?: boolean } | undefined, formData: FormData) => {
      try {
        return await setPartyOpeningBalance(companyId, contactId, prev, formData);
      } catch {
        return { error: TRANSPORT_ERROR_MESSAGE };
      }
    },
    undefined,
  );

  // A typed flag, not the wording of the sentence: the refusal that asks to be
  // confirmed turns the Save into a Confirm. Derived from the latest answer rather
  // than copied into state — a copy could only ever hold the same value one render
  // later, and writing it from the effect body is the cascading render
  // react-hooks/set-state-in-effect flags. The acknowledgement still covers exactly
  // one submit: any other answer replaces `state`, so changing the figure has the
  // release it now implies asked about again rather than waved through.
  const confirming = !!state?.needsConfirmation;

  useEffect(() => {
    if (state?.success) void onSaved();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  return (
    <Dialog title={`Opening Balance — ${contactName}`} onClose={onClose} size="form">
      <form action={action} className="flex flex-col gap-3">
        <input type="hidden" name="confirmAllocations" value={confirming ? "1" : ""} />

        <p className="text-xs text-steel">
          What this party owed, or was owed, before the first document on this statement. It settles like any other item — the next
          receipt pays it off before it touches an invoice.
        </p>

        <label className={labelClass}>
          <span className={labelTextClass}>Direction</span>
          <select
            name="direction"
            value={direction}
            onChange={(e) => setDirection(e.target.value === "we_owe" ? "we_owe" : "owes_us")}
            className={fieldClass}
          >
            <option value="owes_us">Party owes us</option>
            <option value="we_owe">We owe the party</option>
          </select>
        </label>

        <label className={labelClass}>
          <span className={labelTextClass}>Amount</span>
          <input
            name="amount"
            type="number"
            step="0.01"
            min="0"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
            className={`${fieldClass} tabular-nums`}
          />
          <span className="text-xs text-steel">Zero clears the opening balance.</span>
        </label>

        <label className={labelClass}>
          <span className={labelTextClass}>As at</span>
          <DateField name="documentDate" value={documentDate} onChange={setDocumentDate} required aria-label="Opening balance date" />
        </label>

        <label className={labelClass}>
          <span className={labelTextClass}>Note</span>
          <input name="note" type="text" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Carried over from previous books" className={fieldClass} />
        </label>

        {impact && (impact.impacts.length > 0 || impact.released > 0) && (
          <div className="rounded border border-warning/40 bg-warning-tint p-2.5">
            <ImpactList preview={impact} />
          </div>
        )}

        {state?.error && (
          <p className={state.needsConfirmation ? confirmNoticeClass : errorTextClass}>{state.error}</p>
        )}

        <div className="flex items-center gap-2">
          <button type="submit" disabled={pending || !loaded} className={primaryActionClass}>
            {pending ? "Saving…" : confirming ? "Confirm and save" : "Save"}
          </button>
          <button type="button" onClick={onClose} className="rounded px-4 py-2 text-sm font-medium text-steel hover:bg-ivory">
            Cancel
          </button>
        </div>
      </form>
    </Dialog>
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
