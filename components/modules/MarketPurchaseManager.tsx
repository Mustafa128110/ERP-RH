"use client";
import {HistoryControls} from "@/components/ui/HistoryProvider";
import { FormRecovery, useRecoveryState } from "@/components/ui/FormRecovery";
import { isQueuedSave, saveStatus } from "@/lib/save-status";

import { useActionState, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cancelMarketPurchase, confirmMarketPurchases } from "@/lib/client-actions/market-purchases";
import { DateField } from "@/components/ui/DateField";
import { PageHeader } from "@/components/ui/PageHeader";
import {WorkspaceControls} from "@/components/layout/TableWorkspace";
import { StatusPill } from "@/components/ui/StatusPill";
import { errorTextClass, fieldClass, labelClass, labelTextClass, primaryActionClass, successTextClass } from "@/components/ui/form-styles";
import { formatDate, money, qty, todayISO } from "@/lib/format";

type RequestRow = {
  _revision: string;
  id: string;
  companyId: string;
  company: string;
  saleDocumentId: string;
  saleNumber: string;
  saleDate: string;
  customer: string | null;
  item: string;
  unit: string | null;
  quantity: string;
  purchaseCost: string | null;
  status: "pending" | "confirmed" | "cancelled";
  confirmationDocumentId: string | null;
  confirmationNumber: string | null;
};

type AccountOption = { id: string; name: string; companyId: string | null };

function MarketPurchaseManagerBody({
  requests,
  bankAccountOptions,
  cashAccountOptions,
  chequeOptions,
}: {
  requests: RequestRow[];
  bankAccountOptions: AccountOption[];
  cashAccountOptions: AccountOption[];
  chequeOptions: AccountOption[];
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const pendingRows = requests.filter((request) => request.status === "pending");
  const [selected, setSelected] = useRecoveryState<string[]>("selected", []);
  const [costs, setCosts] = useRecoveryState<Record<string, string>>("costs", {});
  const [settlementType, setSettlementType] = useRecoveryState<"account" | "cash" | "cheque">("settlementType", "cash");
  const [operationId, setOperationId] = useState(() => crypto.randomUUID());
  const [focused, setFocused] = useState(-1);
  const listRef = useRef<HTMLDivElement>(null);
  const tbodyRef = useRef<HTMLTableSectionElement>(null);

  useEffect(() => {
    if (focused < 0 || pendingRows.length === 0) return;
    const container = listRef.current;
    const rowEl = tbodyRef.current?.querySelector<HTMLElement>(`[data-row-index="${focused}"]`);
    if (!container || !rowEl) return;
    const headerHeight = container.querySelector("thead")?.getBoundingClientRect().height ?? 0;
    const cRect = container.getBoundingClientRect();
    const rRect = rowEl.getBoundingClientRect();
    if (rRect.top < cRect.top + headerHeight) container.scrollTop -= cRect.top + headerHeight - rRect.top;
    else if (rRect.bottom > cRect.bottom) container.scrollTop += rRect.bottom - cRect.bottom;
  }, [focused, pendingRows.length]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      if (target?.isContentEditable) return;
      const tag = target?.tagName;
      if (tag === "TEXTAREA" || tag === "SELECT") return;
      if (tag === "INPUT" && (target as HTMLInputElement).type !== "checkbox") return;
      const hasDialog = Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"]')).some(
        (dialog) => !dialog.hidden && !dialog.closest(".hidden,[hidden]"),
      );
      if (hasDialog || pendingRows.length === 0) return;
      if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Home" || e.key === "End") {
        e.preventDefault();
        const at = focused < 0 ? 0 : Math.min(focused, pendingRows.length - 1);
        const next =
          e.key === "ArrowDown" ? (focused < 0 ? 0 : Math.min(pendingRows.length - 1, at + 1))
          : e.key === "ArrowUp" ? (focused < 0 ? 0 : Math.max(0, at - 1))
          : e.key === "Home" ? 0
          : pendingRows.length - 1;
        setFocused(next);
      } else if (e.key === "Enter" && focused >= 0 && focused < pendingRows.length && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        toggle(pendingRows[focused]);
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  });
  const selectedCompany = pendingRows.find((row) => selected.includes(row.id))?.companyId ?? "";
  const selectedRows = pendingRows.filter((row) => selected.includes(row.id));
  const total = selectedRows.reduce((sum, row) => sum + Number(row.quantity) * Number(costs[row.id] || 0), 0);
  const payload = selectedRows.map((row) => ({ id: row.id, unitCost: costs[row.id] ?? "" }));

  const visibleAccounts = (options: AccountOption[]) => options.filter((option) => !selectedCompany || !option.companyId || option.companyId === selectedCompany);
  const [state, action, confirming] = useActionState(async (previous: Awaited<ReturnType<typeof confirmMarketPurchases>> | undefined, formData: FormData) => {
    const result = await confirmMarketPurchases(previous, formData);
    if (result.success) {
      setSelected([]);
      setCosts({});
      setOperationId(crypto.randomUUID());
      // The action already invalidated the stock/products reads, so the refresh
      // serves the fresh copy from the server cache — non-blocking so the UI
      // doesn't jank behind it.
      startTransition(() => router.refresh());
    }
    return result;
  }, undefined);

  const confirmedDocuments = useMemo(() => {
    const map = new Map<string, { id: string; number: string; company: string; lines: number; total: number }>();
    for (const row of requests) {
      if (row.status !== "confirmed" || !row.confirmationDocumentId) continue;
      const current = map.get(row.confirmationDocumentId) ?? { id: row.confirmationDocumentId, number: row.confirmationNumber ?? "Market Purchase", company: row.company, lines: 0, total: 0 };
      current.lines += 1;
      current.total += Number(row.quantity) * Number(row.purchaseCost ?? 0);
      map.set(row.confirmationDocumentId, current);
    }
    return [...map.values()];
  }, [requests]);

  function toggle(row: RequestRow) {
    setSelected((current) => {
      if (current.includes(row.id)) return current.filter((id) => id !== row.id);
      const currentCompany = pendingRows.find((candidate) => current.includes(candidate.id))?.companyId;
      if (currentCompany && currentCompany !== row.companyId) return current;
      return [...current, row.id];
    });
  }

  return (
    <div className="flex h-full flex-col gap-4">
      <PageHeader title="Market Purchases" subtitle={`${pendingRows.length} item(s) on this page waiting for confirmation`} />
      <WorkspaceControls label="Market purchase filters"><HistoryControls sortOptions={[{key:'date',label:'Date'},{key:'company',label:'Company'},{key:'customer',label:'Customer'},{key:'item',label:'Item'},{key:'quantity',label:'Quantity'},{key:'cost',label:'Cost'},{key:'status',label:'Status'},{key:'sale',label:'Sale'}]}/></WorkspaceControls>
      <div ref={listRef} data-list="global" tabIndex={0} className="mobile-data-list min-h-0 flex-1 overflow-auto rounded border border-sand bg-white outline-none">
        <table className="w-full min-w-[60rem] table-fixed border-collapse text-sm">
          <colgroup>
            <col style={{ width: "3rem" }} />
            <col style={{ width: "8.5rem" }} />
            <col style={{ width: "13rem" }} />
            <col style={{ width: "16rem" }} />
            <col style={{ width: "8.5rem" }} />
            <col style={{ width: "10rem" }} />
            <col style={{ width: "9rem" }} />
          </colgroup>
          <thead className="sticky top-0 z-10 bg-ivory text-left text-xs uppercase tracking-wide text-steel">
            <tr>
              <th className="border-b border-sand px-4 py-2.5" />
              <th className="border-b border-sand px-4 py-2.5">Sale</th>
              <th className="border-b border-sand px-4 py-2.5">Company / Customer</th>
              <th className="border-b border-sand px-4 py-2.5">Item</th>
              <th className="border-b border-sand px-4 py-2.5 text-right">Quantity</th>
              <th className="border-b border-sand px-4 py-2.5 text-right">Market Unit Cost</th>
              <th className="border-b border-sand px-4 py-2.5 text-right">Cost</th>
            </tr>
          </thead>
          <tbody ref={tbodyRef}>
            {pendingRows.map((row, rowIndex) => {
              const checked = selected.includes(row.id);
              const companyLocked = Boolean(selectedCompany && selectedCompany !== row.companyId);
              return (
                <tr key={row.id} data-row-index={rowIndex} data-focused={rowIndex === focused} onMouseDown={() => setFocused(rowIndex)} className={checked ? "bg-brass-50" : "hover:bg-ivory/60"}>
                  <td className="border-b border-sand px-4 py-2.5 text-center"><input type="checkbox" checked={checked} disabled={companyLocked} onChange={() => toggle(row)} className="h-4 w-4 accent-navy-800" /></td>
                  <td className="min-w-0 overflow-hidden border-b border-sand px-4 py-2.5"><span className="block truncate font-medium text-navy-800">{row.saleNumber}</span><span className="block truncate text-xs text-steel">{formatDate(row.saleDate)}</span></td>
                  <td className="min-w-0 overflow-hidden border-b border-sand px-4 py-2.5"><span className="block truncate">{row.company}</span><span className="block truncate text-xs text-steel">{row.customer ?? "Counter"}</span></td>
                  <td className="min-w-0 overflow-hidden break-words border-b border-sand px-4 py-2.5">{row.item}</td>
                  <td className="min-w-0 overflow-hidden whitespace-nowrap border-b border-sand px-4 py-2.5 text-right tabular-nums">{qty(row.quantity)} {row.unit ?? ""}</td>
                  <td className="min-w-0 overflow-hidden border-b border-sand px-4 py-2.5"><input type="number" min="0.01" step="0.01" value={costs[row.id] ?? ""} onFocus={() => !checked && toggle(row)} onChange={(event) => setCosts((current) => ({ ...current, [row.id]: event.target.value }))} className={`${fieldClass} ml-auto w-full text-right`} placeholder="Actual cost" /></td>
                  <td className="min-w-0 overflow-hidden whitespace-nowrap border-b border-sand px-4 py-2.5 text-right tabular-nums">{costs[row.id] ? money(Number(row.quantity) * Number(costs[row.id])) : "—"}</td>
                </tr>
              );
            })}
            {pendingRows.length === 0 && <tr><td colSpan={7} className="p-8 text-center text-steel">No pending items on this page.</td></tr>}
          </tbody>
        </table>
      </div>

      {pendingRows.length > 0 && (
        <WorkspaceControls label="Confirm market purchase"><form action={action} className="rounded border border-sand bg-white p-4">
          <input type="hidden" name="operationId" value={operationId} />
          <input type="hidden" name="requestsJson" value={JSON.stringify(payload)} />
          <div className="flex flex-wrap items-end gap-3">
            <label className={`${labelClass} w-full sm:w-40`}><span className={labelTextClass}>Purchase Date</span><DateField name="documentDate" required defaultValue={todayISO()} className={fieldClass} /></label>
            <label className={`${labelClass} w-full sm:w-40`}><span className={labelTextClass}>Paid Via</span><select value={settlementType} onChange={(event) => setSettlementType(event.target.value as typeof settlementType)} className={fieldClass}><option value="cash">Cash</option><option value="account">Bank Account</option><option value="cheque">Cheque</option></select></label>
            <label className={`${labelClass} w-full sm:min-w-64 sm:flex-1`}><span className={labelTextClass}>Settlement Account</span>
              <select key={settlementType} name={settlementType === "account" ? "bankAccountId" : settlementType === "cash" ? "cashAccountId" : "chequeId"} required className={fieldClass} defaultValue="">
                <option value="" disabled>Select account</option>
                {visibleAccounts(settlementType === "account" ? bankAccountOptions : settlementType === "cash" ? cashAccountOptions : chequeOptions).map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
              </select>
              <input type="hidden" name="settlementType" value={settlementType} />
            </label>
            <div className="ml-auto text-right"><p className="text-xs text-steel">{selected.length} item(s)</p><p className="text-lg font-semibold text-navy-800">{money(total)}</p></div>
            <button type="submit" disabled={confirming || selected.length === 0 || payload.some((row) => !(Number(row.unitCost) > 0))} className={primaryActionClass}>{confirming ? "Confirming…" : "Confirm Purchase"}</button>
          </div>
          {state?.error && <p className={`mt-3 ${errorTextClass}`}>{state.error}</p>}
          {state?.success && <p className={`mt-3 ${successTextClass}`}>{isQueuedSave(state) ? saveStatus(state) : "Market purchase posted, stock balanced, and Item Purchase expense recorded."}</p>}
        </form></WorkspaceControls>
      )}

      {requests.some(row=>row.status==="cancelled") && <WorkspaceControls label="Cancelled requests"><div className="rounded border border-sand p-4 text-sm"><h2 className="font-semibold">Cancelled requests</h2>{requests.filter(row=>row.status==="cancelled").map(row=><p key={row.id}>{row.saleNumber} · {row.item} · {qty(row.quantity)} {row.unit}</p>)}</div></WorkspaceControls>}
      {confirmedDocuments.length > 0 && <WorkspaceControls label="Confirmed purchases"><div className="rounded border border-sand bg-white p-4"><h2 className="mb-3 font-semibold text-navy-800">Confirmed purchases</h2><div className="flex flex-col divide-y divide-sand">{confirmedDocuments.map((doc) => <ConfirmedPurchase key={doc.id} {...doc} />)}</div></div></WorkspaceControls>}
    </div>
  );
}

function ConfirmedPurchase({ id, number, company, lines, total }: { id: string; number: string; company: string; lines: number; total: number }) {
  const router = useRouter();
  const [state, action, pending] = useActionState(cancelMarketPurchase, undefined);
  useEffect(() => { if (state?.success) router.refresh(); }, [state?.success, router]);
  return (
    <form action={action} className="flex items-center gap-3 py-2 text-sm">
      <input type="hidden" name="documentId" value={id} />
      <StatusPill value="Confirmed" />
      <span className="font-medium text-navy-800">{number}</span>
      <span className="flex-1">{company} · {lines} item(s)</span>
      <span className="tabular-nums">{money(total)}</span>
      <button
        type="submit"
        disabled={pending}
        onClick={(event) => {
          if (!confirm("Cancel this market purchase? Stock and the Item Purchase expense will be reversed, and its sales lines will return to Pending.")) event.preventDefault();
        }}
        className="font-medium text-error hover:underline"
      >
        {pending ? "Cancelling…" : "Cancel"}
      </button>
      {state?.error && <span className={errorTextClass}>{state.error}</span>}
    </form>
  );
}

export function MarketPurchaseManager(props: Parameters<typeof MarketPurchaseManagerBody>[0]) {
  const revisions = Object.fromEntries(props.requests.filter(row => row.status === "pending").map(row => [`market_purchase_requests:${row.id}`, row._revision]));
  const version = JSON.stringify(Object.entries(revisions).sort());
  return <FormRecovery key={version} domain="market_purchase_requests" id="confirmation" revision={version} revisions={revisions} createAction="market-purchases.confirmMarketPurchases"><MarketPurchaseManagerBody {...props}/></FormRecovery>;
}
