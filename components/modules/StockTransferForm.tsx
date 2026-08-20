"use client";

import { useActionState, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createStockTransfer, updateStockTransfer } from "@/lib/actions/stock-transfers";
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
type Line = { itemId: string; itemText: string; unitId: string; unitText: string; quantity: string };

// One draft per form: only one transfer is ever being typed. The user id is
// appended at the call site (transfer:<uid>) so a shared browser never offers
// one user's half-typed transfer to another.
const TRANSFER_DRAFT_KEY = "transfer";

const emptyLine = (): Line => ({ itemId: "", itemText: "", unitId: "", unitText: "", quantity: "" });

// createStockTransfer returns the new id, updateStockTransfer doesn't — one shape
// covers both so the wrapped action has a single return type.
type TransferActionState = { error?: string; success?: boolean; id?: string } | undefined;

// Server lines carry ids; the combobox text is derived from the option lists on
// load. One entry per item — the inbound half of each pair says nothing new.
export type TransferDefaults = {
  companyId: string;
  documentDate: string;
  fromLocationId: string;
  toLocationId: string;
  lines: { itemId: string; unitId: string; quantity: string }[];
};

// Same grid conventions as the sale form (Excel-style navigation, free-typed
// items created on save, last row grows the table) — a transfer is the same
// data entry minus the money.
export function StockTransferFormPage({
  companyOptions,
  itemOptions,
  unitOptions,
  locationOptions,
  transferId,
  defaults,
  onDone,
}: {
  companyOptions: Option[];
  itemOptions: ScopedOption[];
  unitOptions: Option[];
  locationOptions: Option[];
  transferId?: string;
  defaults?: TransferDefaults;
  // When the form lives in a popup (the list page's add dialog), a successful
  // save closes it instead of clearing for the next entry.
  onDone?: () => void;
}) {
  const router = useRouter();
  const isEdit = !!transferId;
  const formRef = useRef<HTMLFormElement>(null);
  const gridRef = useRef<HTMLTableSectionElement>(null);
  function focusCell(r: number, c: number) {
    gridRef.current?.querySelector<HTMLInputElement>(`[data-cell="${r}-${c}"]`)?.focus();
  }

  // An edit gets its saved lines plus one blank row — the grid only grows when
  // its last row is edited, so without the spare an existing transfer could
  // never gain an item.
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
  const [companyId, setCompanyId] = useState(
    () => defaults?.companyId ?? companyOptions.find((c) => c.name === "Royal Hardware")?.id ?? "",
  );
  const [fromLocationId, setFromLocationId] = useState(() => defaults?.fromLocationId ?? "");
  const [toLocationId, setToLocationId] = useState(() => defaults?.toLocationId ?? "");
  // Controlled (not defaultValue) so a draft captures the date too — a transfer
  // typed half-way is only worth offering back if the whole transfer returns.
  const [documentDate, setDocumentDate] = useState(() => defaults?.documentDate ?? todayISO());
  // The draft key is composed per render from the logged-in user — SessionSeed
  // (in the layout) sets the id before children render, so the first render
  // already carries the scoped key.
  const userId = useClientUserId();
  const transferDraftKey = userId ? `${TRANSFER_DRAFT_KEY}:${userId}` : TRANSFER_DRAFT_KEY;

  // --- Draft ----------------------------------------------------------------
  // New transfers are entered back to back, so a created one clears the form; a
  // crash, a closed tab or an offline blip before then costs nothing. Edits are
  // excluded: restoring a stale copy over a saved document would overwrite
  // someone else's changes.
  const draftState = { lines, companyId, fromLocationId, toLocationId, documentDate };
  type TransferDraft = typeof draftState;

  const { offerDraft, restore: restoreDraft, discard: discardDraft } = useDraft<TransferDraft>(transferDraftKey, {
    state: draftState,
    enabled: !isEdit,
    hasContent: (d) => d.lines.some((l) => l.itemText.trim() || l.quantity.trim()),
    apply: (d) => {
      setLines(d.lines);
      setCompanyId(d.companyId);
      setFromLocationId(d.fromLocationId);
      setToLocationId(d.toLocationId);
      setDocumentDate(d.documentDate);
    },
  });

  function resetForm() {
    setLines([emptyLine(), emptyLine(), emptyLine(), emptyLine()]);
    setDocumentDate(todayISO());
    formRef.current?.reset();
    focusCell(0, 0);
  }

  // New transfers are entered back to back, so a created one clears the form
  // rather than navigating away (see SaleForm for why this isn't an effect). An
  // edit keeps what's on screen — it's still the transfer you're looking at.
  // One id per open form: sent with every submit, claimed by the server inside
  // the same transaction as the transfer, so a replayed submit can't post twice.
  const [operationId] = useState(() => crypto.randomUUID());
  const [state, action, pending] = useActionState(async (prev: TransferActionState, formData: FormData) => {
    // A transport failure must not throw into the error boundary — that would
    // lose the form (and its operation id), and a restored draft would mint a
    // fresh id and post the transfer twice. Keep the form alive; a replayed
    // Save is then refused server-side as a duplicate.
    let result: TransferActionState;
    try {
      result = isEdit ? await updateStockTransfer(transferId!, prev, formData) : await createStockTransfer(prev, formData);
    } catch {
      return { error: TRANSPORT_ERROR_MESSAGE };
    }
    if (result?.success) {
      // Saved — the local copy has nothing left to protect.
      clearDraft(transferDraftKey);
      if (onDone) onDone();
      else if (!isEdit) resetForm();
    }
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

  const visibleItems = useMemo(() => itemOptions.filter((it) => it.companyId === companyId), [itemOptions, companyId]);

  // A line item from the old company can't be submitted against the new one.
  function changeCompany(next: string) {
    setCompanyId(next);
    setLines((prev) => prev.map((l) => (l.itemId && !itemOptions.some((it) => it.id === l.itemId && it.companyId === next) ? { ...l, itemId: "" } : l)));
  }

  return (
    <form ref={formRef} action={action} className="flex flex-col gap-5">
      <input type="hidden" name="operationId" value={operationId} />
      <input
        type="hidden"
        name="linesJson"
        value={JSON.stringify(lines.map((l) => ({ ...l, itemName: l.itemText, unitName: l.unitText })))}
      />

      {/* An unfinished transfer from before — a crash, a closed tab, a reload.
          Offered, never applied on its own. */}
      {offerDraft && <DraftBanner noun="transfer" onRestore={restoreDraft} onDiscard={discardDraft} />}

      <div className="flex flex-col gap-3">
        <span className={sectionTitleClass}>Transfer</span>
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
            <span className={labelTextClass}>From</span>
            <select name="fromLocationId" required value={fromLocationId} onChange={(e) => setFromLocationId(e.target.value)} className={fieldClass}>
              <option value="" disabled>
                Select a location
              </option>
              {/* Stock booked without a location is still stock. Transferring it
                  out of here is how it gets put somewhere real — with a document
                  saying so, rather than a silent edit. */}
              <option value={UNASSIGNED_LOCATION}>{UNASSIGNED_LABEL}</option>
              {locationOptions.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </label>
          <label className={`${labelClass} w-56`}>
            <span className={labelTextClass}>To</span>
            <select name="toLocationId" required value={toLocationId} onChange={(e) => setToLocationId(e.target.value)} className={fieldClass}>
              <option value="" disabled>
                Select a location
              </option>
              {/* The source is left out so the two can't be the same — the server
                  rejects it too, this just doesn't offer it. */}
              {fromLocationId !== UNASSIGNED_LOCATION && <option value={UNASSIGNED_LOCATION}>{UNASSIGNED_LABEL}</option>}
              {locationOptions
                .filter((l) => l.id !== fromLocationId)
                .map((l) => (
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
                      // Ctrl+I can jump to it from anywhere in the form. A
                      // transfer has no discount/tax/shipping, so only this
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
                      min="0"
                      step="0.01"
                      placeholder="Qty"
                      value={line.quantity}
                      onChange={(e) => updateLine(r, { quantity: e.target.value })}
                      className={`${cellInput} text-right`}
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
      {state?.success &&
        (isEdit ? (
          <p className={successTextClass}>Saved — stock re-posted to match.</p>
        ) : (
          <p className={successTextClass}>
            Transfer created — form cleared for the next one.{" "}
            {state.id && (
              <Link href={`/inventory/stock-transfers/${state.id}`} className="underline">
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
          {pending ? (isEdit ? "Saving…" : "Creating…") : isEdit ? "Save Transfer" : "Create Transfer"}
        </button>
        {/* The popup's own ✕ is the way out when this form sits in a dialog. */}
        {!onDone && (
          <button
            type="button"
            onClick={() => router.push("/inventory/stock-transfers")}
            className="h-12 rounded px-4 text-sm font-medium text-steel hover:bg-ivory"
          >
            Back to Transfers
          </button>
        )}
      </div>
    </form>
  );
}
