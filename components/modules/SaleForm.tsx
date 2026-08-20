"use client";

import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createSale, updateSale, deleteSale, getCustomerOutstanding } from "@/lib/actions/sales";
import type { SettlementType } from "@/lib/actions/settlement";
import { fieldClass, labelClass, labelTextClass, errorTextClass, successTextClass } from "@/components/ui/form-styles";
import { ComboBox } from "@/components/ui/ComboBox";
import { DateField } from "@/components/ui/DateField";
import { gridKeyDown, gridSelectionProps } from "@/components/ui/grid-keys";
import { money, resolveAdjustment, round1, todayISO } from "@/lib/format";
import { DEFAULT_SALE_TYPE, SALE_TYPES, type SaleType } from "@/lib/sale-constants";
import { inCompany } from "@/lib/contact-scope";
import { clearDraft } from "@/lib/draft";
import { DraftBanner, useDraft } from "@/components/ui/useDraft";

const sectionTitleClass = "text-sm font-semibold text-navy-800";
// Borderless input that fills its table cell; the cell border is the only line.
const cellInput = "h-9 w-full min-w-0 bg-transparent px-2 text-sm text-ink outline-none focus:bg-navy-800/5";
const thClass = "border border-sand px-2 py-1.5 text-left text-xs font-semibold uppercase tracking-wide text-steel";
const tdClass = "border border-sand p-0";

type Option = { id: string; name: string };
type ScopedOption = Option & { companyId: string };
// `rate` is what the item last cost landed — purchase price plus its share of
// that delivery's shipping, discount and tax, from the rate_list view —
// prefilled into the
// reference column. `salesRate` is its selling price, the price it last went out
// at, which prefills what it's being sold for now.
type ItemOption = ScopedOption & { rate: string | null; salesRate: string | null };
// Both rates are stored with four decimals, but every total on this form is
// round1 — so a price box prefilled with 1250.7500 shows precision the sale
// itself will never carry. One decimal in, one decimal out.
const rate1 = (v: string | null | undefined) => (v ? String(round1(Number(v))) : "");
type PaidMode = "yes" | "partial" | "no";
type Line = {
  itemId: string;
  // Text shown in the item combobox — the picked product's name, or a new one
  // typed in (created on save if it doesn't match a catalog item).
  itemText: string;
  locationId: string;
  unitId: string;
  // Same idea for the unit combobox.
  unitText: string;
  quantity: string;
  // Cost per unit — prefilled from the item's rate list price and editable, which
  // is the only way a product first seen on a sale line gets a rate at all.
  // Submitted as the line's unit_cost; never part of the sale total, which uses
  // unitPrice (what it sold for).
  listPrice: string;
  unitPrice: string;
};

const emptyLine = (): Line => ({
  itemId: "",
  itemText: "",
  locationId: "",
  unitId: "",
  unitText: "",
  quantity: "",
  listPrice: "",
  unitPrice: "",
});

// A walk-in is the normal sale: rung up against the Counter contact, paid then
// and there in cash from the drawer. Matched by name rather than id, same as the
// Royal Hardware company default below — these are rows the shop maintains. A
// company without them just starts blank (and a typed customer name is created
// on save anyway).
const DEFAULT_CUSTOMER = "Counter";
const DEFAULT_CASH_ACCOUNT = "Cash on Hand";

// One draft per form, not per sale: there is only ever one sale being typed.
const SALE_DRAFT_KEY = "sale";

// M52 doesn't sell over a counter — its sales go out on credit and are settled
// later — so a new M52 sale opens unpaid. Everywhere else the money comes in
// with the goods, which is why "yes" is the default at all. Matched by name,
// same as the two rows above.
const UNPAID_BY_DEFAULT_COMPANY = "M52";

// createSale returns the new id, updateSale doesn't — one shape covers both so
// the wrapped action has a single return type.
type SaleActionState = { error?: string; success?: boolean; id?: string } | undefined;

const SETTLEMENT_TYPES: { value: SettlementType; label: string }[] = [
  { value: "account", label: "Account" },
  { value: "cash", label: "Cash" },
  { value: "cheque", label: "Cheque" },
];

export type SaleDefaults = {
  companyId: string;
  contactId: string | null;
  documentDate: string;
  discountTotal: string;
  taxTotal: string;
  shippingTotal: string;
  isPaid: boolean;
  paidAmount: string;
  bankAccountId: string | null;
  cashAccountId: string | null;
  chequeId: string | null;
  settlementType: SettlementType | null;
  saleType: SaleType;
  // Server lines carry ids, not combobox text; unit_cost is what the rate column
  // was saved as. The text and a missing rate are filled in client-side on load.
  lines: { itemId: string; locationId: string; unitId: string; quantity: string; unitPrice: string; unitCost: string }[];
};

// Used as a page by /sales (a new sale, which is what that route now opens
// straight into) and /sales/[id], and as the body of the edit popup on the
// invoice list. `onDone` is what tells the three apart: a popup closes itself,
// a page navigates.
export function SaleFormPage({
  companyOptions,
  customerOptions,
  itemOptions,
  unitOptions,
  bankAccountOptions,
  cashAccountOptions,
  chequeOptions,
  saleId,
  defaults,
  title,
  onDone,
}: {
  companyOptions: Option[];
  customerOptions: ScopedOption[];
  itemOptions: ItemOption[];
  locationOptions: Option[];
  unitOptions: Option[];
  bankAccountOptions: Option[];
  cashAccountOptions: ScopedOption[];
  chequeOptions: Option[];
  saleId?: string;
  defaults?: SaleDefaults;
  // Heading shown on the same row as Clear / Delete. Omitted inside a dialog,
  // which has a title bar of its own.
  title?: string;
  onDone?: () => void;
}) {
  const router = useRouter();
  const isEdit = !!saleId;

  // Grid refs first: the reset below focuses the first cell, and both the reset
  // and the action that calls it have to be declared before use.
  const formRef = useRef<HTMLFormElement>(null);
  const gridRef = useRef<HTMLTableSectionElement>(null);
  function focusCell(r: number, c: number) {
    gridRef.current?.querySelector<HTMLInputElement>(`[data-cell="${r}-${c}"]`)?.focus();
  }

  // The Counter contact of one company — a sale must not reference another
  // company's contact, and the reset needs this too, so it isn't inlined.
  function counterId(company: string) {
    // This company's own Counter wins; a global one stands in when it hasn't got
    // one of its own.
    const candidates = customerOptions.filter((c) => c.name === DEFAULT_CUSTOMER && inCompany(company)(c));
    return (candidates.find((c) => c.companyId === company) ?? candidates[0])?.id ?? "";
  }

  // Which way the Paid select starts, for the company being sold from. Used on
  // first render, on switching company, and on the reset after a save — so all
  // three agree instead of "yes" being written in three places.
  function defaultPaidMode(company: string): PaidMode {
    return companyOptions.find((c) => c.id === company)?.name === UNPAID_BY_DEFAULT_COMPANY ? "no" : "yes";
  }

  // An edit gets the saved lines plus one blank row at the bottom, the same way
  // a new sale starts with four. Without that spare there is nothing to type
  // into — the grid only grows when the *last* row is edited, and on an existing
  // sale every row was already filled, so an invoice could never gain an item.
  const [lines, setLines] = useState<Line[]>(() =>
    defaults
      ? [
          ...defaults.lines.map(({ unitCost, ...l }) => ({
            ...l,
            itemText: itemOptions.find((it) => it.id === l.itemId)?.name ?? "",
            unitText: unitOptions.find((u) => u.id === l.unitId)?.name ?? "",
            // What was typed on this line wins over the item's current rate list price.
            listPrice: rate1(unitCost || itemOptions.find((it) => it.id === l.itemId)?.rate),
          })),
          emptyLine(),
        ]
      : [emptyLine(), emptyLine(), emptyLine(), emptyLine()],
  );
  const [companyId, setCompanyId] = useState(
    () => defaults?.companyId ?? companyOptions.find((c) => c.name === "Royal Hardware")?.id ?? "",
  );
  // One box each, no Rs/% selector beside it: a bare number is rupees, a number
  // ending in % is a percentage of the subtotal. The stored value was always the
  // resolved amount, so an existing sale loads as the plain figure.
  const [discountTotal, setDiscountTotal] = useState(() => defaults?.discountTotal ?? "0");
  const [taxTotal, setTaxTotal] = useState(() => defaults?.taxTotal ?? "0");
  const [shippingTotal, setShippingTotal] = useState(() => defaults?.shippingTotal ?? "0");
  const [contactId, setContactId] = useState(() => defaults?.contactId ?? counterId(companyId));
  const [customerText, setCustomerText] = useState(() =>
    defaults ? (customerOptions.find((c) => c.id === defaults.contactId)?.name ?? "") : DEFAULT_CUSTOMER,
  );
  // A sale is paid in full, part paid, or not at all. Part paid carries how much
  // came in; the rest of the grand total stays owed.
  const [isPaid, setIsPaid] = useState<PaidMode>(() =>
    defaults ? (defaults.isPaid ? "yes" : Number(defaults.paidAmount) > 0 ? "partial" : "no") : defaultPaidMode(companyId),
  );
  const [paidAmount, setPaidAmount] = useState(() => (defaults && !defaults.isPaid ? (defaults.paidAmount ?? "") : ""));
  const [settlementType, setSettlementType] = useState<SettlementType>(defaults?.settlementType ?? "cash");

  // --- Draft ----------------------------------------------------------------
  // Everything above, kept in localStorage while it's being typed, so a crash
  // between typing and saving doesn't cost the sale. The case that loses work
  // isn't a failed action — that keeps its state — it's a *render* that throws
  // (a database blip while the page reloads after a save), because the error
  // boundary replaces the whole form.
  //
  // components/ui/useDraft.tsx owns the store read, the offer/restore/discard
  // logic and the save-on-change effect; this form only names its draft and how
  // a restored one is written back into the setters above.
  //
  // New sales only: an edit has a saved record behind it, and quietly restoring
  // a stale copy over one is how someone else's changes disappear.
  const draftState = { lines, companyId, contactId, customerText, discountTotal, taxTotal, shippingTotal, isPaid, paidAmount, settlementType };
  type SaleDraft = typeof draftState;

  const { offerDraft, restore: restoreDraft, discard: discardDraft } = useDraft<SaleDraft>(SALE_DRAFT_KEY, {
    state: draftState,
    enabled: !isEdit,
    // A draft of a form nobody typed into is noise; only an unfinished sale is
    // worth offering back.
    hasContent: (d) => d.lines.some((l) => l.itemText?.trim() || l.quantity?.trim()),
    // Restoring is a click, not something that happens on its own. Silently
    // repopulating a form is worse than losing it: the shop would post a sale
    // it believed it had typed fresh.
    apply: (d) => {
      setLines(d.lines);
      setCompanyId(d.companyId);
      setContactId(d.contactId);
      setCustomerText(d.customerText);
      setDiscountTotal(d.discountTotal);
      setTaxTotal(d.taxTotal);
      setShippingTotal(d.shippingTotal);
      setIsPaid(d.isPaid);
      setPaidAmount(d.paidAmount);
      setSettlementType(d.settlementType);
    },
  });

  // Cash accounts belong to a company, so only the selected company's drawers are
  // offered — otherwise a Royal Hardware sale could be settled into M52's cash.
  const visibleCashAccounts = cashAccountOptions.filter((a) => a.companyId === companyId);
  const settlementOptions = settlementType === "account" ? bankAccountOptions : settlementType === "cash" ? visibleCashAccounts : chequeOptions;
  const settlementFieldName = settlementType === "account" ? "bankAccountId" : settlementType === "cash" ? "cashAccountId" : "chequeId";
  const settlementDefault =
    settlementType === "account"
      ? defaults?.bankAccountId
      : settlementType === "cash"
        ? (defaults?.cashAccountId ?? visibleCashAccounts.find((o) => o.name === DEFAULT_CASH_ACCOUNT)?.id)
        : defaults?.chequeId;
  const itemOpts = itemOptions;
  const unitOpts = unitOptions;
  const customerOpts = customerOptions;

  // Creating a sale used to navigate to the one just created, which put the next
  // sale two clicks away — the shop enters them back to back. It empties the form
  // instead; the success message links to what was created.
  function resetForm() {
    // The sale is stored; the copy of it that was only in this browser has
    // nothing left to protect. Cleared before the state updates so a render that
    // throws on the way out can't leave the finished sale sitting there as an
    // unsaved draft.
    clearDraft(SALE_DRAFT_KEY);
    setLines([emptyLine(), emptyLine(), emptyLine(), emptyLine()]);
    setContactId(counterId(companyId));
    setCustomerText(DEFAULT_CUSTOMER);
    setDiscountTotal("0");
    setTaxTotal("0");
    setShippingTotal("0");
    setIsPaid(defaultPaidMode(companyId));
    setPaidAmount("");
    setSettlementType("cash");
    // Resets what isn't controlled state — the document date back to today, and
    // the settlement select. Company is controlled, so it survives.
    formRef.current?.reset();
    focusCell(0, 0);
  }

  // Same reset, but by hand — for a sale started wrong rather than one just
  // saved. Confirms only when there's something to lose, so an empty form clears
  // without a prompt.
  function clearForm() {
    const started = lines.some((l) => l.itemText.trim() || l.quantity.trim() || l.unitPrice.trim());
    if (started && !confirm("Clear this sale and start over?")) return;
    resetForm();
  }

  // The reset and the navigation hang off the action rather than an effect on
  // `state`: an effect that setStates on every result is a cascading render, and
  // this only has to happen once, where the result arrives.
  //
  // New sales are entered back to back, so a created one clears the form and
  // stays put. A saved edit is finished business — it goes back to the list.
  // One id per open form: sent with every submit, claimed by the server inside
  // the same transaction as the sale, so a replayed submit can't post twice.
  const [operationId] = useState(() => crypto.randomUUID());
  const [state, action, pending] = useActionState(async (prev: SaleActionState, formData: FormData) => {
    const result: SaleActionState = isEdit ? await updateSale(saleId!, prev, formData) : await createSale(prev, formData);
    if (result?.success) {
      // Whatever happens next — a dialog closing, a route change, a page that
      // fails to re-render — this sale is saved, so its draft goes now.
      clearDraft(SALE_DRAFT_KEY);
      if (onDone) onDone();
      else if (isEdit) router.push("/sales/invoices");
      else resetForm();
    }
    return result;
  }, undefined);

  // Editing the last row grows the grid, so there is always one spare row below
  // the one being typed into — that's what the "+ Add item" button was for.
  // Trailing blank rows cost nothing: the server drops any line with no item or
  // no quantity.
  function patchLine(i: number, patch: (l: Line) => Line) {
    setLines((prev) => {
      const next = prev.map((l, idx) => (idx === i ? patch(l) : l));
      return i === prev.length - 1 ? [...next, emptyLine()] : next;
    });
  }

  function updateLine(i: number, patch: Partial<Line>) {
    patchLine(i, (l) => ({ ...l, ...patch }));
  }

  // Customers and items belong to one company; a sale must not mix companies, so
  // the dropdowns show only the selected company's rows, not the whole scope.
  const visibleCustomers = useMemo(() => customerOpts.filter(inCompany(companyId)), [customerOpts, companyId]);
  const visibleItems = useMemo(() => itemOpts.filter((it) => it.companyId === companyId), [itemOpts, companyId]);

  // Switching company drops any customer/line item from the old one so a stale id
  // can't be submitted against the new company — the customer falls back to the
  // new company's Counter. A typed-but-unmatched item keeps its text, only the
  // resolved itemId clears.
  // Done on change (not in an effect) — it's a response to the user's action.
  function changeCompany(next: string) {
    setCompanyId(next);
    // The company decides whether a sale is normally paid on the spot, so the
    // Paid select follows it — on a new sale only. An edit already knows what it
    // was settled as, and re-filing it under another company must not silently
    // rewrite that.
    if (!isEdit) {
      setIsPaid(defaultPaidMode(next));
      setPaidAmount("");
    }
    if (contactId && !customerOpts.some((c) => c.id === contactId && inCompany(next)(c))) {
      setContactId(counterId(next));
      setCustomerText(DEFAULT_CUSTOMER);
    }
    setLines((prev) =>
      prev.map((l) => (l.itemId && !itemOpts.some((it) => it.id === l.itemId && it.companyId === next) ? { ...l, itemId: "", listPrice: "" } : l)),
    );
  }

  // Picking a catalog item fills both price columns from what that item is known
  // to cost and to sell for: the rate list (last purchase) into the reference
  // column, the selling price (last sold, the products page's Sales Rate) into
  // the unit price. Both stay editable.
  //
  // They're only rewritten when the resolved item actually changes, so keystrokes
  // on a typed-in (new) item name don't wipe prices typed in beside it — while
  // switching off a catalog item still drops that item's numbers.
  function pickItem(i: number, name: string) {
    const opt = visibleItems.find((it) => it.name === name);
    patchLine(i, (l) => {
      const sameItem = (opt?.id ?? "") === l.itemId;
      return {
        ...l,
        itemText: name,
        itemId: opt?.id ?? "",
        listPrice: sameItem ? l.listPrice : rate1(opt?.rate),
        unitPrice: sameItem ? l.unitPrice : rate1(opt?.salesRate),
      };
    });
  }

  const subtotal = round1(lines.reduce((sum, l) => sum + (Number(l.quantity) || 0) * (Number(l.unitPrice) || 0), 0));
  const discountAmount = resolveAdjustment(discountTotal, subtotal);
  const taxAmount = resolveAdjustment(taxTotal, subtotal);
  const grandTotal = round1(subtotal - discountAmount + taxAmount + (Number(shippingTotal) || 0));
  // Clamped the same way the server clamps it, so the balance on screen is the
  // balance that gets stored.
  const paidNow = round1(
    isPaid === "yes" ? grandTotal : isPaid === "partial" ? Math.min(Math.max(Number(paidAmount) || 0, 0), grandTotal) : 0,
  );
  const balance = round1(grandTotal - paidNow);

  // What this customer owed before today. Fetched on the customer (never on
  // every keystroke of the grid), and dropped to zero for a walk-in with no
  // record yet — a typed-in new name has nothing outstanding by definition.
  const [previousBalance, setPreviousBalance] = useState(0);
  useEffect(() => {
    let cancelled = false;
    // A blank contact resolves to 0 server-side, so there's no early return to
    // write — and no setState in the effect body, which would cascade a render.
    getCustomerOutstanding(contactId, saleId)
      .then((owed) => !cancelled && setPreviousBalance(owed))
      .catch(() => !cancelled && setPreviousBalance(0));
    return () => {
      cancelled = true;
    };
  }, [contactId, saleId]);

  // Shown only when there is something to show — a customer square with us adds
  // two lines of nothing to every invoice otherwise.
  const totalDue = round1(grandTotal + previousBalance);
  const totalsBlock = (
    <>
      <span>Subtotal: {money(subtotal)}</span>
      <span className="font-semibold">Grand Total: {money(grandTotal)}</span>
      {previousBalance > 0 && (
        <>
          <span className="text-steel">Previous Balance: {money(previousBalance)}</span>
          <span className="font-semibold text-navy-800">Total Due: {money(totalDue)}</span>
        </>
      )}
    </>
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
              // unit_cost used to be sent as the line total, a duplicate of
              // line_total that nothing read. It now carries the rate column —
              // a real per-unit cost, which is what the column name says.
              unitCost: l.listPrice,
            })),
          )}
        />

        {/* Heading and its actions on one line. Clear only on a new sale: on an
            existing one it would wipe what was loaded from the database and
            leave the edit form pointing at nothing. */}
        <div className="flex flex-wrap items-center justify-between gap-3 sm:gap-4">
          {title ? <h1 className="text-xl text-navy-800">{title}</h1> : <span />}
          {isEdit ? (
            <DeleteSaleButton saleId={saleId!} onDone={onDone} />
          ) : (
            <button
              type="button"
              onClick={clearForm}
              className="h-9 rounded border border-sand px-4 text-sm font-medium text-steel hover:bg-ivory hover:text-navy-800"
            >
              Clear
            </button>
          )}
        </div>

        {/* An unfinished sale from before — a crash, a closed tab, a reload.
            Offered, never applied on its own. */}
        {offerDraft && <DraftBanner noun="sale" onRestore={restoreDraft} onDiscard={discardDraft} />}

        {/* --- documents header --- */}
        <div className="flex flex-col gap-3">
          <span className={sectionTitleClass}>Document</span>
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
            <label className={`${labelClass} w-56`}>
              <span className={labelTextClass}>Customer</span>
              <ComboBox
                value={customerText}
                options={visibleCustomers}
                placeholder="Pick a customer or type a new one"
                className={fieldClass}
                inputProps={{ required: true }}
                onChange={(name) => {
                  setCustomerText(name);
                  setContactId(visibleCustomers.find((c) => c.name === name)?.id ?? "");
                }}
              />
              <input type="hidden" name="contactId" value={contactId} />
              <input type="hidden" name="contactName" value={customerText} />
            </label>
            <label className={`${labelClass} w-40`}>
              <span className={labelTextClass}>Document Date</span>
              <DateField name="documentDate" required defaultValue={defaults?.documentDate ?? todayISO()} className={fieldClass} />
            </label>
            <label className={`${labelClass} w-44`}>
              <span className={labelTextClass}>Type</span>
              {/* Counter is preselected rather than left blank: it's what nearly
                  every sale is, and the other two exist to be told apart from it
                  when the takings are reconciled. */}
              <select name="saleType" required defaultValue={defaults?.saleType ?? DEFAULT_SALE_TYPE} className={fieldClass}>
                {SALE_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </label>
            {/* The numbers being watched while lines are typed, and the totals
                block is below the fold on a long sale — so they're repeated here
                at the end of the header row, styled exactly as they are down
                there. */}
            <div className="ml-auto flex flex-col items-end justify-end gap-0.5 text-sm text-ink">{totalsBlock}</div>
          </div>
        </div>

        {/* --- document_lines: Excel-style grid. Location is always the shop, so
            it isn't shown here; the server stamps it on save. --- */}
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
                  <th className={`${thClass} w-28`} title="Cost per unit — from the rate list, editable for items that have no purchase history yet">
                    Rate List
                  </th>
                  <th className={`${thClass} w-28`}>Unit Price</th>
                  <th className={`${thClass} w-28 text-right`}>Total</th>
                  <th className="w-8 border border-sand" />
                </tr>
              </thead>
              <tbody ref={gridRef} {...gridSelectionProps} onKeyDown={(e) => gridKeyDown(e, gridRef)}>
                {lines.map((line, r) => (
                  <tr key={r}>
                    {/* Row number: the line's position, not something typed into. */}
                    <td className="border border-sand px-2 text-right text-xs tabular-nums text-steel">{r + 1}</td>
                    <td className={tdClass}>
                      <ComboBox
                        value={line.itemText}
                        options={visibleItems}
                        placeholder="Item"
                        className={cellInput}
                        // data-shortcut="i" marks the first line's item box so
                        // Ctrl+I can jump to it from anywhere in the form.
                        inputProps={{ "data-cell": `${r}-0`, ...(r === 0 ? { "data-shortcut": "i" } : {}) }}
                        onChange={(name) => pickItem(r, name)}
                      />
                    </td>
                    <td className={tdClass}>
                      <ComboBox
                        value={line.unitText}
                        options={unitOpts}
                        placeholder="Unit"
                        className={cellInput}
                        inputProps={{ "data-cell": `${r}-1` }}
                        onChange={(name) => updateLine(r, { unitText: name, unitId: unitOpts.find((u) => u.name === name)?.id ?? "" })}
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
                    {/* Cost rate: prefilled from the rate list when the item has
                        purchase history, typed in when it doesn't (a new item has
                        no history, and this is where its first rate comes from). */}
                    <td className={tdClass}>
                      <input
                        data-cell={`${r}-3`}
                        type="number"
                        min="0"
                        step="0.1"
                        placeholder="Rate"
                        value={line.listPrice}
                        onChange={(e) => updateLine(r, { listPrice: e.target.value })}
                        className={`${cellInput} text-right text-steel`}
                      />
                    </td>
                    <td className={tdClass}>
                      <input
                        data-cell={`${r}-4`}
                        type="number"
                        min="0"
                        step="0.1"
                        placeholder="Price"
                        value={line.unitPrice}
                        onChange={(e) => updateLine(r, { unitPrice: e.target.value })}
                        className={`${cellInput} text-right`}
                      />
                    </td>
                    <td className="border border-sand px-2 text-right tabular-nums text-steel">
                      {/* Blank on an untouched row rather than 0.00 — the empty
                          rows are just spare space to type into. */}
                      {line.quantity && line.unitPrice ? money((Number(line.quantity) || 0) * (Number(line.unitPrice) || 0)) : ""}
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

        {/* --- totals: discount/tax/shipping applied after items, grand total last --- */}
        <div className="flex flex-col gap-3 rounded border border-sand p-3">
          <span className={sectionTitleClass}>Totals</span>
          <div className="flex flex-wrap gap-3">
            {/* Text, not number: "5%" has to be typeable. What goes to the
                server is still the resolved amount in the hidden field. */}
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
              <input type="hidden" name="discountTotal" value={discountAmount.toFixed(2)} />
            </label>
            <label className={`${labelClass} w-40`}>
              <span className={labelTextClass}>Tax</span>
              <input
                type="text"
                inputMode="decimal"
                placeholder="0 or 5%"
                data-shortcut="t"
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
                data-shortcut="s"
                value={shippingTotal}
                onChange={(e) => setShippingTotal(e.target.value)}
                className={`${fieldClass}`}
              />
            </label>
          </div>
          <div className="flex flex-col items-end gap-0.5 border-t border-sand pt-2 text-sm text-ink">
            {discountAmount > 0 && <span className="text-steel">Discount: -{money(discountAmount)}</span>}
            {taxAmount > 0 && <span className="text-steel">Tax: +{money(taxAmount)}</span>}
            {totalsBlock}
          </div>
        </div>

        <div className="flex flex-wrap items-start gap-3">
          <label className={`${labelClass} w-52`}>
            <span className={labelTextClass}>Paid?</span>
            <select name="isPaid" value={isPaid} onChange={(e) => setIsPaid(e.target.value as PaidMode)} className={fieldClass}>
              <option value="no">No</option>
              <option value="partial">Partial</option>
              <option value="yes">Yes</option>
            </select>
          </label>
          {isPaid === "partial" && (
            <label className={`${labelClass} w-40`}>
              <span className={labelTextClass}>Amount Paid</span>
              <input
                type="number"
                min="0"
                max={grandTotal}
                step="0.1"
                value={paidAmount}
                onChange={(e) => setPaidAmount(e.target.value)}
                className={`${fieldClass}`}
              />
            </label>
          )}
          {isPaid !== "no" && (
            <div className="flex flex-col justify-center gap-0.5 self-stretch pt-5 text-sm">
              <span className="text-steel">Paid: {money(paidNow)}</span>
              <span className={balance > 0 ? "font-semibold text-error" : "font-semibold text-success"}>Balance: {money(balance)}</span>
            </div>
          )}
        </div>

        {/* The amount actually settled — the whole total when paid in full, so the
            server never has to infer it from the mode. */}
        <input type="hidden" name="paidAmount" value={paidNow.toFixed(2)} />

        {isPaid !== "no" && (
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
              {/* Keyed on the company too: switching it changes both the option
                  list and which drawer is the default. */}
              <select key={`${settlementType}:${companyId}`} name={settlementFieldName} required defaultValue={settlementDefault ?? ""} className={fieldClass}>
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
        {state?.success &&
          (isEdit ? (
            <p className={successTextClass}>Saved.</p>
          ) : (
            <p className={successTextClass}>
              Sale created — form cleared for the next one.{" "}
              {state.id && (
                <Link href={`/sales/${state.id}`} className="underline">
                  View it
                </Link>
              )}
            </p>
          ))}
        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={pending}
            className="h-12 w-fit rounded bg-navy-800 px-6 text-base font-semibold text-white hover:bg-navy-700 disabled:opacity-40"
          >
            {pending ? (isEdit ? "Saving…" : "Creating…") : isEdit ? "Save" : "Create Sale"}
          </button>
          <button
            type="button"
            onClick={() => (onDone ? onDone() : router.push("/sales/invoices"))}
            className="h-12 rounded px-4 text-sm font-medium text-steel hover:bg-ivory"
          >
            {onDone ? "Cancel" : "Back to Invoices"}
          </button>
        </div>
      </form>
    </>
  );
}

// A plain button, not a <form> of its own: it now sits in the sale form's own
// heading row, and a form nested inside a form is invalid HTML — the browser
// drops the inner one and the click does nothing.
export function DeleteSaleButton({ saleId, onDone }: { saleId: string; onDone?: () => void }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    if (!confirm("Delete this sale? This removes its line items too.")) return;
    setPending(true);
    setError(null);
    const formData = new FormData();
    formData.set("documentId", saleId);
    const result = await deleteSale(undefined, formData);
    setPending(false);
    if (result?.error) {
      setError(result.error);
      return;
    }
    // Leaving the deleted sale behind is part of the delete, not a reaction to
    // it. Inside a popup that means closing; on its own page, going back.
    if (onDone) onDone();
    else router.push("/sales/invoices");
  }

  return (
    <div className="flex items-center gap-3">
      {error && <p className={errorTextClass}>{error}</p>}
      <button
        type="button"
        onClick={remove}
        disabled={pending}
        className="text-sm font-medium text-error hover:underline disabled:opacity-40"
      >
        {pending ? "Deleting…" : "Delete this sale"}
      </button>
    </div>
  );
}
