"use client";

import { useActionState, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { createStockPurchase, updateStockPurchase, deleteStockPurchase } from "@/lib/actions/purchases";
import type { SettlementType } from "@/lib/actions/settlement";
import { ComboBox } from "@/components/ui/ComboBox";
import { DateField } from "@/components/ui/DateField";
import { gridKeyDown, gridSelectionProps } from "@/components/ui/grid-keys";
import { money, resolveAdjustment, round1, todayISO } from "@/lib/format";

import { fieldClass, labelClass, labelTextClass, errorTextClass } from "@/components/ui/form-styles";
import { inCompany } from "@/lib/contact-scope";
import { clearDraft, draftSnapshot, noDraft, saveDraft, subscribeDraft } from "@/lib/draft";

const sectionTitleClass = "text-sm font-semibold text-navy-800";
// Borderless input filling a table cell; the collapsed cell border is the line.
const cellInput = "h-9 w-full min-w-0 bg-transparent px-2 text-sm text-ink outline-none focus:bg-navy-800/5";
const thClass = "border border-sand px-2 py-1.5 text-left text-xs font-semibold uppercase tracking-wide text-steel";
const tdClass = "border border-sand p-0";

type Option = { id: string; name: string };
type ScopedOption = Option & { companyId: string };
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
type Line = {
  itemId: string;
  itemText: string;
  unitId: string;
  unitText: string;
  quantity: string;
  unitPrice: string;
  unitCost: string;
};

// Quantity and price start empty, not at 1 and 0. A pre-filled number reads as
// entered data — a row left at "1 × 0" looks typed rather than skipped — and it
// has to be selected and overwritten on every line. Blank shows a placeholder
// and, since a line only counts once its quantity is above zero, a spare row
// left untouched is simply ignored on save.
// One draft per form: only one purchase is ever being typed.
const PURCHASE_DRAFT_KEY = "purchase";

const emptyLine = (): Line => ({ itemId: "", itemText: "", unitId: "", unitText: "", quantity: "", unitPrice: "", unitCost: "" });

const SETTLEMENT_TYPES: { value: SettlementType; label: string }[] = [
  { value: "account", label: "Account" },
  { value: "cash", label: "Cash" },
  { value: "cheque", label: "Cheque" },
];

type PurchaseDefaults = {
  companyId: string;
  contactId: string | null;
  documentDate: string;
  discountTotal: string;
  taxTotal: string;
  shippingTotal: string;
  isPaid: boolean;
  bankAccountId: string | null;
  cashAccountId: string | null;
  chequeId: string | null;
  settlementType: SettlementType | null;
  // The one location the whole delivery arrived at.
  locationId: string;
  // The saved lines carry ids; the combobox text for each is looked up from the
  // option lists on load.
  lines: Omit<Line, "itemText" | "unitText">[];
};

export function StockPurchaseCreateForm({
  companyOptions,
  supplierOptions,
  itemOptions,
  documentTypeOptions,
  locationOptions,
  unitOptions,
  bankAccountOptions,
  cashAccountOptions,
  chequeOptions,
  purchaseId,
  defaults,
  onDone,
}: {
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
  purchaseId?: string;
  defaults?: PurchaseDefaults;
  onDone: () => void;
}) {
  const isEdit = !!purchaseId;
  const [state, action, pending] = useActionState(isEdit ? updateStockPurchase.bind(null, purchaseId!) : createStockPurchase, undefined);
  // The saved lines plus one blank row: the grid only grows when its last row is
  // edited, and on an existing purchase every row is already filled — so without
  // the spare there is nowhere to add an item.
  const [lines, setLines] = useState<Line[]>(() => [
    ...(defaults?.lines.map((l) => ({
      ...l,
      itemText: itemOptions.find((it) => it.id === l.itemId)?.name ?? "",
      unitText: unitOptions.find((u) => u.id === l.unitId)?.name ?? "",
    })) ?? []),
    emptyLine(),
  ]);
  const [companyId, setCompanyId] = useState(
    () => defaults?.companyId ?? companyOptions.find((c) => c.name === "Royal Hardware")?.id ?? "",
  );
  const [discountTotal, setDiscountTotal] = useState(() => defaults?.discountTotal ?? "0");
  const [taxTotal, setTaxTotal] = useState(() => defaults?.taxTotal ?? "0");
  const [shippingTotal, setShippingTotal] = useState(() => defaults?.shippingTotal ?? "0");
  const [contactId, setContactId] = useState(() => defaults?.contactId ?? "");
  const [supplierText, setSupplierText] = useState(() => supplierOptions.find((s) => s.id === defaults?.contactId)?.name ?? "");
  const [isPaid, setIsPaid] = useState<"yes" | "no">(() => (defaults?.isPaid ? "yes" : "no"));
  const [settlementType, setSettlementType] = useState<SettlementType>(defaults?.settlementType ?? "account");
  const settlementOptions = settlementType === "account" ? bankAccountOptions : settlementType === "cash" ? cashAccountOptions : chequeOptions;
  const settlementFieldName = settlementType === "account" ? "bankAccountId" : settlementType === "cash" ? "cashAccountId" : "chequeId";
  const settlementDefault =
    settlementType === "account" ? defaults?.bankAccountId : settlementType === "cash" ? defaults?.cashAccountId : defaults?.chequeId;
  const itemOpts = itemOptions;
  const unitOpts = unitOptions;
  const supplierOpts = supplierOptions;
  const locationOpts = locationOptions;
  // One delivery arrives in one place, so this is a header field rather than a
  // column repeated down every line.
  const [locationId, setLocationId] = useState(() => defaults?.locationId ?? "");
  const [locationText, setLocationText] = useState(() => locationOptions.find((l) => l.id === defaults?.locationId)?.name ?? "");

  // --- Draft ----------------------------------------------------------------
  // The same protection the sale form has, for the same reason: a purchase is a
  // lot of typing, and the thing that loses it is a render that throws after the
  // save (a database blip on the reload), not the save itself. See lib/draft.ts.
  //
  // New purchases only — restoring a stale copy over a saved one would overwrite
  // whatever someone else had corrected.
  const draftState = { lines, companyId, contactId, supplierText, locationId, locationText, discountTotal, taxTotal, shippingTotal, isPaid, settlementType };
  type PurchaseDraft = typeof draftState;

  const savedDraft = useSyncExternalStore(subscribeDraft, () => draftSnapshot<PurchaseDraft>(PURCHASE_DRAFT_KEY), noDraft);
  const [dismissed, setDismissed] = useState(false);
  const offerDraft = !isEdit && !dismissed && !!savedDraft?.lines?.some((l) => l.itemText?.trim() || l.quantity?.trim());

  function restoreDraft() {
    if (!savedDraft) return;
    setLines(savedDraft.lines);
    setCompanyId(savedDraft.companyId);
    setContactId(savedDraft.contactId);
    setSupplierText(savedDraft.supplierText);
    setLocationId(savedDraft.locationId);
    setLocationText(savedDraft.locationText);
    setDiscountTotal(savedDraft.discountTotal);
    setTaxTotal(savedDraft.taxTotal);
    setShippingTotal(savedDraft.shippingTotal);
    setIsPaid(savedDraft.isPaid);
    setSettlementType(savedDraft.settlementType);
    setDismissed(true);
  }

  useEffect(() => {
    if (isEdit) return;
    saveDraft(PURCHASE_DRAFT_KEY, draftState);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines, companyId, contactId, supplierText, locationId, locationText, discountTotal, taxTotal, shippingTotal, isPaid, settlementType, isEdit]);

  useEffect(() => {
    if (!state?.success) return;
    // Saved — the local copy has nothing left to protect.
    clearDraft(PURCHASE_DRAFT_KEY);
    onDone();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.success]);

  const purchaseInvoiceType = useMemo(
    () => documentTypeOptions.find((dt) => dt.companyId === companyId && dt.code === "PURCHASE_INVOICE"),
    [documentTypeOptions, companyId],
  );

  // Suppliers and items belong to one company; a purchase must not mix companies.
  // The dropdowns show only the selected company's rows, not everything in the
  // Topbar scope.
  // Plus the global suppliers — a contact with no company is visible to every one.
  const visibleSuppliers = useMemo(() => supplierOpts.filter(inCompany(companyId)), [supplierOpts, companyId]);
  const visibleItems = useMemo(() => itemOpts.filter((it) => it.companyId === companyId), [itemOpts, companyId]);

  // Switching company drops any supplier/line item that belonged to the old one,
  // so a stale id can't be submitted against the new company. Done on change (not
  // in an effect) — the reset is a response to the user's action, not a sync.
  function changeCompany(next: string) {
    setCompanyId(next);
    if (contactId && !supplierOpts.some((s) => s.id === contactId && inCompany(next)(s))) {
      setContactId("");
      setSupplierText("");
    }
    setLines((prev) => prev.map((l) => (l.itemId && !itemOpts.some((it) => it.id === l.itemId && it.companyId === next) ? { ...l, itemId: "" } : l)));
  }

  // Empties the form for a fresh purchase — the same idea as the sale form's
  // Clear. Confirms only when there's something to lose, and is offered on new
  // purchases only: on an existing one it would wipe what was loaded from the
  // database and leave the edit form pointing at nothing.
  const formRef = useRef<HTMLFormElement>(null);
  // Excel-style arrows across the line grid, plus Delete to empty a cell. Ctrl+Enter
  // is not passed here on purpose: this is a real <form>, so the app-wide handler
  // in KeyboardShortcuts already submits it, and handling it twice would submit twice.
  const gridRef = useRef<HTMLTableSectionElement>(null);
  function clearForm() {
    const started = lines.some((l) => l.itemText.trim() || l.itemId) || supplierText.trim();
    if (started && !confirm("Clear this purchase and start over?")) return;
    // Cleared on purpose, so the draft goes with it rather than being offered
    // back on the next visit.
    clearDraft(PURCHASE_DRAFT_KEY);
    setLines([emptyLine()]);
    setContactId("");
    setSupplierText("");
    setLocationId("");
    setLocationText("");
    setDiscountTotal("0");
    setTaxTotal("0");
    setShippingTotal("0");
    setIsPaid("no");
    setSettlementType("account");
    // Resets what isn't controlled state — the date back to today, the settlement
    // select, and the manual document number. Company is controlled, so it stays.
    formRef.current?.reset();
  }

  // Editing the last row grows the grid, so there is always one spare row below
  // the one being typed into — that's what the "+ Add item" button was for.
  // Trailing blank rows cost nothing: the server drops any line with no item or
  // no quantity.
  function updateLine(i: number, patch: Partial<Line>) {
    setLines((prev) => {
      const next = prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l));
      if (i !== prev.length - 1) return next;
      // The appended row is blank; the server drops any line with no item or no
      // quantity, so a trailing spare costs nothing.
      return [...next, emptyLine()];
    });
  }

  const subtotal = round1(lines.reduce((sum, l) => sum + (Number(l.quantity) || 0) * (Number(l.unitPrice) || 0), 0));
  // "500" is five hundred rupees, "5%" is five percent of the subtotal — one
  // box, no Rs/% selector beside it. Same rule as the sale form.
  const discountAmount = resolveAdjustment(discountTotal, subtotal);
  const taxAmount = resolveAdjustment(taxTotal, subtotal);
  const grandTotal = round1(subtotal - discountAmount + taxAmount + (Number(shippingTotal) || 0));

  return (
    <>
    <form ref={formRef} action={action} className="flex flex-col gap-5">
      <input
        type="hidden"
        name="linesJson"
        value={JSON.stringify(
          lines.map((l) => ({
            ...l,
            itemName: l.itemText,
            unitName: l.unitText,
            unitCost: String((Number(l.quantity) || 0) * (Number(l.unitPrice) || 0)),
          })),
        )}
      />

      {/* An unfinished purchase from before — a crash, a closed tab, a reload.
          Offered, never applied on its own: silently refilling the grid would
          have someone post a delivery they thought they had typed fresh. */}
      {offerDraft && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded border border-brass-600 bg-brass-100 px-3 py-2 text-sm text-ink">
          <span>You have an unsaved purchase from earlier.</span>
          <span className="flex items-center gap-3">
            <button type="button" onClick={restoreDraft} className="font-semibold text-navy-800 hover:underline">
              Restore it
            </button>
            <button
              type="button"
              onClick={() => {
                clearDraft(PURCHASE_DRAFT_KEY);
                setDismissed(true);
              }}
              className="text-steel hover:underline"
            >
              Discard
            </button>
          </span>
        </div>
      )}

      {/* --- documents header. Clear sits on the section heading's own line
          rather than in a strip of its own above it. --- */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-4">
          <span className={sectionTitleClass}>Document</span>
          {!isEdit && (
            <button
              type="button"
              onClick={clearForm}
              className="h-9 rounded border border-sand px-4 text-sm font-medium text-steel hover:bg-ivory hover:text-navy-800"
            >
              Clear
            </button>
          )}
        </div>
        <div className="flex flex-wrap gap-3">
          <label className={`${labelClass} w-56`}>
            <span className={labelTextClass}>Company</span>
            <select
              name="companyId"
              required
              value={companyId}
              onChange={(e) => changeCompany(e.target.value)}
              className={fieldClass}
            >
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
          <label className={`${labelClass} w-56`}>
            <span className={labelTextClass}>Supplier</span>
            <ComboBox
              value={supplierText}
              options={visibleSuppliers}
              placeholder="Pick a supplier or type a new one"
              className={fieldClass}
              inputProps={{ required: true }}
              onChange={(name) => {
                setSupplierText(name);
                setContactId(visibleSuppliers.find((s) => s.name === name)?.id ?? "");
              }}
            />
            <input type="hidden" name="contactId" value={contactId} />
            <input type="hidden" name="contactName" value={supplierText} />
          </label>
          <label className={`${labelClass} w-40`}>
            <span className={labelTextClass}>Document Date</span>
            <DateField name="documentDate" required defaultValue={defaults?.documentDate ?? todayISO()} className={fieldClass} />
          </label>
          <label className={`${labelClass} w-56`}>
            <span className={labelTextClass}>Location</span>
            {/* One delivery arrives in one place, so this sits with the supplier
                and the date rather than repeating down every line. Typed like the
                item and unit: an unmatched name creates the location on save, so
                a new warehouse doesn't mean leaving the purchase to go make one
                first. */}
            <ComboBox
              value={locationText}
              options={locationOpts}
              placeholder="Where the goods arrived"
              className={fieldClass}
              onChange={(name) => {
                setLocationText(name);
                setLocationId(locationOpts.find((l) => l.name === name)?.id ?? "");
              }}
            />
            <input type="hidden" name="locationId" value={locationId} />
            <input type="hidden" name="locationName" value={locationText} />
          </label>
          {/* The numbers being watched while lines are typed, and the totals
              block is below the fold on a long purchase — so they're repeated here
              at the end of the header row, styled exactly as they are down
              there. Same as the sale form. */}
          <div className="ml-auto flex flex-col items-end justify-end gap-0.5 text-sm text-ink">
            <span>Subtotal: {money(subtotal)}</span>
            <span className="font-semibold">Grand Total: {money(grandTotal)}</span>
          </div>
        </div>
      </div>

      {/* --- document_types: always Purchase Invoice, no UI --- */}
      {purchaseInvoiceType ? (
        <>
          <input type="hidden" name="documentTypeMode" value="existing" />
          <input type="hidden" name="documentTypeId" value={purchaseInvoiceType.id} />
        </>
      ) : (
        <>
          <input type="hidden" name="documentTypeMode" value="new" />
          <input type="hidden" name="dtCode" value="PURCHASE_INVOICE" />
          <input type="hidden" name="dtName" value="Purchase Invoice" />
          <input type="hidden" name="dtSeries" value="PI" />
          <input type="hidden" name="dtAffectsInventory" value="on" />
          <input type="hidden" name="dtAffectsPayable" value="on" />
          <input type="hidden" name="dtActive" value="on" />
        </>
      )}

      {/* --- document_lines: single-row grid with shared borders --- */}
      <div className="flex flex-col gap-2">
        <span className={sectionTitleClass}>Items</span>
        <div className="overflow-x-auto rounded border border-sand">
          <table className="w-full min-w-[960px] border-collapse text-sm">
            <thead>
              <tr>
                <th className={`${thClass} w-10 text-right`}>#</th>
                <th className={`${thClass} min-w-[280px]`}>Item</th>
                <th className={`${thClass} w-32`}>Unit</th>
                <th className={`${thClass} w-24`}>Qty</th>
                <th className={`${thClass} w-28`}>Unit Price</th>
                <th className={`${thClass} w-28 text-right`}>Cost</th>
                <th className="w-8 border border-sand" />
              </tr>
            </thead>
            <tbody ref={gridRef} {...gridSelectionProps} onKeyDown={(e) => gridKeyDown(e, gridRef)}>
              {lines.map((line, i) => (
                <tr key={i}>
                  <td className="border border-sand px-2 text-right text-xs tabular-nums text-steel">{i + 1}</td>
                  <td className={tdClass}>
                    <ComboBox
                      value={line.itemText}
                      options={visibleItems}
                      placeholder="Item"
                      className={cellInput}
                      onChange={(name) => updateLine(i, { itemText: name, itemId: visibleItems.find((it) => it.name === name)?.id ?? "" })}
                    />
                  </td>
                  <td className={tdClass}>
                    <ComboBox
                      value={line.unitText}
                      options={unitOpts}
                      placeholder="Unit"
                      className={cellInput}
                      onChange={(name) => updateLine(i, { unitText: name, unitId: unitOpts.find((u) => u.name === name)?.id ?? "" })}
                    />
                  </td>
                  <td className={tdClass}>
                    <input
                      type="number"
                      min="0"
                      step="0.001"
                      value={line.quantity}
                      onChange={(e) => updateLine(i, { quantity: e.target.value })}
                      placeholder="Qty"
                      className={`${cellInput} text-right`}
                    />
                  </td>
                  <td className={tdClass}>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={line.unitPrice}
                      onChange={(e) => updateLine(i, { unitPrice: e.target.value })}
                      placeholder="Rate"
                      className={`${cellInput} text-right`}
                    />
                  </td>
                  <td className="border border-sand px-2 text-right tabular-nums text-steel">
                    {money((Number(line.quantity) || 0) * (Number(line.unitPrice) || 0))}
                  </td>
                  <td className="border border-sand text-center">
                    <button
                      type="button"
                      onClick={() => setLines((prev) => (prev.length > 1 ? prev.filter((_, idx) => idx !== i) : prev))}
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

      {/* --- totals: discount/tax/shipping applied after items, grand total last --- */}
      <div className="flex flex-col gap-3 rounded border border-sand p-3">
        <span className={sectionTitleClass}>Totals</span>
        <div className="flex flex-wrap gap-3">
          {/* Text, not number: "5%" has to be typeable. The hidden field still
              carries the resolved amount, which is all the server ever saw. */}
          <label className={`${labelClass} w-40`}>
            <span className={labelTextClass}>Discount</span>
            <input
              type="text"
              inputMode="decimal"
              placeholder="0 or 5%"
              value={discountTotal}
              onChange={(e) => setDiscountTotal(e.target.value)}
              className={fieldClass}
            />
            <input type="hidden" name="discountTotal" value={discountAmount.toFixed(1)} />
          </label>
          <label className={`${labelClass} w-40`}>
            <span className={labelTextClass}>Tax</span>
            <input
              type="text"
              inputMode="decimal"
              placeholder="0 or 5%"
              value={taxTotal}
              onChange={(e) => setTaxTotal(e.target.value)}
              className={fieldClass}
            />
            <input type="hidden" name="taxTotal" value={taxAmount.toFixed(1)} />
          </label>
          <label className={`${labelClass} w-40`}>
            <span className={labelTextClass}>Shipping Total</span>
            <input
              name="shippingTotal"
              type="number"
              min="0"
              step="0.1"
              value={shippingTotal}
              onChange={(e) => setShippingTotal(e.target.value)}
              className={`${fieldClass}`}
            />
          </label>
        </div>
        <div className="flex flex-col items-end gap-0.5 border-t border-sand pt-2 text-sm text-ink">
          <span>Subtotal: {money(subtotal)}</span>
          {discountAmount > 0 && <span className="text-steel">Discount: -{money(discountAmount)}</span>}
          {taxAmount > 0 && <span className="text-steel">Tax: +{money(taxAmount)}</span>}
          <span className="font-semibold">Grand Total: {money(grandTotal)}</span>
        </div>
      </div>

      <label className={`${labelClass} w-40`}>
        <span className={labelTextClass}>Paid?</span>
        <select name="isPaid" value={isPaid} onChange={(e) => setIsPaid(e.target.value as "yes" | "no")} className={fieldClass}>
          <option value="no">No — add to payables</option>
          <option value="yes">Yes</option>
        </select>
      </label>

      {isPaid === "yes" && (
        <div className="flex flex-col gap-3 rounded border border-sand p-3">
          <span className={sectionTitleClass}>Payment</span>
          <div className={`${labelClass} w-72`}>
            <span className={labelTextClass}>Settle via</span>
            <div className="flex gap-2">
              {SETTLEMENT_TYPES.map((t) => (
                <button
                  key={t.value}
                  type="button"
                  onClick={() => setSettlementType(t.value)}
                  className={`h-11 flex-1 rounded border text-sm font-semibold ${
                    settlementType === t.value ? "border-navy-800 bg-navy-800 text-white" : "border-sand text-steel hover:bg-ivory"
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>
          <input type="hidden" name="settlementType" value={settlementType} />
          <label className={`${labelClass} w-56`}>
            <span className={labelTextClass}>{settlementType === "account" ? "Account" : settlementType === "cash" ? "Cash Account" : "Cheque"}</span>
            <select key={settlementType} name={settlementFieldName} required defaultValue={settlementDefault ?? ""} className={fieldClass}>
              <option value="" disabled>
                {settlementOptions.length === 0 ? "None available — create one first" : "Select"}
              </option>
              {settlementOptions.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}

      {state?.error && <p className={errorTextClass}>{state.error}</p>}
      <button
        type="submit"
        disabled={pending}
        className="h-12 w-fit rounded bg-navy-800 px-6 text-base font-semibold text-white hover:bg-navy-700 disabled:opacity-40"
      >
        {pending ? (isEdit ? "Saving…" : "Creating…") : isEdit ? "Save" : "Create Purchase"}
      </button>
    </form>

    </>
  );
}

export function DeleteStockPurchaseButton({ purchaseId, onDone }: { purchaseId: string; onDone?: () => void }) {
  const [state, action, pending] = useActionState(deleteStockPurchase, undefined);

  useEffect(() => {
    if (state?.success) onDone?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.success]);

  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (!confirm("Delete this purchase? This removes its line items too.")) e.preventDefault();
      }}
    >
      <input type="hidden" name="documentId" value={purchaseId} />
      <button type="submit" disabled={pending} className="text-sm font-medium text-error hover:underline disabled:opacity-40">
        {pending ? "Deleting…" : "Delete this purchase"}
      </button>
      {state?.error && <p className={`mt-2 ${errorTextClass}`}>{state.error}</p>}
    </form>
  );
}
