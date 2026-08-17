"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createQuotation, updateQuotation, deleteQuotation, type QuotationLine } from "@/lib/actions/quotations";
import { fieldClass, labelClass, labelTextClass, errorTextClass, submitClass, deleteButtonClass, TRANSPORT_ERROR_MESSAGE } from "@/components/ui/form-styles";
import { ComboBox } from "@/components/ui/ComboBox";
import { DateField } from "@/components/ui/DateField";
import { gridKeyDown, gridSelectionProps } from "@/components/ui/grid-keys";
import { money, resolveAdjustment, round1, todayISO } from "@/lib/format";
import { inCompany } from "@/lib/contact-scope";
import { clearDraft } from "@/lib/draft";
import { useClientUserId } from "@/lib/client-user";
import { useSync } from "@/components/layout/SyncProvider";
import { DraftBanner, useDraft } from "@/components/ui/useDraft";

// Deliberately not SaleForm with the money parts hidden. A quotation has no
// payment, no settlement account, no previous-balance line and no stock — a
// third of that component exists for things this screen must not do, and
// threading a "quotation mode" flag through all of it would make both harder to
// read than the two apart.
//
// What is shared is shared properly: the same ComboBox, the same Excel-style
// grid keys, the same date field and the same money formatting, so the two forms
// behave identically under the hands that use them all day.

const cellInput = "h-9 w-full min-w-0 bg-transparent px-2 text-sm text-ink outline-none focus:bg-navy-800/5";
const thClass = "border border-sand px-2 py-1.5 text-left text-xs font-semibold uppercase tracking-wide text-steel";
const tdClass = "border border-sand p-0";

type Option = { id: string; name: string };
type ScopedOption = Option & { companyId: string };
type ItemOption = ScopedOption & { salesRate: string | null };

type Line = {
  itemId: string;
  itemText: string;
  unitId: string;
  unitText: string;
  quantity: string;
  unitPrice: string;
  // How much of this line is already on an invoice. Read-only here — it's
  // changed by converting, never by typing.
  convertedQuantity: string;
};

// One draft per form: only one quotation is ever being typed. The user id is
// appended at the call site (quotation:<uid>) so a shared browser never offers
// one user's half-typed quotation to another.
const QUOTATION_DRAFT_KEY = "quotation";

const BLANK_ROWS = 8;
const emptyLine = (): Line => ({ itemId: "", itemText: "", unitId: "", unitText: "", quantity: "", unitPrice: "", convertedQuantity: "0" });

export type QuotationDefaults = {
  companyId: string;
  contactId: string;
  documentDate: string;
  validUntil: string;
  discountTotal: string;
  taxTotal: string;
  shippingTotal: string;
  lines: QuotationLine[];
};

export function QuotationForm({
  companyOptions,
  customerOptions,
  itemOptions,
  unitOptions,
  quotationId,
  defaults,
  onDone,
}: {
  companyOptions: Option[];
  customerOptions: ScopedOption[];
  itemOptions: ItemOption[];
  unitOptions: Option[];
  quotationId?: string;
  defaults?: QuotationDefaults;
  // When the form lives in a popup (the list page's add dialog), a successful
  // save closes it instead of navigating away to the list.
  onDone?: () => void;
}) {
  const router = useRouter();
  const isEdit = !!quotationId;
  // The draft key is composed per render from the logged-in user — SessionSeed
  // (in the layout) sets the id before children render, so the first render
  // already carries the scoped key.
  const userId = useClientUserId();
  const quotationDraftKey = userId ? `${QUOTATION_DRAFT_KEY}:${userId}` : QUOTATION_DRAFT_KEY;

  const [companyId, setCompanyId] = useState(defaults?.companyId ?? companyOptions[0]?.id ?? "");
  const [contactId, setContactId] = useState(defaults?.contactId ?? "");
  const [contactText, setContactText] = useState(
    defaults?.contactId ? (customerOptions.find((c) => c.id === defaults.contactId)?.name ?? "") : "",
  );
  const [documentDate, setDocumentDate] = useState(defaults?.documentDate ?? todayISO());
  const [validUntil, setValidUntil] = useState(defaults?.validUntil ?? "");
  const [discount, setDiscount] = useState(defaults?.discountTotal && Number(defaults.discountTotal) ? defaults.discountTotal : "");
  const [tax, setTax] = useState(defaults?.taxTotal && Number(defaults.taxTotal) ? defaults.taxTotal : "");
  const [shipping, setShipping] = useState(defaults?.shippingTotal && Number(defaults.shippingTotal) ? defaults.shippingTotal : "");

  const [lines, setLines] = useState<Line[]>(() => {
    const existing = (defaults?.lines ?? []).map(
      (l): Line => ({
        itemId: l.itemId,
        itemText: l.itemName,
        unitId: l.unitId,
        unitText: l.unitName,
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        convertedQuantity: l.convertedQuantity,
      }),
    );
    // Always some room at the bottom: a grid you have to press a button to grow
    // is a grid that interrupts typing.
    return [...existing, ...Array.from({ length: BLANK_ROWS - Math.min(existing.length, BLANK_ROWS - 2) }, emptyLine)];
  });

  const gridRef = useRef<HTMLTableSectionElement>(null);

  // --- Draft ----------------------------------------------------------------
  // The same protection the sale form has: a quotation is a lot of typing, and
  // the thing that loses it is a render that throws after the save, not the
  // save itself. New quotations only — an edit has a saved record behind it, and
  // restoring a stale copy over one is how someone else's changes disappear.
  // The hook (components/ui/useDraft.tsx) owns the store read, the
  // offer/restore/discard logic and the save-on-change effect.
  const draftState = { companyId, contactId, contactText, documentDate, validUntil, discount, tax, shipping, lines };
  type QuotationDraft = typeof draftState;

  const { offerDraft, restore: restoreDraft, discard: discardDraft } = useDraft<QuotationDraft>(quotationDraftKey, {
    state: draftState,
    enabled: !isEdit,
    hasContent: (d) => d.lines.some((l) => l.itemText.trim() || l.quantity.trim()),
    apply: (d) => {
      setCompanyId(d.companyId);
      setContactId(d.contactId);
      setContactText(d.contactText);
      setDocumentDate(d.documentDate);
      setValidUntil(d.validUntil);
      setDiscount(d.discount);
      setTax(d.tax);
      setShipping(d.shipping);
      setLines(d.lines);
    },
  });

  const { enqueue } = useSync();

  // Set when "Queue for later" could not be written to local storage — the
  // quotation stays on screen (and in its draft) instead of the queue silently
  // failing to take it.
  const [queueError, setQueueError] = useState<string | null>(null);

  // One id per open form: sent with every submit, claimed by the server inside
  // the same transaction as the quotation, so a replayed submit can't post twice.
  const [operationId] = useState(() => crypto.randomUUID());
  // Wrapped so a transport failure (response lost after the server committed)
  // becomes an inline error instead of throwing into the error boundary — that
  // would lose the form and its operation id, and a restored draft would mint a
  // fresh id and post the quotation twice. The form survives; a replayed Save is
  // refused server-side as a duplicate.
  const [state, action, pending] = useActionState(
    async (prev: { error?: string; success?: boolean; id?: string } | undefined, formData: FormData) => {
      try {
        return isEdit ? await updateQuotation(quotationId, prev, formData) : await createQuotation(prev, formData);
      } catch {
        return { error: TRANSPORT_ERROR_MESSAGE };
      }
    },
    undefined,
  );

  useEffect(() => {
    if (state?.success) {
      // Saved — the local copy has nothing left to protect.
      clearDraft(quotationDraftKey);
      if (onDone) onDone();
      else router.push("/sales/quotations");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.success]);

  // Items and customers belong to a company; switching company must not leave a
  // line pointing at the other one's catalogue.
  const companyItems = itemOptions.filter((i) => i.companyId === companyId);
  const companyCustomers = customerOptions.filter(inCompany(companyId));

  function update(index: number, patch: Partial<Line>) {
    setLines((prev) => {
      const next = prev.map((l, i) => (i === index ? { ...l, ...patch } : l));
      // Typing in the last row grows the grid, so there is always somewhere to go.
      if (index === next.length - 1) next.push(emptyLine());
      return next;
    });
  }

  // Picking an item fills in its last selling price — the number being quoted is
  // almost always the number it last went out at, and retyping it is the sort of
  // work a form should do for you.
  function pickItem(index: number, name: string) {
    const match = companyItems.find((i) => i.name === name);
    update(index, {
      itemText: name,
      itemId: match?.id ?? "",
      ...(match?.salesRate && !lines[index].unitPrice ? { unitPrice: match.salesRate } : {}),
    });
  }

  const filled = lines.filter((l) => (l.itemId || l.itemText.trim()) && Number(l.quantity) > 0);
  const subtotal = round1(filled.reduce((sum, l) => sum + Number(l.quantity) * (Number(l.unitPrice) || 0), 0));
  // One box takes rupees or a percentage ("250" or "5%"), same as the sale form.
  const discountAmount = resolveAdjustment(discount, subtotal);
  const taxAmount = resolveAdjustment(tax, subtotal);
  const shippingAmount = resolveAdjustment(shipping, subtotal);
  const grandTotal = round1(subtotal - discountAmount + taxAmount + shippingAmount);

  // Any line already invoiced locks the whole quotation: the server refuses the
  // edit (it would rewrite lines an invoice is built on), so saying so here beats
  // letting someone retype it and be told no at the end.
  const locked = lines.some((l) => Number(l.convertedQuantity) > 0);

  // Queue for later: serialise exactly what the hidden inputs send, so the sync
  // engine can rebuild the same FormData createQuotation reads. The queue mints
  // its own stable operation id; the draft is cleared because the work now lives
  // in the queue, not on screen.
  const linesJson = JSON.stringify(
    filled.map((l) => ({
      itemId: l.itemId,
      itemName: l.itemId ? "" : l.itemText.trim(),
      unitId: l.unitId,
      unitName: l.unitId ? "" : l.unitText.trim(),
      quantity: l.quantity,
      unitPrice: l.unitPrice || "0",
    })),
  );
  const queueQuotation = () => {
    const result = enqueue(
      "quotation",
      `Quotation · ${money(grandTotal)}${contactText ? ` for ${contactText}` : ""}`,
      {
        companyId,
        contactId,
        contactName: contactId ? "" : contactText,
        documentDate,
        validUntil,
        discountTotal: String(discountAmount),
        taxTotal: String(taxAmount),
        shippingTotal: String(shippingAmount),
        linesJson,
      },
    );
    // A queue that could not be written leaves the form exactly as it is: the
    // draft stays (it is the only copy), nothing navigates away, and the user
    // is told the work is not stored safely.
    if (!result?.persisted) {
      setQueueError(
        "This browser could not save a copy of this quotation (storage is full or blocked). Keep this page open — it is not stored safely yet.",
      );
      return;
    }
    setQueueError(null);
    clearDraft(quotationDraftKey);
    if (onDone) onDone();
    else router.push("/sales/quotations");
  };

  return (
    <form action={action} className="flex h-full min-h-0 flex-col gap-4">
      <input type="hidden" name="operationId" value={operationId} />
      <input type="hidden" name="companyId" value={companyId} />
      <input type="hidden" name="contactId" value={contactId} />
      {/* A name typed over the dropdown becomes a new contact on save, exactly as
          on a sale line — so both go up and the server decides. */}
      <input type="hidden" name="contactName" value={contactId ? "" : contactText} />
      <input type="hidden" name="discountTotal" value={String(discountAmount)} />
      <input type="hidden" name="taxTotal" value={String(taxAmount)} />
      <input type="hidden" name="shippingTotal" value={String(shippingAmount)} />
      <input type="hidden" name="linesJson" value={linesJson} />

      {/* An unfinished quotation from before — a crash, a closed tab, a reload.
          Offered, never applied on its own. */}
      {offerDraft && <DraftBanner noun="quotation" onRestore={restoreDraft} onDiscard={discardDraft} />}

      {locked && (
        <p className="shrink-0 rounded border border-warning/40 bg-warning-tint p-3 text-sm text-ink">
          Part of this quotation has already been invoiced, so it can no longer be changed. Raise a new quotation for whatever is left.
        </p>
      )}

      <div className="flex shrink-0 flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
        {companyOptions.length > 1 && (
          <label className={labelClass}>
            <span className={labelTextClass}>Company</span>
            <select
              value={companyId}
              onChange={(e) => {
                setCompanyId(e.target.value);
                setContactId("");
                setContactText("");
              }}
              disabled={locked}
              className={fieldClass}
            >
              {companyOptions.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
        )}

        <label className={labelClass}>
          <span className={labelTextClass}>Customer</span>
          <span className="inline-block w-full sm:w-64">
            <ComboBox
              value={contactText}
              onChange={(name) => {
                setContactText(name);
                setContactId(companyCustomers.find((c) => c.name === name)?.id ?? "");
              }}
              options={companyCustomers}
              placeholder="Pick or type a new customer"
              className={`w-full ${fieldClass}`}
              inputProps={{ disabled: locked }}
            />
          </span>
        </label>

        <label className={labelClass}>
          <span className={labelTextClass}>Quotation Date</span>
          <span className="inline-block w-full sm:w-40">
            <DateField name="documentDate" value={documentDate} onChange={setDocumentDate} required className={fieldClass} />
          </span>
        </label>

        <label className={labelClass}>
          <span className={labelTextClass}>Valid Until</span>
          <span className="inline-block w-full sm:w-40">
            {/* Optional: a quotation with no expiry is one that stands until it's
                withdrawn, which is how most small jobs are quoted. */}
            <DateField name="validUntil" value={validUntil} onChange={setValidUntil} className={fieldClass} />
          </span>
        </label>
      </div>

      <div className="scroll-thin min-h-0 flex-1 overflow-auto rounded border border-sand">
        <table className="w-full min-w-max border-collapse">
          <thead>
            <tr className="sticky top-0 z-10 bg-ivory">
              <th className={`${thClass} w-10 text-right`}>#</th>
              <th className={thClass}>Item</th>
              <th className={thClass}>Unit</th>
              <th className={`${thClass} text-right`}>Quantity</th>
              <th className={`${thClass} text-right`}>Rate</th>
              <th className={`${thClass} text-right`}>Line Total</th>
              {locked && <th className={`${thClass} text-right`}>Invoiced</th>}
            </tr>
          </thead>
          <tbody ref={gridRef} {...gridSelectionProps} onKeyDown={(e) => gridKeyDown(e, gridRef)}>
            {lines.map((line, r) => (
              <tr key={r}>
                <td className="border border-sand px-2 py-1 text-right text-xs tabular-nums text-steel">{r + 1}</td>
                <td className={tdClass}>
                  <ComboBox
                    value={line.itemText}
                    onChange={(name) => pickItem(r, name)}
                    options={companyItems}
                    className={cellInput}
                    // data-shortcut="i" marks the first line's item box so
                    // Ctrl+I can jump to it from anywhere in the form.
                    inputProps={{ "data-cell": `${r}-0`, disabled: locked, ...(r === 0 ? { "data-shortcut": "i" } : {}) }}
                  />
                </td>
                <td className={tdClass}>
                  <ComboBox
                    value={line.unitText}
                    onChange={(name) => update(r, { unitText: name, unitId: unitOptions.find((u) => u.name === name)?.id ?? "" })}
                    options={unitOptions}
                    className={cellInput}
                    inputProps={{ "data-cell": `${r}-1`, disabled: locked }}
                  />
                </td>
                <td className={tdClass}>
                  <input
                    data-cell={`${r}-2`}
                    type="number"
                    step="0.01"
                    min="0"
                    value={line.quantity}
                    onChange={(e) => update(r, { quantity: e.target.value })}
                    disabled={locked}
                    className={`${cellInput} text-right tabular-nums`}
                  />
                </td>
                <td className={tdClass}>
                  <input
                    data-cell={`${r}-3`}
                    type="number"
                    step="0.1"
                    min="0"
                    value={line.unitPrice}
                    onChange={(e) => update(r, { unitPrice: e.target.value })}
                    disabled={locked}
                    className={`${cellInput} text-right tabular-nums`}
                  />
                </td>
                <td className="border border-sand px-2 py-1 text-right text-sm tabular-nums text-ink">
                  {line.quantity && line.unitPrice ? money(round1(Number(line.quantity) * Number(line.unitPrice))) : ""}
                </td>
                {locked && (
                  <td className="border border-sand px-2 py-1 text-right text-sm tabular-nums text-steel">
                    {Number(line.convertedQuantity) > 0 ? line.convertedQuantity : ""}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex shrink-0 flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between">
        <div className="grid grid-cols-3 gap-2 sm:flex sm:flex-wrap sm:items-end sm:gap-3">
          <label className={labelClass}>
            <span className={labelTextClass}>Discount</span>
            <input value={discount} onChange={(e) => setDiscount(e.target.value)} placeholder="0 or 5%" data-shortcut="d" disabled={locked} className={`${fieldClass} sm:w-28`} />
          </label>
          <label className={labelClass}>
            <span className={labelTextClass}>Tax</span>
            <input value={tax} onChange={(e) => setTax(e.target.value)} placeholder="0 or 17%" data-shortcut="t" disabled={locked} className={`${fieldClass} sm:w-28`} />
          </label>
          <label className={labelClass}>
            <span className={labelTextClass}>Shipping</span>
            <input value={shipping} onChange={(e) => setShipping(e.target.value)} placeholder="0" data-shortcut="s" disabled={locked} className={`${fieldClass} sm:w-28`} />
          </label>
        </div>

        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:gap-6">
          <dl className="text-right text-sm">
            <div className="flex justify-between gap-8">
              <dt className="text-steel">Subtotal</dt>
              <dd className="tabular-nums text-ink">{money(subtotal)}</dd>
            </div>
            <div className="flex justify-between gap-8 border-t border-sand pt-1">
              <dt className="font-semibold text-navy-800">Quoted Total</dt>
              <dd className="font-semibold tabular-nums text-navy-800">{money(grandTotal)}</dd>
            </div>
          </dl>

          <div className="flex flex-wrap items-center gap-3 sm:gap-4">
            {state?.error && <p className={errorTextClass}>{state.error}</p>}
            {queueError && <p className={errorTextClass}>{queueError}</p>}
            {isEdit && !locked && <DeleteQuotationButton quotationId={quotationId} />}
            {/* New quotations only: queueing an edit would send a copy of a
                saved document, and a sync replay of that is a second quotation
                nobody asked for. */}
            {!isEdit && (
              <button
                type="button"
                onClick={queueQuotation}
                disabled={locked || filled.length === 0}
                className="h-11 rounded border border-sand px-4 text-sm font-medium text-navy-800 hover:bg-ivory disabled:opacity-40"
                title="Keep this quotation locally and send it when the connection returns"
              >
                Queue for later
              </button>
            )}
            <button type="submit" disabled={pending || locked} className={submitClass}>
              {pending ? "Saving…" : isEdit ? "Save Quotation" : "Create Quotation"}
            </button>
          </div>
        </div>
      </div>
    </form>
  );
}

export function DeleteQuotationButton({ quotationId }: { quotationId: string }) {
  const router = useRouter();
  const [state, action, pending] = useActionState(deleteQuotation, undefined);

  useEffect(() => {
    if (state?.success) router.push("/sales/quotations");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.success]);

  return (
    // Nested inside the quotation form would be a form inside a form, which the
    // HTML parser simply discards — so this posts on its own.
    <span>
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          if (!confirm("Delete this quotation? Invoices already raised from it are kept.")) return;
          const data = new FormData();
          data.set("documentId", quotationId);
          action(data);
        }}
        className={deleteButtonClass}
      >
        {pending ? "Deleting…" : "Delete"}
      </button>
      {state?.error && <p className={`mt-1 ${errorTextClass}`}>{state.error}</p>}
    </span>
  );
}
