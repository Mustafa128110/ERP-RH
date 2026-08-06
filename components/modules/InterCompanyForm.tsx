"use client";

import { useActionState, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createInterCompanySale, updateInterCompanySale, type InterCompanyResult } from "@/lib/actions/inter-company";
import { fieldClass, labelClass, labelTextClass, errorTextClass, successTextClass } from "@/components/ui/form-styles";
import { ComboBox } from "@/components/ui/ComboBox";
import { gridKeyDown, gridSelectionProps } from "@/components/ui/grid-keys";
import { DateField } from "@/components/ui/DateField";
import { money, todayISO } from "@/lib/format";

const sectionTitleClass = "text-sm font-semibold text-navy-800";
const cellInput = "h-9 w-full min-w-0 bg-transparent px-2 text-sm text-ink outline-none focus:bg-navy-800/5";
const thClass = "border border-sand px-2 py-1.5 text-left text-xs font-semibold uppercase tracking-wide text-steel";
const tdClass = "border border-sand p-0";

type Option = { id: string; name: string };
type ItemOption = Option & { companyId: string; rate: string | null; salesRate: string | null };
type Line = { itemId: string; itemText: string; unitId: string; unitText: string; quantity: string; rate: string };

const emptyLine = (): Line => ({ itemId: "", itemText: "", unitId: "", unitText: "", quantity: "", rate: "" });

// Server lines carry ids; the combobox text is derived from the option lists on
// load. Only the seller's half is returned — the buyer's is the same items and
// quantities at the other location.
export type InterCompanyDefaults = {
  sellerCompanyId: string;
  buyerCompanyId: string;
  sellerName: string;
  buyerName: string;
  documentDate: string;
  fromLocationId: string;
  toLocationId: string;
  lines: { itemId: string; unitId: string; quantity: string; rate: string }[];
};

// One screen for "Royal Hardware sells this to M52": the sale and the matching
// purchase are written together by the action, so the rate is entered once and
// both documents agree by construction.
export function InterCompanyFormPage({
  companyOptions,
  itemOptions,
  unitOptions,
  locationOptions,
  saleId,
  defaults,
}: {
  companyOptions: Option[];
  itemOptions: ItemOption[];
  unitOptions: Option[];
  locationOptions: Option[];
  saleId?: string;
  defaults?: InterCompanyDefaults;
}) {
  const router = useRouter();
  const isEdit = !!saleId;
  const formRef = useRef<HTMLFormElement>(null);
  const gridRef = useRef<HTMLTableSectionElement>(null);
  function focusCell(r: number, c: number) {
    gridRef.current?.querySelector<HTMLInputElement>(`[data-cell="${r}-${c}"]`)?.focus();
  }

  // An edit gets its saved lines plus one blank row — the grid only grows when
  // its last row is edited, so without the spare an existing sale could never
  // gain an item.
  const [lines, setLines] = useState<Line[]>(() =>
    defaults
      ? [
          ...defaults.lines.map((l) => ({
            ...l,
            itemText: itemOptions.find((it) => it.id === l.itemId)?.name ?? "",
            unitText: unitOptions.find((u) => u.id === l.unitId)?.name ?? "",
          })),
          emptyLine(),
        ]
      : [emptyLine(), emptyLine(), emptyLine(), emptyLine()],
  );
  const [sellerCompanyId, setSellerCompanyId] = useState(
    () => defaults?.sellerCompanyId ?? companyOptions.find((c) => c.name === "Royal Hardware")?.id ?? "",
  );
  const [buyerCompanyId, setBuyerCompanyId] = useState(() => defaults?.buyerCompanyId ?? "");

  function resetForm() {
    setLines([emptyLine(), emptyLine(), emptyLine(), emptyLine()]);
    formRef.current?.reset();
    focusCell(0, 0);
  }

  // New sales are entered back to back, so a created one clears the form rather
  // than navigating away. An edit keeps what's on screen — it's still the sale
  // you're looking at.
  const [state, action, pending] = useActionState(async (prev: InterCompanyResult | undefined, formData: FormData) => {
    const result = isEdit ? await updateInterCompanySale(saleId!, prev, formData) : await createInterCompanySale(prev, formData);
    if (!isEdit && result?.success) resetForm();
    return result;
  }, undefined);

  function patchLine(i: number, patch: (l: Line) => Line) {
    setLines((prev) => {
      const next = prev.map((l, idx) => (idx === i ? patch(l) : l));
      return i === prev.length - 1 ? [...next, emptyLine()] : next;
    });
  }
  function updateLine(i: number, patch: Partial<Line>) {
    patchLine(i, (l) => ({ ...l, ...patch }));
  }

  // Items come from the seller's catalog — it's their stock going out. The buyer's
  // matching item is resolved by name on save, created there if it's new to them.
  const sellerItems = useMemo(() => itemOptions.filter((it) => it.companyId === sellerCompanyId), [itemOptions, sellerCompanyId]);

  function changeSeller(next: string) {
    setSellerCompanyId(next);
    if (buyerCompanyId === next) setBuyerCompanyId("");
    setLines((prev) => prev.map((l) => (l.itemId && !itemOptions.some((it) => it.id === l.itemId && it.companyId === next) ? { ...l, itemId: "" } : l)));
  }

  // The rate is what the seller charges, so it prefills from the item's selling
  // price and stays editable — inter-company rates are usually not retail.
  function pickItem(i: number, name: string) {
    const opt = sellerItems.find((it) => it.name === name);
    patchLine(i, (l) => {
      const sameItem = (opt?.id ?? "") === l.itemId;
      return { ...l, itemText: name, itemId: opt?.id ?? "", rate: sameItem ? l.rate : (opt?.salesRate ?? "") };
    });
  }

  const total = lines.reduce((sum, l) => sum + (Number(l.quantity) || 0) * (Number(l.rate) || 0), 0);

  return (
    <form ref={formRef} action={action} className="flex flex-col gap-5">
      <input
        type="hidden"
        name="linesJson"
        value={JSON.stringify(lines.map((l) => ({ ...l, itemName: l.itemText, unitName: l.unitText })))}
      />

      <div className="flex flex-col gap-3">
        <span className={sectionTitleClass}>Companies</span>
        <div className="flex flex-wrap gap-3">
          {/* Which company sells and which buys is fixed once created — the two
              documents live in those companies' own numbering series. Delete and
              re-enter to change them. */}
          {isEdit ? (
            <>
              <div className={`${labelClass} w-56`}>
                <span className={labelTextClass}>Seller (sells the stock)</span>
                <p className={`${fieldClass} flex items-center bg-ivory text-steel`}>{defaults?.sellerName}</p>
              </div>
              <div className={`${labelClass} w-56`}>
                <span className={labelTextClass}>Buyer (receives the stock)</span>
                <p className={`${fieldClass} flex items-center bg-ivory text-steel`}>{defaults?.buyerName}</p>
              </div>
            </>
          ) : (
            <>
              <label className={`${labelClass} w-56`}>
                <span className={labelTextClass}>Seller (sells the stock)</span>
                <select name="sellerCompanyId" required value={sellerCompanyId} onChange={(e) => changeSeller(e.target.value)} className={fieldClass}>
                  <option value="" disabled>
                    Select a company
                  </option>
                  {companyOptions.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className={`${labelClass} w-56`}>
                <span className={labelTextClass}>Buyer (receives the stock)</span>
                <select name="buyerCompanyId" required value={buyerCompanyId} onChange={(e) => setBuyerCompanyId(e.target.value)} className={fieldClass}>
                  <option value="" disabled>
                    Select a company
                  </option>
                  {/* The seller can't also be the buyer. */}
                  {companyOptions
                    .filter((c) => c.id !== sellerCompanyId)
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                </select>
              </label>
            </>
          )}
          <label className={`${labelClass} w-40`}>
            <span className={labelTextClass}>Date</span>
            <DateField name="documentDate" required defaultValue={defaults?.documentDate ?? todayISO()} className={fieldClass} />
          </label>
        </div>
        <div className="flex flex-wrap gap-3">
          <label className={`${labelClass} w-56`}>
            <span className={labelTextClass}>Ships from</span>
            <select name="fromLocationId" required defaultValue={defaults?.fromLocationId ?? ""} className={fieldClass}>
              <option value="" disabled>
                Select a location
              </option>
              {locationOptions.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </label>
          <label className={`${labelClass} w-56`}>
            <span className={labelTextClass}>Lands in</span>
            <select name="toLocationId" required defaultValue={defaults?.toLocationId ?? ""} className={fieldClass}>
              <option value="" disabled>
                Select a location
              </option>
              {locationOptions.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
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
                <th className={`${thClass} w-24`}>Qty</th>
                <th className={`${thClass} w-28`}>Rate</th>
                <th className={`${thClass} w-28 text-right`}>Total</th>
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
                      options={sellerItems}
                      placeholder="Item"
                      className={cellInput}
                      inputProps={{ "data-cell": `${r}-0` }}
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
                    <input
                      data-cell={`${r}-2`}
                      type="number"
                      min="0"
                      step="0.01"
                      placeholder="Qty"
                      value={line.quantity}
                      onChange={(e) => updateLine(r, { quantity: e.target.value })}
                      className={`${cellInput} text-right`}
                    />
                  </td>
                  <td className={tdClass}>
                    <input
                      data-cell={`${r}-3`}
                      type="number"
                      min="0"
                      step="0.1"
                      placeholder="Rate"
                      value={line.rate}
                      onChange={(e) => updateLine(r, { rate: e.target.value })}
                      className={`${cellInput} text-right`}
                    />
                  </td>
                  <td className="border border-sand px-2 text-right tabular-nums text-steel">
                    {line.quantity && line.rate ? ((Number(line.quantity) || 0) * (Number(line.rate) || 0)).toFixed(2) : ""}
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
        <div className="flex justify-end border-t border-sand pt-2 text-sm font-semibold text-ink">
          Total: {money(total)}
        </div>
      </div>

      <p className="text-sm text-steel">
        {isEdit
          ? "Saving rewrites both documents — the stock moved and the amounts owed end up matching what's on screen. Payments already recorded on either document stay as they are."
          : "Creates a sales invoice in the seller and a purchase invoice in the buyer, both unpaid — the seller is owed, the buyer owes. Settle either one from its own page."}
      </p>

      {state?.error && <p className={errorTextClass}>{state.error}</p>}
      {state?.success &&
        (isEdit ? (
          <p className={successTextClass}>Saved — both documents re-posted to match.</p>
        ) : (
          <p className={successTextClass}>
            Created{" "}
            <Link href={`/sales/${state.saleId}`} className="underline">
              {state.saleNumber}
            </Link>{" "}
            in the seller and{" "}
            <Link href="/purchases/stock" className="underline">
              {state.purchaseNumber}
            </Link>{" "}
            in the buyer. Form cleared for the next one.
          </p>
        ))}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="h-12 w-fit rounded bg-navy-800 px-6 text-base font-semibold text-white hover:bg-navy-700 disabled:opacity-40"
        >
          {pending ? (isEdit ? "Saving…" : "Creating…") : isEdit ? "Save Changes" : "Create Sale + Purchase"}
        </button>
        <button
          type="button"
          onClick={() => router.push("/inventory/inter-company")}
          className="h-12 rounded px-4 text-sm font-medium text-steel hover:bg-ivory"
        >
          Back to Inter-Company Sales
        </button>
      </div>
    </form>
  );
}
