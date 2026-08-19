"use client";

import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import { createStockPurchase, updateStockPurchase, deleteStockPurchase } from "@/lib/actions/purchases";
import { useNewEntry } from "@/components/layout/KeyboardShortcuts";
import type { SettlementType } from "@/lib/actions/settlement";
import { ComboBox } from "@/components/ui/ComboBox";
import { DateField } from "@/components/ui/DateField";
import { gridKeyDown, gridSelectionProps } from "@/components/ui/grid-keys";
import { landedUnitCost, money, perUnitShare, resolveAdjustment, round1, todayISO } from "@/lib/format";

import { fieldClass, labelClass, labelTextClass, errorTextClass, TRANSPORT_ERROR_MESSAGE } from "@/components/ui/form-styles";
import { inCompany } from "@/lib/contact-scope";
import { clearDraft } from "@/lib/draft";
import { useClientUserId } from "@/lib/client-user";
import { DraftBanner, useDraft } from "@/components/ui/useDraft";
import { calculateTax } from "@/lib/tax-calculation";
import { multiplierToBase, priceForUnit, type UnitConversionOption } from "@/lib/unit-conversion";

const sectionTitleClass = "text-sm font-semibold text-navy-800";
// Borderless input filling a table cell; the collapsed cell border is the line.
const cellInput = "h-9 w-full min-w-0 bg-transparent px-2 text-sm text-ink outline-none focus:bg-navy-800/5";
const thClass = "border border-sand px-2 py-1.5 text-left text-xs font-semibold uppercase tracking-wide text-steel";
const tdClass = "border border-sand p-0";

type Option = { id: string; name: string };
type ScopedOption = Option & { companyId: string };
type ItemOption = ScopedOption & { rate: string | null; salesRate: string | null; baseUnitId: string | null; taxable: boolean };
type TaxOption = { id: string; name: string; rate: string };
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
// One draft per form: only one purchase is ever being typed. The user id is
// appended at the call site (purchase:<uid>) so a shared browser never offers
// one user's half-typed purchase to another.
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
  taxId?: string | null;
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
  taxOptions,
  conversionOptions,
  taxSettings,
  purchaseId,
  defaults,
  onDone,
}: {
  companyOptions: Option[];
  supplierOptions: ScopedOption[];
  itemOptions: ItemOption[];
  documentTypeOptions: DocumentTypeOption[];
  locationOptions: (Option & { locationType?: string })[];
  unitOptions: Option[];
  bankAccountOptions: Option[];
  cashAccountOptions: Option[];
  chequeOptions: Option[];
  taxOptions: TaxOption[];
  conversionOptions: UnitConversionOption[];
  taxSettings: Record<string, Record<string, string>>;
  purchaseId?: string;
  defaults?: PurchaseDefaults;
  onDone: () => void;
}) {
  const isEdit = !!purchaseId;
  // The draft key is composed per render from the logged-in user — SessionSeed
  // (in the layout) sets the id before children render, so the first render
  // already carries the scoped key.
  const userId = useClientUserId();
  const purchaseDraftKey = userId ? `${PURCHASE_DRAFT_KEY}:${userId}` : PURCHASE_DRAFT_KEY;
  // One id per open form: sent with every submit, claimed by the server inside
  // the same transaction as the purchase, so a replayed submit can't post twice.
  const [operationId] = useState(() => crypto.randomUUID());
  // Wrapped so a transport failure (response lost after the server committed)
  // becomes an inline error instead of throwing into the error boundary — that
  // would lose the form and its operation id, and a restored draft would mint a
  // fresh id and post the purchase twice. The form survives; a replayed Save is
  // refused server-side as a duplicate.
  const [state, action, pending] = useActionState(
    async (prev: { error?: string; success?: boolean; id?: string } | undefined, formData: FormData) => {
      try {
        return isEdit ? await updateStockPurchase(purchaseId!, prev, formData) : await createStockPurchase(prev, formData);
      } catch {
        return { error: TRANSPORT_ERROR_MESSAGE };
      }
    },
    undefined,
  );
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
  const [taxId, setTaxId] = useState(() => defaults?.taxId ?? taxSettings[companyId]?.default_purchase_tax_id ?? "");
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
  // Goods almost always land at the shop, so that's what the field starts on —
  // same "first location of type shop" the sale form assumes outright.
  const shopLocation = locationOptions.find((l) => l.locationType === "shop");
  const [locationId, setLocationId] = useState(() => defaults?.locationId ?? shopLocation?.id ?? "");
  const [locationText, setLocationText] = useState(
    () => locationOptions.find((l) => l.id === (defaults?.locationId ?? shopLocation?.id))?.name ?? "",
  );

  // --- Draft ----------------------------------------------------------------
  // The same protection the sale form has, for the same reason: a purchase is a
  // lot of typing, and the thing that loses it is a render that throws after the
  // save (a database blip on the reload), not the save itself. See lib/draft.ts
  // and components/ui/useDraft.tsx — the hook owns the store read, the
  // offer/restore/discard logic and the save-on-change effect.
  //
  // New purchases only — restoring a stale copy over a saved one would overwrite
  // whatever someone else had corrected.
  const draftState = { lines, companyId, contactId, supplierText, locationId, locationText, discountTotal, taxId, shippingTotal, isPaid, settlementType };
  type PurchaseDraft = typeof draftState;

  const { offerDraft, restore: restoreDraft, discard: discardDraft } = useDraft<PurchaseDraft>(purchaseDraftKey, {
    state: draftState,
    enabled: !isEdit,
    hasContent: (d) => d.lines.some((l) => l.itemText?.trim() || l.quantity?.trim()),
    apply: (d) => {
      setLines(d.lines);
      setCompanyId(d.companyId);
      setContactId(d.contactId);
      setSupplierText(d.supplierText);
      setLocationId(d.locationId);
      setLocationText(d.locationText);
      setDiscountTotal(d.discountTotal);
      setTaxId(d.taxId);
      setShippingTotal(d.shippingTotal);
      setIsPaid(d.isPaid);
      setSettlementType(d.settlementType);
    },
  });

  // A delivery usually arrives as a stack of invoices, and closing the popup
  // between them costs a click, a reopen and the scroll back down to the grid.
  // Next Purchase saves and empties the form instead, so the next one is typed
  // straight into the popup that's already open.
  //
  // A ref, not state: it's read once by the effect that runs after the save and
  // must not be part of what re-renders the grid mid-typing.
  const startNext = useRef(false);
  const nextButtonRef = useRef<HTMLButtonElement>(null);

  // Alt+N from inside the popup is the button — clicked rather than submitted
  // directly, so the browser runs the same required-field checks it would on a
  // real press, and so there is one path to keep working.
  useNewEntry(() => {
    if (!isEdit && !pending) nextButtonRef.current?.click();
  }, true);

  const formRef = useRef<HTMLFormElement>(null);

  // The emptying itself, with nothing asked. Clear asks first because it throws
  // away work; Next Purchase doesn't, because the work is already saved.
  //
  // Declared above the effect that calls it, not below with the rest of the form
  // handlers: hoisting would run either way, but the lint rule won't read a
  // binding declared later in the component body.
  function resetForm() {
    // Cleared on purpose, so the draft goes with it rather than being offered
    // back on the next visit.
    clearDraft(purchaseDraftKey);
    setLines([emptyLine()]);
    setContactId("");
    setSupplierText("");
    setLocationId(shopLocation?.id ?? "");
    setLocationText(shopLocation?.name ?? "");
    setDiscountTotal("0");
    setTaxId(taxSettings[companyId]?.default_purchase_tax_id ?? "");
    setShippingTotal("0");
    setIsPaid("no");
    setSettlementType("account");
    // Resets what isn't controlled state — the date back to today, the settlement
    // select, and the manual document number. Company is controlled, so it stays.
    formRef.current?.reset();
  }

  useEffect(() => {
    if (!state?.success) return;
    // Saved — the local copy has nothing left to protect.
    clearDraft(purchaseDraftKey);
    if (startNext.current) {
      startNext.current = false;
      // The list behind the popup still has to learn about what was just saved;
      // that's the half of onDone() worth keeping when the popup stays open.
      resetForm();
      return;
    }
    onDone();
    // `state`, not `state.success`: a second save leaves the flag at true, so
    // keying off the flag alone would fire once and never again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

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
    if (!isEdit) setTaxId(taxSettings[next]?.default_purchase_tax_id ?? "");
    if (contactId && !supplierOpts.some((s) => s.id === contactId && inCompany(next)(s))) {
      setContactId("");
      setSupplierText("");
    }
    setLines((prev) => prev.map((l) => (l.itemId && !itemOpts.some((it) => it.id === l.itemId && it.companyId === next) ? { ...l, itemId: "" } : l)));
  }

  // Excel-style arrows across the line grid, plus Delete to empty a cell. Ctrl+Enter
  // is not passed here on purpose: this is a real <form>, so the app-wide handler
  // in KeyboardShortcuts already submits it, and handling it twice would submit twice.
  const gridRef = useRef<HTMLTableSectionElement>(null);

  // Empties the form for a fresh purchase — the same idea as the sale form's
  // Clear. Confirms only when there's something to lose, and is offered on new
  // purchases only: on an existing one it would wipe what was loaded from the
  // database and leave the edit form pointing at nothing.
  function clearForm() {
    const started = lines.some((l) => l.itemText.trim() || l.itemId) || supplierText.trim();
    if (started && !confirm("Clear this purchase and start over?")) return;
    resetForm();
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

  function pickItem(i: number, name: string) {
    const item = visibleItems.find((option) => option.name === name);
    updateLine(i, {
      itemText: name,
      itemId: item?.id ?? "",
      unitId: item?.baseUnitId ?? "",
      unitText: unitOpts.find((unit) => unit.id === item?.baseUnitId)?.name ?? "",
      unitPrice: item ? priceForUnit(item.rate, 1) : "",
    });
  }

  function pickUnit(i: number, name: string) {
    const unitId = unitOpts.find((unit) => unit.name === name)?.id ?? "";
    const line = lines[i];
    const item = itemOpts.find((option) => option.id === line.itemId);
    const multiplier = item ? multiplierToBase(item.id, unitId, item.baseUnitId, conversionOptions) : 1;
    updateLine(i, { unitText: name, unitId, unitPrice: item ? priceForUnit(item.rate, multiplier) : line.unitPrice });
  }

  const subtotal = round1(lines.reduce((sum, l) => sum + (Number(l.quantity) || 0) * (Number(l.unitPrice) || 0), 0));
  // "500" is five hundred rupees, "5%" is five percent of the subtotal — one
  // box, no Rs/% selector beside it. Same rule as the sale form.
  const discountAmount = resolveAdjustment(discountTotal, subtotal);
  const selectedTax = taxOptions.find((tax) => tax.id === taxId);
  const taxInclusive = taxSettings[companyId]?.tax_prices_include_tax === "true";
  const taxCalculation = calculateTax(
    lines.map((line) => ({
      lineTotal: (Number(line.quantity) || 0) * (Number(line.unitPrice) || 0),
      taxable: itemOpts.find((item) => item.id === line.itemId)?.taxable ?? false,
    })),
    discountAmount,
    Number(shippingTotal) || 0,
    Number(selectedTax?.rate ?? 0),
    taxInclusive,
  );
  const taxAmount = taxCalculation.taxTotal;
  const grandTotal = taxCalculation.grandTotal;

  // Shipping, discount and tax are charged on the delivery, not on any one line
  // of it, so what a piece actually cost landed is its price plus its share of
  // all three — spread over every unit that came in the same load, with the
  // signs the grand total uses. Spread this way the column adds up:
  // sum(unit cost x qty) is the grand total.
  //
  // unitPrice is still what the line saves as: it's what the supplier billed and
  // what the payable is settled against. The landed figure rides along in
  // unit_cost, for the rate list to quote the next sale from.
  const totalQty = lines.reduce((sum, l) => sum + (Number(l.quantity) || 0), 0);
  const adjustmentPerUnit = perUnitShare(
    (Number(shippingTotal) || 0) - discountAmount + (taxInclusive ? 0 : taxAmount),
    totalQty,
  );

  return (
    <>
    <form ref={formRef} action={action} className="flex flex-col gap-5">
      <input type="hidden" name="operationId" value={operationId} />
      <input
        type="hidden"
        name="linesJson"
        value={JSON.stringify(
          lines.map((l) => ({
            ...l,
            itemName: l.itemText,
            unitName: l.unitText,
            // The landed cost shown in the grid, saved as the line's unit_cost —
            // it's what rate_list reports as "what we last paid", so a sale
            // priced off it is priced above what the goods actually cost.
            // (This used to send quantity x price: a line total under a
            // per-unit name. drizzle/0049 rebuilt the rows it wrote.)
            unitCost: Number(l.quantity) > 0 ? String(landedUnitCost(Number(l.unitPrice) || 0, adjustmentPerUnit)) : "",
          })),
        )}
      />

      {/* An unfinished purchase from before — a crash, a closed tab, a reload.
          Offered, never applied on its own: silently refilling the grid would
          have someone post a delivery they thought they had typed fresh. */}
      {offerDraft && <DraftBanner noun="purchase" onRestore={restoreDraft} onDiscard={discardDraft} />}

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
          <table className="w-full min-w-[1060px] border-collapse text-sm">
            <thead>
              <tr>
                <th className={`${thClass} w-10 text-right`}>#</th>
                <th className={`${thClass} min-w-[280px]`}>Item</th>
                <th className={`${thClass} w-32`}>Unit</th>
                <th className={`${thClass} w-24`}>Qty</th>
                <th className={`${thClass} w-28`}>Unit Price</th>
                <th className={`${thClass} w-28 text-right`} title="Unit price plus this unit's share of the shipping">
                  Unit Cost
                </th>
                <th className={`${thClass} w-28 text-right`}>Total</th>
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
                      // data-shortcut="i" marks the first line's item box so
                      // Alt+I can jump to it from anywhere in this popup — the
                      // purchase popup's jumps are Alt, not Ctrl.
                      inputProps={i === 0 ? { "data-shortcut": "i" } : undefined}
                      onChange={(name) => pickItem(i, name)}
                    />
                  </td>
                  <td className={tdClass}>
                    <ComboBox
                      value={line.unitText}
                      options={unitOpts}
                      placeholder="Unit"
                      className={cellInput}
                      onChange={(name) => pickUnit(i, name)}
                    />
                  </td>
                  <td className={tdClass}>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
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
                      step="0.1"
                      value={line.unitPrice}
                      onChange={(e) => updateLine(i, { unitPrice: e.target.value })}
                      placeholder="Rate"
                      className={`${cellInput} text-right`}
                    />
                  </td>
                  {/* Blank rather than a shipping-only figure on an empty row —
                      a line with no quantity bought nothing to carry. */}
                  <td className="border border-sand px-2 text-right tabular-nums text-steel">
                    {Number(line.quantity) > 0 ? money(landedUnitCost(Number(line.unitPrice) || 0, adjustmentPerUnit)) : ""}
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
              data-shortcut="d"
              value={discountTotal}
              onChange={(e) => setDiscountTotal(e.target.value)}
              className={fieldClass}
            />
            <input type="hidden" name="discountTotal" value={discountAmount.toFixed(1)} />
          </label>
          <label className={`${labelClass} w-56`}>
            <span className={labelTextClass}>Tax</span>
            <select name="taxId" data-shortcut="t" value={taxId} onChange={(event) => setTaxId(event.target.value)} className={fieldClass}>
              <option value="">No tax</option>
              {taxOptions.map((tax) => <option key={tax.id} value={tax.id}>{tax.name} ({tax.rate}%)</option>)}
            </select>
            {selectedTax && <span className="text-xs text-steel">{taxInclusive ? "Included in taxable prices" : "Added to taxable products"}</span>}
          </label>
          <label className={`${labelClass} w-40`}>
            <span className={labelTextClass}>Shipping Total</span>
            <input
              name="shippingTotal"
              type="number"
              min="0"
              step="0.1"
              data-shortcut="s"
              value={shippingTotal}
              onChange={(e) => setShippingTotal(e.target.value)}
              className={`${fieldClass}`}
            />
            {/* Freight is money out the moment the goods arrive: it's recorded
                as a paid expense from the default cash account, not added to
                what the supplier is owed — so this purchase shows Partial Paid
                and the payable below it is the total minus this. */}
            <span className="mt-1 block text-xs leading-snug text-steel">
              Paid on arrival from the default cash account — it isn&apos;t part of what you owe the supplier.
            </span>
          </label>
        </div>
        <div className="flex flex-col items-end gap-0.5 border-t border-sand pt-2 text-sm text-ink">
          <span>Subtotal: {money(subtotal)}</span>
          {discountAmount > 0 && <span className="text-steel">Discount: -{money(discountAmount)}</span>}
          {taxAmount > 0 && <span className="text-steel">Tax{taxInclusive ? " (included)" : ""}: {taxInclusive ? "" : "+"}{money(taxAmount)}</span>}
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
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="h-12 w-fit rounded bg-navy-800 px-6 text-base font-semibold text-white hover:bg-navy-700 disabled:opacity-40"
        >
          {pending ? (isEdit ? "Saving…" : "Creating…") : isEdit ? "Save" : "Create Purchase"}
        </button>
        {/* Both are submit buttons on the same form — the only difference is the
            flag set on the way down, which the save effect reads to decide
            whether the popup closes or empties. */}
        {!isEdit && (
          <button
            ref={nextButtonRef}
            type="submit"
            disabled={pending}
            onClick={() => {
              startNext.current = true;
            }}
            title="Save this purchase and start the next one without closing (Alt+N)"
            className="h-12 w-fit rounded border border-navy-800 px-6 text-base font-semibold text-navy-800 hover:bg-ivory disabled:opacity-40"
          >
            Next Purchase
          </button>
        )}
      </div>
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
        if (!confirm("Cancel this purchase? Its history will remain and its stock and accounting effects will be reversed.")) e.preventDefault();
      }}
    >
      <input type="hidden" name="documentId" value={purchaseId} />
      <button type="submit" disabled={pending} className="text-sm font-medium text-error hover:underline disabled:opacity-40">
        {pending ? "Cancelling…" : "Cancel this purchase"}
      </button>
      {state?.error && <p className={`mt-2 ${errorTextClass}`}>{state.error}</p>}
    </form>
  );
}
