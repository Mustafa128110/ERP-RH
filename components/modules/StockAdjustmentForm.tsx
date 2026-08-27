"use client";

import { useActionState, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { approveStockAdjustment, createStockAdjustment, deleteStockAdjustment, getRecentStockAdjustmentRates } from "@/lib/actions/stock-adjustments";
import { ADJUSTMENT_REASONS } from "@/lib/adjustment-constants";
import { fieldClass, labelClass, labelTextClass, errorTextClass, successTextClass, TRANSPORT_ERROR_MESSAGE } from "@/components/ui/form-styles";
import { DateField } from "@/components/ui/DateField";
import { todayISO } from "@/lib/format";
import { ComboBox } from "@/components/ui/ComboBox";
import { gridKeyDown, gridSelectionProps } from "@/components/ui/grid-keys";
import { UNASSIGNED_LABEL, UNASSIGNED_LOCATION } from "@/lib/location-constants";
import { clearDraft } from "@/lib/draft";
import { useClientUserId } from "@/lib/client-user";
import { DraftBanner, useDraft } from "@/components/ui/useDraft";

const sectionTitleClass = "text-sm font-semibold text-navy-800";
const cellInput = "h-9 w-full min-w-0 bg-transparent px-2 text-sm text-ink outline-none focus:bg-navy-800/5";
const thClass = "border border-sand px-2 py-1.5 text-left text-xs font-semibold uppercase tracking-wide text-steel";
const tdClass = "border border-sand p-0";

type Option = { id: string; name: string };
type ScopedOption = Option & { companyId: string };
type Line = { itemId: string; itemText: string; unitId: string; unitText: string; quantity: string; unitCost: string };

// One draft per form: only one adjustment is ever being typed. The user id is
// appended at the call site (adjustment:<uid>) so a shared browser never offers
// one user's half-typed adjustment to another.
const ADJUSTMENT_DRAFT_KEY = "adjustment";

const emptyLine = (): Line => ({ itemId: "", itemText: "", unitId: "", unitText: "", quantity: "", unitCost: "" });

// Same grid as sales and transfers. The one difference: quantity is signed —
// negative writes stock off, positive adds it back — so the input has no min="0".
export function StockAdjustmentFormPage({
  companyOptions,
  itemOptions,
  unitOptions,
  locationOptions,
  onDone,
}: {
  companyOptions: Option[];
  itemOptions: ScopedOption[];
  unitOptions: Option[];
  locationOptions: Option[];
  // When the form lives in a popup (the list page's add dialog), a successful
  // save closes it instead of clearing for the next entry.
  onDone?: () => void;
}) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const gridRef = useRef<HTMLTableSectionElement>(null);
  function focusCell(r: number, c: number) {
    gridRef.current?.querySelector<HTMLInputElement>(`[data-cell="${r}-${c}"]`)?.focus();
  }

  const [lines, setLines] = useState<Line[]>([emptyLine(), emptyLine(), emptyLine(), emptyLine()]);
  const [companyId, setCompanyId] = useState(() => companyOptions.find((c) => c.name === "Royal Hardware")?.id ?? "");
  // The date, location and reason are controlled (not defaultValue) so a draft
  // captures the whole adjustment, not just the grid.
  const [documentDate, setDocumentDate] = useState(todayISO());
  const [locationId, setLocationId] = useState("");
  const [reason, setReason] = useState("");
  const [recentRates, setRecentRates] = useState<Record<string, string[]>>({});
  // The draft key is composed per render from the logged-in user — SessionSeed
  // (in the layout) sets the id before children render, so the first render
  // already carries the scoped key.
  const userId = useClientUserId();
  const adjustmentDraftKey = userId ? `${ADJUSTMENT_DRAFT_KEY}:${userId}` : ADJUSTMENT_DRAFT_KEY;

  // --- Draft ----------------------------------------------------------------
  // An adjustment is a shelf-count typed against live stock levels — the worst
  // possible thing to lose — so the whole form (grid, date, location, reason)
  // is drafted while it's being typed. There is no edit path for an adjustment,
  // so there is no "new only" rule to apply here.
  const draftState = { lines, companyId, documentDate, locationId, reason };
  type AdjustmentDraft = typeof draftState;

  const { offerDraft, restore: restoreDraft, discard: discardDraft } = useDraft<AdjustmentDraft>(adjustmentDraftKey, {
    state: draftState,
    enabled: true,
    hasContent: (d) => d.lines.some((l) => l.itemText.trim() || l.quantity.trim()),
    apply: (d) => {
      setLines(d.lines);
      setCompanyId(d.companyId);
      setDocumentDate(d.documentDate);
      setLocationId(d.locationId);
      setReason(d.reason);
    },
  });

  function resetForm() {
    setLines([emptyLine(), emptyLine(), emptyLine(), emptyLine()]);
    setDocumentDate(todayISO());
    setLocationId("");
    setReason("");
    formRef.current?.reset();
    focusCell(0, 0);
  }

  // One id per *save*, not per open form: claimed by the server inside the same
  // transaction as the adjustment, so a replayed submit can't post twice — but the
  // claim outlives the save by a day, so a form that clears itself for the next
  // adjustment has to stop sending the spent id. Re-minted on success only.
  const [operationId, setOperationId] = useState(() => crypto.randomUUID());
  const [state, action, pending] = useActionState(
    async (prev: { error?: string; success?: boolean; id?: string; status?: "posted" | "pending" } | undefined, formData: FormData) => {
      // A transport failure must not throw into the error boundary — that would
      // lose the form (and its operation id), and a restored draft would mint a
      // fresh id and post the adjustment twice. Keep the form alive; a replayed
      // Save is then refused server-side as a duplicate.
      let result: { error?: string; success?: boolean; id?: string; status?: "posted" | "pending" } | undefined;
      try {
        result = await createStockAdjustment(prev, formData);
      } catch {
        return { error: TRANSPORT_ERROR_MESSAGE };
      }
      if (result?.success) {
        // Saved — the local copy has nothing left to protect.
        clearDraft(adjustmentDraftKey);
        // Spent id: the server holds the claim for a day, so reusing it would have
        // the next adjustment refused as a replay of this one — "already
        // recorded", nothing written. Safe to replace only here, where the
        // response came back; a failure keeps it so a lost response can't post the
        // adjustment twice.
        setOperationId(crypto.randomUUID());
        if (onDone) onDone();
        else resetForm();
      }
      return result;
    },
    undefined,
  );

  function patchLine(i: number, patch: (l: Line) => Line) {
    setLines((prev) => {
      const next = prev.map((l, idx) => (idx === i ? patch(l) : l));
      return i === prev.length - 1 ? [...next, emptyLine()] : next;
    });
  }
  function updateLine(i: number, patch: Partial<Line>) {
    patchLine(i, (l) => ({ ...l, ...patch }));
  }

  const visibleItems = useMemo(() => itemOptions.filter((it) => it.companyId === companyId), [itemOptions, companyId]);

  function changeCompany(next: string) {
    setCompanyId(next);
    setLines((prev) => prev.map((l) => (l.itemId && !itemOptions.some((it) => it.id === l.itemId && it.companyId === next) ? { ...l, itemId: "" } : l)));
  }

  function pickItem(row: number, name: string) {
    const item = visibleItems.find((option) => option.name === name);
    updateLine(row, { itemText: name, itemId: item?.id ?? "", unitCost: "" });
    if (!item) return;
    void getRecentStockAdjustmentRates(item.id).then((rates) => {
      setRecentRates((previous) => ({ ...previous, [item.id]: rates }));
      setLines((previous) => previous.map((line, index) => index === row && line.itemId === item.id ? { ...line, unitCost: rates[0] ?? "" } : line));
    });
  }

  return (
    <form ref={formRef} action={action} className="flex flex-col gap-5">
      <input type="hidden" name="operationId" value={operationId} />
      <input
        type="hidden"
        name="linesJson"
        value={JSON.stringify(lines.map((l) => ({ ...l, itemName: l.itemText, unitName: l.unitText })))}
      />

      {/* An unfinished adjustment from before — a crash, a closed tab, a reload.
          Offered, never applied on its own. */}
      {offerDraft && <DraftBanner noun="stock adjustment" onRestore={restoreDraft} onDiscard={discardDraft} />}

      <div className="flex flex-col gap-3">
        <span className={sectionTitleClass}>Adjustment</span>
        <div className="flex flex-wrap gap-3">
          <label className={`${labelClass} w-56`}>
            <span className={labelTextClass}>Company</span>
            <select name="companyId" required value={companyId} onChange={(e) => changeCompany(e.target.value)} className={fieldClass}>
              <option value="" disabled>
                {companyOptions.length === 0 ? "No companies yet" : "Select a company"}
              </option>
              {companyOptions.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label className={`${labelClass} w-40`}>
            <span className={labelTextClass}>Date</span>
            <DateField name="documentDate" required value={documentDate} onChange={setDocumentDate} className={fieldClass} />
          </label>
          <label className={`${labelClass} w-56`}>
            <span className={labelTextClass}>Location</span>
            <select name="locationId" required value={locationId} onChange={(e) => setLocationId(e.target.value)} className={fieldClass}>
              <option value="" disabled>
                Select a location
              </option>
              {/* Stock booked without a location is still stock, and still gets
                  counted, damaged or written off. */}
              <option value={UNASSIGNED_LOCATION}>{UNASSIGNED_LABEL}</option>
              {locationOptions.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </label>
          <label className={`${labelClass} w-56`}>
            <span className={labelTextClass}>Reason</span>
            <select name="reason" required value={reason} onChange={(e) => setReason(e.target.value)} className={fieldClass}>
              <option value="" disabled>
                Select a reason
              </option>
              {ADJUSTMENT_REASONS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <span className={sectionTitleClass}>Items</span>
        <div className="overflow-x-auto rounded border border-sand">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                <th className={`${thClass} w-10 text-right`}>#</th>
                <th className={thClass}>Item</th>
                <th className={`${thClass} w-32`}>Unit</th>
                <th className={`${thClass} w-44`} title="Latest three distinct purchase rates, per base stock unit">
                  Purchase Rate
                </th>
                <th className={`${thClass} w-28`} title="Negative writes stock off, positive adds it">
                  Adjust By
                </th>
                <th className="w-8 border border-sand" />
              </tr>
            </thead>
            <tbody ref={gridRef} {...gridSelectionProps} onKeyDown={(e) => gridKeyDown(e, gridRef)}>
              {lines.map((line, r) => (
                <tr key={r}>
                  <td className="border border-sand px-2 text-right text-xs tabular-nums text-steel">{r + 1}</td>
                  <td className={tdClass}>
                    <ComboBox
                      value={line.itemText}
                      options={visibleItems}
                      placeholder="Item"
                      className={cellInput}
                      // data-shortcut="i" marks the first line's item box so
                      // Ctrl+I can jump to it from anywhere in the form. An
                      // adjustment has no discount/tax/shipping, so only this
                      // one jump exists here.
                      inputProps={{ "data-cell": `${r}-0`, ...(r === 0 ? { "data-shortcut": "i" } : {}) }}
                      onChange={(name) => pickItem(r, name)}
                    />
                  </td>
                  <td className={tdClass}>
                    <ComboBox
                      value={line.unitText}
                      options={unitOptions}
                      placeholder="Unit"
                      className={cellInput}
                      inputProps={{ "data-cell": `${r}-1` }}
                      onChange={(name) => updateLine(r, { unitText: name, unitId: unitOptions.find((u) => u.name === name)?.id ?? "" })}
                    />
                  </td>
                  <td className={tdClass}>
                    <select
                      value={line.unitCost}
                      onChange={(e) => updateLine(r, { unitCost: e.target.value })}
                      className={cellInput}
                      disabled={!line.itemId}
                    >
                      <option value="">Current valuation</option>
                      {(recentRates[line.itemId] ?? []).map((rate) => (
                        <option key={rate} value={rate}>
                          Rs {rate}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className={tdClass}>
                    <input
                      data-cell={`${r}-2`}
                      type="number"
                      step="0.01"
                      placeholder="+/- Qty"
                      value={line.quantity}
                      onChange={(e) => updateLine(r, { quantity: e.target.value })}
                      className={`${cellInput} text-right ${Number(line.quantity) < 0 ? "text-error" : ""}`}
                    />
                  </td>
                  <td className="border border-sand text-center">
                    <button
                      type="button"
                      onClick={() => setLines((prev) => (prev.length > 1 ? prev.filter((_, idx) => idx !== r) : prev))}
                      className="text-steel hover:text-error"
                      aria-label="Remove line"
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {state?.error && <p className={errorTextClass}>{state.error}</p>}
      {state?.success && (
        <p className={successTextClass}>
          {state.status === "pending" ? "Adjustment saved for approval" : "Adjustment posted"} — form cleared for the next one.{" "}
          {state.id && (
            <Link href={`/inventory/stock-adjustments/${state.id}`} className="underline">
              View it
            </Link>
          )}
        </p>
      )}

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="h-12 w-fit rounded bg-navy-800 px-6 text-base font-semibold text-white hover:bg-navy-700 disabled:opacity-40"
        >
          {pending ? "Posting…" : "Post Adjustment"}
        </button>
        {/* The popup's own ✕ is the way out when this form sits in a dialog. */}
        {!onDone && (
          <button
            type="button"
            onClick={() => router.push("/inventory/stock-adjustments")}
            className="h-12 rounded px-4 text-sm font-medium text-steel hover:bg-ivory"
          >
            Back to Adjustments
          </button>
        )}
      </div>
    </form>
  );
}

export function DeleteStockAdjustmentButton({ adjustmentId }: { adjustmentId: string }) {
  const router = useRouter();
  const [state, action, pending] = useActionState(deleteStockAdjustment, undefined);

  useEffect(() => {
    if (state?.success) router.push("/inventory/stock-adjustments");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.success]);

  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (!confirm("Cancel this adjustment? Its stock effect will be reversed and the document will remain in the audit trail.")) e.preventDefault();
      }}
    >
      <input type="hidden" name="documentId" value={adjustmentId} />
      <button type="submit" disabled={pending} className="text-sm font-medium text-error hover:underline disabled:opacity-40">
        {pending ? "Cancelling…" : "Cancel this adjustment"}
      </button>
      {state?.error && <p className={`mt-2 ${errorTextClass}`}>{state.error}</p>}
    </form>
  );
}

export function ApproveStockAdjustmentButton({ adjustmentId }: { adjustmentId: string }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [state, action, pending] = useActionState(approveStockAdjustment, undefined);
  useEffect(() => {
    // The action already invalidated the stock/products reads, so the refresh
    // serves the fresh copy from the server cache. Non-blocking keeps the UI
    // responsive while it happens.
    if (state?.success) startTransition(() => router.refresh());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.success]);
  return (
    <form action={action}>
      <input type="hidden" name="documentId" value={adjustmentId} />
      <button type="submit" disabled={pending} className="h-10 rounded bg-navy-800 px-4 text-sm font-semibold text-white disabled:opacity-40">
        {pending ? "Approving…" : "Approve & Post"}
      </button>
      {state?.error && <p className={`mt-2 ${errorTextClass}`}>{state.error}</p>}
    </form>
  );
}
