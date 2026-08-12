"use client";

import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createStockAdjustment, deleteStockAdjustment } from "@/lib/actions/stock-adjustments";
import { ADJUSTMENT_REASONS } from "@/lib/adjustment-constants";
import { fieldClass, labelClass, labelTextClass, errorTextClass, successTextClass } from "@/components/ui/form-styles";
import { DateField } from "@/components/ui/DateField";
import { todayISO } from "@/lib/format";
import { ComboBox } from "@/components/ui/ComboBox";
import { gridKeyDown, gridSelectionProps } from "@/components/ui/grid-keys";
import { UNASSIGNED_LABEL, UNASSIGNED_LOCATION } from "@/lib/location-constants";

const sectionTitleClass = "text-sm font-semibold text-navy-800";
const cellInput = "h-9 w-full min-w-0 bg-transparent px-2 text-sm text-ink outline-none focus:bg-navy-800/5";
const thClass = "border border-sand px-2 py-1.5 text-left text-xs font-semibold uppercase tracking-wide text-steel";
const tdClass = "border border-sand p-0";

type Option = { id: string; name: string };
type ScopedOption = Option & { companyId: string };
type Line = { itemId: string; itemText: string; unitId: string; unitText: string; quantity: string };

const emptyLine = (): Line => ({ itemId: "", itemText: "", unitId: "", unitText: "", quantity: "" });

// Same grid as sales and transfers. The one difference: quantity is signed —
// negative writes stock off, positive adds it back — so the input has no min="0".
export function StockAdjustmentFormPage({
  companyOptions,
  itemOptions,
  unitOptions,
  locationOptions,
}: {
  companyOptions: Option[];
  itemOptions: ScopedOption[];
  unitOptions: Option[];
  locationOptions: Option[];
}) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const gridRef = useRef<HTMLTableSectionElement>(null);
  function focusCell(r: number, c: number) {
    gridRef.current?.querySelector<HTMLInputElement>(`[data-cell="${r}-${c}"]`)?.focus();
  }

  const [lines, setLines] = useState<Line[]>([emptyLine(), emptyLine(), emptyLine(), emptyLine()]);
  const [companyId, setCompanyId] = useState(() => companyOptions.find((c) => c.name === "Royal Hardware")?.id ?? "");

  function resetForm() {
    setLines([emptyLine(), emptyLine(), emptyLine(), emptyLine()]);
    formRef.current?.reset();
    focusCell(0, 0);
  }

  const [state, action, pending] = useActionState(
    async (prev: { error?: string; success?: boolean; id?: string } | undefined, formData: FormData) => {
      const result = await createStockAdjustment(prev, formData);
      if (result?.success) resetForm();
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

  return (
    <form ref={formRef} action={action} className="flex flex-col gap-5">
      <input
        type="hidden"
        name="linesJson"
        value={JSON.stringify(lines.map((l) => ({ ...l, itemName: l.itemText, unitName: l.unitText })))}
      />

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
            <DateField name="documentDate" required defaultValue={todayISO()} className={fieldClass} />
          </label>
          <label className={`${labelClass} w-56`}>
            <span className={labelTextClass}>Location</span>
            <select name="locationId" required defaultValue="" className={fieldClass}>
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
            <select name="reason" required defaultValue="" className={fieldClass}>
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
                      onChange={(name) => updateLine(r, { itemText: name, itemId: visibleItems.find((it) => it.name === name)?.id ?? "" })}
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
          Adjustment posted — form cleared for the next one.{" "}
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
        <button
          type="button"
          onClick={() => router.push("/inventory/stock-adjustments")}
          className="h-12 rounded px-4 text-sm font-medium text-steel hover:bg-ivory"
        >
          Back to Adjustments
        </button>
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
        if (!confirm("Delete this adjustment? The stock it wrote off or added is put back.")) e.preventDefault();
      }}
    >
      <input type="hidden" name="documentId" value={adjustmentId} />
      <button type="submit" disabled={pending} className="text-sm font-medium text-error hover:underline disabled:opacity-40">
        {pending ? "Deleting…" : "Delete this adjustment"}
      </button>
      {state?.error && <p className={`mt-2 ${errorTextClass}`}>{state.error}</p>}
    </form>
  );
}
