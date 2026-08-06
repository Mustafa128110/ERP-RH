"use client";

import { useEffect, useRef, useState } from "react";
import {
  createProductsBatch,
  getProductsForEdit,
  peekNextSku,
  updateProductsBatch,
  type ProductBatchEditShared,
  type ProductBatchRow,
  type ProductEditData,
  type ProductEditRow,
} from "@/lib/actions/products";
import { BatchAddDialog, batchCellClass, batchInputClass } from "@/components/ui/BatchAddDialog";
import { Dialog } from "@/components/ui/Dialog";
import { gridKeyDown, gridSelectionProps } from "@/components/ui/grid-keys";
import { QuickAddButton } from "@/components/ui/QuickAddSelect";
import { ComboBox } from "@/components/ui/ComboBox";
import { DateField } from "@/components/ui/DateField";
import { CategoryBatchAddDialog } from "@/components/modules/CategoryForm";
import { BrandBatchAddDialog } from "@/components/modules/BrandForm";
import { errorTextClass, inputClass, labelClass, labelTextClass } from "@/components/ui/form-styles";
import { ADJUSTMENT_REASONS } from "@/lib/adjustment-constants";
import { UNASSIGNED_LABEL, UNASSIGNED_LOCATION, locationFormValue } from "@/lib/location-constants";
import { money, qty, todayISO } from "@/lib/format";

type Option = { id: string; name: string };

type BatchRow = {
  name: string;
  sku: string;
  companyId: string;
  // id when a suggestion was picked, text always — an unmatched name creates the
  // record on save.
  categoryId: string;
  categoryText: string;
  brandId: string;
  brandText: string;
  urduName: string;
  taxable: boolean;
  isActive: boolean;
};

const emptyBatchRow = (defaultCompanyId: string): BatchRow => ({
  name: "",
  sku: "",
  companyId: defaultCompanyId,
  categoryId: "",
  categoryText: "",
  brandId: "",
  brandText: "",
  urduName: "",
  taxable: false,
  isActive: true,
});

export type CreatedProduct = { id: string; name: string; sku: string; companyId: string };

// --- Edit selected products ------------------------------------------------

// A reference cell takes an existing record or a new name, the same way the sale
// and purchase grids do: the id travels when a suggestion is picked, the raw
// text when it isn't, and the server creates the record from the text.
type ComboValue = { id: string; text: string };

type EditRow = {
  // Stable across re-renders and unique even for the blank rows, which all share
  // an empty `id` until they're saved — React needs something to key on.
  key: string;
  // Empty on a row added here: that row creates a product rather than updating
  // one, so a pass over the list can fix what's there and add what's missing.
  id: string;
  companyId: string;
  name: string;
  sku: string;
  urduName: string;
  category: ComboValue;
  brand: ComboValue;
  taxable: boolean;
  isActive: boolean;
  unit: ComboValue;
  supplier: ComboValue;
  purchaseQty: string;
  purchaseRate: string;
  targetQty: string;
};

const blankCombo = { id: "", text: "" };

// The editable cells open on what the last purchase already said — supplier,
// unit and rate — rather than blank beside a read-only copy of the same fact.
// Editing one writes back to where it was read from, so there is one supplier,
// not a stored one and a displayed one. Labels come from the option lists by id,
// which keeps them in the exact form the typeahead matches on.
const toEditRow = (r: ProductEditRow, data: ProductEditData): EditRow => {
  const combo = (id: string | null, options: { id: string; name: string }[]) =>
    id ? { id, text: options.find((o) => o.id === id)?.name ?? "" } : { ...blankCombo };
  return {
    key: r.id,
    id: r.id,
    companyId: r.companyId,
    name: r.name,
    sku: r.sku,
    urduName: r.urduName ?? "",
    category: { id: r.categoryId ?? "", text: r.categoryName ?? "" },
    brand: { id: r.brandId ?? "", text: r.brandName ?? "" },
    taxable: r.taxable,
    isActive: r.isActive,
    unit: combo(r.lastUnitId, data.unitOptions),
    supplier: combo(r.lastSupplierId, data.supplierOptions),
    // Quantity stays blank on purpose: it means "how many arrived now", and the
    // answer to that is never "the same as last time".
    purchaseQty: "",
    purchaseRate: r.purchaseRate ?? "",
    targetQty: "",
  };
};

let newRowSeq = 0;

// SKU is left blank on purpose — the server hands out the next RH- number, the
// same as the add dialog does.
const newEditRow = (companyId: string): EditRow => ({
  key: `new-${newRowSeq++}`,
  id: "",
  companyId,
  name: "",
  sku: "",
  urduName: "",
  category: { ...blankCombo },
  brand: { ...blankCombo },
  taxable: false,
  isActive: true,
  unit: { ...blankCombo },
  supplier: { ...blankCombo },
  purchaseQty: "",
  purchaseRate: "",
  targetQty: "",
});

const cellClass = "border border-sand p-0 align-middle";
const cellInputClass = "h-9 w-full min-w-[7rem] bg-transparent px-2 text-sm text-ink outline-none focus:bg-navy-800/5";

function ComboCell({
  value,
  options,
  placeholder,
  onChange,
}: {
  value: ComboValue;
  options: { id: string; name: string }[];
  placeholder: string;
  onChange: (next: ComboValue) => void;
}) {
  return (
    <td className={cellClass}>
      <ComboBox
        value={value.text}
        options={options}
        placeholder={placeholder}
        className={cellInputClass}
        onChange={(text) => onChange({ text, id: options.find((o) => o.name === text)?.id ?? "" })}
      />
    </td>
  );
}

export function ProductsBatchEditDialog({
  itemIds,
  companyOptions,
  categoryOptions,
  brandOptions,
  onClose,
  onDone,
}: {
  itemIds: string[];
  // Already loaded by the products page for the add dialog — no reason to fetch
  // them a second time just because a different dialog needs them.
  companyOptions: Option[];
  categoryOptions: Option[];
  brandOptions: Option[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [data, setData] = useState<ProductEditData | null>(null);
  const [rows, setRows] = useState<EditRow[]>([]);
  const [loadError, setLoadError] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bodyRef = useRef<HTMLTableSectionElement>(null);

  // "We bought more" and "the shelf says twelve" are different statements and
  // write different documents, so the dialog makes you say which — once, for the
  // whole batch, since a delivery is one delivery and a count is one count.
  const [mode, setMode] = useState<ProductBatchEditShared["mode"]>("none");
  const [locationId, setLocationId] = useState("");
  const [reason, setReason] = useState("");
  const [documentDate, setDocumentDate] = useState(todayISO);

  useEffect(() => {
    let cancelled = false;
    getProductsForEdit(itemIds)
      .then((d) => {
        if (cancelled) return;
        if (d.rows.length === 0) setLoadError(true);
        else {
          setData(d);
          setRows(d.rows.map((r) => toEditRow(r, d)));
          // The date is one field for the whole batch, but each item has its own
          // last purchase — so the newest of them wins, which is the delivery
          // the user is most likely correcting. Today only when nothing in the
          // batch has ever been purchased. ISO dates sort lexically.
          const lastPurchase = d.rows
            .map((r) => r.lastPurchaseDate)
            .filter((v): v is string => Boolean(v))
            .sort()
            .pop();
          if (lastPurchase) setDocumentDate(lastPurchase);
        }
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      });
    return () => {
      cancelled = true;
    };
    // itemIds is a fresh array each render; the ids themselves are what matter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemIds.join(",")]);

  function update(i: number, patch: Partial<EditRow>) {
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }

  // New rows land under the company of the row above, which is the right guess
  // when the whole batch is one catalogue and easy to change when it isn't.
  function addRow() {
    setRows((prev) => [...prev, newEditRow(prev[prev.length - 1]?.companyId ?? companyOptions[0]?.id ?? "")]);
  }

  // Dropping an existing product just takes it out of this edit; dropping a new
  // one discards it. Neither deletes anything.
  function removeRow(i: number) {
    setRows((prev) => prev.filter((_, idx) => idx !== i));
  }

  async function submit() {
    setPending(true);
    setError(null);
    const result = await updateProductsBatch(
      { mode, locationId, reason, documentDate },
      rows.map((r) => ({
        id: r.id,
        companyId: r.companyId,
        name: r.name,
        sku: r.sku,
        urduName: r.urduName,
        categoryId: r.category.id,
        categoryName: r.category.text,
        brandId: r.brand.id,
        brandName: r.brand.text,
        taxable: r.taxable,
        isActive: r.isActive,
        unitId: r.unit.id,
        unitName: r.unit.text,
        supplierId: r.supplier.id,
        supplierName: r.supplier.text,
        purchaseQty: r.purchaseQty,
        purchaseRate: r.purchaseRate,
        targetQty: r.targetQty,
      })),
    );
    setPending(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    onDone();
  }

  // What's on hand where the adjustment is aimed, so "set to 12" is a decision
  // rather than a guess. The delta itself is recomputed server-side at save time.
  // locationFormValue, not `?? ""` — a null-location stock row is Unassigned,
  // and has to match the Unassigned option rather than reading as zero.
  const currentAt = (row: EditRow) =>
    data?.rows
      .find((r) => r.id === row.id)
      ?.stock.find((s) => locationFormValue(s.locationId) === locationId && (s.unitId ?? "") === row.unit.id)?.onHand ?? 0;

  const known = (row: EditRow) => data?.rows.find((r) => r.id === row.id);
  // On hand across every location, in the unit each movement was booked in. The
  // unit has its own column, so this is the number alone.
  const onHand = (row: EditRow) => (known(row)?.stock ?? []).reduce((sum, s) => sum + s.onHand, 0);

  const headers = [
    "Company",
    "Item Name",
    "SKU",
    "Urdu Name",
    "Category",
    "Brand",
    "Tax",
    "Active",
    "Unit",
    "In Stock",
    "Sales Rate",
    ...(mode === "purchase" ? ["Supplier", "Qty Received", "Purchase Rate"] : []),
    ...(mode === "adjust" ? ["Stock Level Should Be", "Currently"] : []),
  ];

  return (
    <Dialog
      title={`Edit ${rows.length || itemIds.length} product${(rows.length || itemIds.length) === 1 ? "" : "s"}`}
      onClose={onClose}
      size="wide"
      footer={
        <div className="flex flex-wrap items-center justify-between gap-3">
          <button type="button" onClick={addRow} disabled={!data} className="text-sm font-medium text-navy-800 hover:underline disabled:opacity-40">
            + Add a product
          </button>
          <div className="flex items-center gap-3">
            {error && <p className="text-sm text-error">{error}</p>}
            <button type="button" onClick={onClose} className="h-10 rounded px-4 text-sm text-steel hover:bg-ivory">
              Cancel
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={pending || rows.length === 0}
              className="h-10 rounded bg-navy-800 px-5 text-sm font-semibold text-white hover:bg-navy-700 disabled:opacity-40"
            >
              {pending ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      }
    >
      {loadError ? (
        <p className={errorTextClass}>Couldn&apos;t load the selected products.</p>
      ) : !data ? (
        <p className="text-sm text-steel">Loading…</p>
      ) : (
        <div className="flex flex-col gap-4">
          {/* Stock, supplier and rate live on documents, not on the item —
              filling them in books one per row, which is what puts the rate in
              rate_list, the supplier on the item's history and the quantity into
              on-hand stock. The document is a stock receipt, not a purchase
              invoice: it has no financial side at all. */}
          <fieldset className="flex flex-col gap-3 rounded border border-sand p-3">
            <legend className="px-1 text-sm font-medium text-ink">Stock &amp; Supplier</legend>
            <div className="flex flex-wrap gap-4">
              {(
                [
                  ["none", "Details only", "Edit the catalogue fields. No stock or supplier is recorded."],
                  [
                    "purchase",
                    "Record stock & rate",
                    "Sets the rate, and adds stock if you enter a quantity — the quantity is optional. Nothing is booked to the ledger: no payable, not paid or unpaid.",
                  ],
                  ["adjust", "Set stock levels", "Counted the shelf. Posts the difference as an adjustment — no supplier, no price."],
                ] as const
              ).map(([value, label, hint]) => (
                <label key={value} className="flex max-w-xs items-start gap-2 text-sm text-ink">
                  <input
                    type="radio"
                    name="stockMode"
                    checked={mode === value}
                    onChange={() => {
                      setMode(value);
                      // Unassigned is only offered for adjustments, so it must
                      // not survive a switch into a mode that can't show it.
                      if (value !== "adjust" && locationId === UNASSIGNED_LOCATION) setLocationId("");
                    }}
                    className="mt-1 h-4 w-4 border-sand"
                  />
                  <span>
                    {label}
                    <span className="block text-xs text-steel">{hint}</span>
                  </span>
                </label>
              ))}
            </div>

            {mode !== "none" && (
              <div className="flex flex-wrap gap-3">
                <label className={`${labelClass} w-56`}>
                  <span className={labelTextClass}>Location</span>
                  {/* Not a typeahead: locations carry a required type (shop /
                      warehouse / transit), so a bare name can't create one. */}
                  <select value={locationId} onChange={(e) => setLocationId(e.target.value)} required className={inputClass}>
                    <option value="" disabled>
                      Select a location
                    </option>
                    {/* Only when correcting. Purchased goods arrive somewhere
                        real; stock already sitting Unassigned is exactly what an
                        adjustment is for. */}
                    {mode === "adjust" && <option value={UNASSIGNED_LOCATION}>{UNASSIGNED_LABEL}</option>}
                    {data.locationOptions.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className={`${labelClass} w-44`}>
                  <span className={labelTextClass}>Date</span>
                  <DateField value={documentDate} onChange={setDocumentDate} className={inputClass} />
                </label>
                {mode === "adjust" && (
                  <label className={`${labelClass} w-56`}>
                    <span className={labelTextClass}>Reason</span>
                    <select value={reason} onChange={(e) => setReason(e.target.value)} className={inputClass}>
                      <option value="">Pick a reason</option>
                      {ADJUSTMENT_REASONS.map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              </div>
            )}
          </fieldset>

          <div className="scroll-thin overflow-auto rounded border border-sand">
            <table className="w-full min-w-max border-collapse text-sm">
              <thead>
                <tr className="sticky top-0 z-10 bg-ivory">
                  <th className="w-10 border border-sand px-2 py-2 text-right text-xs font-semibold uppercase tracking-wide text-steel">
                    #
                  </th>
                  {headers.map((h) => (
                    <th
                      key={h}
                      className="whitespace-nowrap border border-sand px-2 py-2 text-left text-xs font-semibold uppercase tracking-wide text-steel"
                    >
                      {h}
                    </th>
                  ))}
                  <th className="w-8 border border-sand" />
                </tr>
              </thead>
              <tbody ref={bodyRef} {...gridSelectionProps} onKeyDown={(e) => gridKeyDown(e, bodyRef, () => !pending && void submit())}>
                {rows.map((row, i) => (
                  <tr key={row.key}>
                    <td className="border border-sand px-2 text-right text-xs tabular-nums text-steel">{i + 1}</td>
                    {/* An existing product's company is fixed — moving one would
                        move its stock between two sets of books with no document
                        saying so. A new row still has to pick one. */}
                    <td className={row.id ? "whitespace-nowrap border border-sand px-2 text-sm text-steel" : cellClass}>
                      {row.id ? (
                        (data.rows.find((r) => r.id === row.id)?.company ?? "—")
                      ) : (
                        <select value={row.companyId} onChange={(e) => update(i, { companyId: e.target.value })} className={cellInputClass}>
                          <option value="" disabled>
                            Select
                          </option>
                          {companyOptions.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.name}
                            </option>
                          ))}
                        </select>
                      )}
                    </td>
                    <td className={cellClass}>
                      <input value={row.name} onChange={(e) => update(i, { name: e.target.value })} className={`${cellInputClass} min-w-[14rem]`} />
                    </td>
                    <td className={cellClass}>
                      <input
                        value={row.sku}
                        onChange={(e) => update(i, { sku: e.target.value })}
                        placeholder={row.id ? undefined : "auto"}
                        className={cellInputClass}
                      />
                    </td>
                    <td className={cellClass}>
                      <input value={row.urduName} onChange={(e) => update(i, { urduName: e.target.value })} dir="rtl" className={cellInputClass} />
                    </td>
                    <ComboCell
                      value={row.category}
                      options={categoryOptions}
                      placeholder="Category"
                      onChange={(category) => update(i, { category })}
                    />
                    <ComboCell value={row.brand} options={brandOptions} placeholder="Brand" onChange={(brand) => update(i, { brand })} />
                    <td className={`${cellClass} text-center`}>
                      <input
                        type="checkbox"
                        checked={row.taxable}
                        onChange={(e) => update(i, { taxable: e.target.checked })}
                        className="h-5 w-5 rounded border-sand"
                      />
                    </td>
                    <td className={`${cellClass} text-center`}>
                      <input
                        type="checkbox"
                        checked={row.isActive}
                        onChange={(e) => update(i, { isActive: e.target.checked })}
                        className="h-5 w-5 rounded border-sand"
                      />
                    </td>
                    <ComboCell value={row.unit} options={data.unitOptions} placeholder="Unit" onChange={(unit) => update(i, { unit })} />

                    {/* Read-only: both are derived from documents, so they change
                        by recording a movement or raising a sale, not by typing
                        here. A new row has no history and shows a dash. */}
                    <td className="whitespace-nowrap border border-sand px-2 text-right text-sm tabular-nums text-steel">
                      {known(row) ? qty(onHand(row)) : "—"}
                    </td>
                    <td className="whitespace-nowrap border border-sand px-2 text-right text-sm tabular-nums text-steel">
                      {known(row)?.salesRate ? money(known(row)!.salesRate!) : "—"}
                    </td>

                    {mode === "purchase" && (
                      <>
                        <ComboCell
                          value={row.supplier}
                          options={data.supplierOptions.filter((s) => s.companyId === row.companyId)}
                          placeholder="Supplier"
                          onChange={(supplier) => update(i, { supplier })}
                        />
                        {/* Optional: a rate on its own records the price and
                            moves no stock, which is what a price list is. */}
                        <td className={cellClass}>
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={row.purchaseQty}
                            onChange={(e) => update(i, { purchaseQty: e.target.value })}
                            placeholder="Rate only"
                            className={cellInputClass}
                          />
                        </td>
                        <td className={cellClass}>
                          <input
                            type="number"
                            min="0"
                            step="0.1"
                            value={row.purchaseRate}
                            onChange={(e) => update(i, { purchaseRate: e.target.value })}
                            placeholder="0.0"
                            className={cellInputClass}
                          />
                        </td>
                      </>
                    )}

                    {mode === "adjust" && (
                      <>
                        <td className={cellClass}>
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={row.targetQty}
                            onChange={(e) => update(i, { targetQty: e.target.value })}
                            placeholder="Blank — leave alone"
                            className={cellInputClass}
                          />
                        </td>
                        <td className="border border-sand px-2 text-right text-sm tabular-nums text-steel">{currentAt(row)}</td>
                      </>
                    )}

                    <td className="border border-sand text-center">
                      <button
                        type="button"
                        onClick={() => removeRow(i)}
                        className="text-steel hover:text-error"
                        title={row.id ? "Leave this product out of the batch" : "Discard this new row"}
                        aria-label={`Remove row ${i + 1}`}
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
      )}
    </Dialog>
  );
}

// --- Add products in bulk --------------------------------------------------

export function ProductBatchAddDialog({
  companyOptions,
  categoryOptions,
  brandOptions,
  onClose,
  onDone,
  initialRows,
}: {
  companyOptions: Option[];
  categoryOptions: Option[];
  brandOptions: Option[];
  onClose: () => void;
  onDone: (created?: CreatedProduct[]) => void;
  initialRows?: number;
}) {
  const defaultCompanyId = companyOptions[0]?.id ?? "";

  // Category and brand can be created without leaving the product batch, via the
  // toolbar buttons below. Held in state so a newly added one shows up in every
  // row's dropdown immediately.
  const [categoryOpts, setCategoryOpts] = useState(categoryOptions);
  const [brandOpts, setBrandOpts] = useState(brandOptions);

  // SKUs are auto-assigned (RH-00042) but overridable, so each row shows the
  // number it will get as a placeholder — leave it alone and the server
  // allocates it, type over it and yours is used verbatim.
  //
  // A peek, not a reservation: opening the dialog must not consume numbers. The
  // projection below assumes the rows are filled top to bottom, which is what
  // the server does; if someone else creates a product first the real numbers
  // shift, which is why these are placeholders and not pre-filled values.
  const [nextSkuNumber, setNextSkuNumber] = useState<number | null>(null);
  useEffect(() => {
    let cancelled = false;
    peekNextSku()
      .then((sku) => {
        const n = Number(sku.replace(/\D/g, ""));
        if (!cancelled && Number.isFinite(n)) setNextSkuNumber(n);
      })
      // A blank placeholder is a fine fallback — blank still means "auto".
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const projectedSku = (rowIndex: number) =>
    nextSkuNumber === null ? "auto" : `RH-${String(nextSkuNumber + rowIndex).padStart(5, "0")}`;

  return (
    <BatchAddDialog<BatchRow, CreatedProduct>
      title="Add Products"
      onClose={onClose}
      onDone={onDone}
      initialRows={initialRows}
      emptyRow={() => emptyBatchRow(defaultCompanyId)}
      headers={["Name", "SKU", "Company", "Category", "Brand", "Urdu Name", "Taxable", "Active"]}
      toolbar={
        <>
          <QuickAddButton
            label="+ Add Category"
            onCreated={(rows) => setCategoryOpts((prev) => [...rows, ...prev])}
            renderDialog={({ onClose, onCreated }) => (
              <CategoryBatchAddDialog
                parentOptions={categoryOpts}
                initialRows={1}
                onClose={onClose}
                onDone={(created) => onCreated(created ?? [])}
              />
            )}
          />
          <QuickAddButton
            label="+ Add Brand"
            onCreated={(rows) => setBrandOpts((prev) => [...rows, ...prev])}
            renderDialog={({ onClose, onCreated }) => (
              <BrandBatchAddDialog
                initialRows={1}
                onClose={onClose}
                onDone={(created) => onCreated(created ?? [])}
              />
            )}
          />
        </>
      }
      onSubmit={async (rows) => {
        const values: ProductBatchRow[] = rows.map((r) => ({
          name: r.name.trim(),
          sku: r.sku.trim(),
          companyId: r.companyId,
          categoryId: r.categoryId || null,
          categoryName: r.categoryText.trim() || null,
          brandId: r.brandId || null,
          brandName: r.brandText.trim() || null,
          urduName: r.urduName.trim() || null,
          taxable: r.taxable,
          isActive: r.isActive,
        }));
        return createProductsBatch(values);
      }}
      renderRow={(row, i, update) => (
        <>
          <td className={batchCellClass}>
            <input value={row.name} onChange={(e) => update({ name: e.target.value })} className={batchInputClass} placeholder="Name" />
          </td>
          <td className={batchCellClass}>
            <input value={row.sku} onChange={(e) => update({ sku: e.target.value })} className={batchInputClass} placeholder={projectedSku(i)} />
          </td>
          <td className={batchCellClass}>
            <select value={row.companyId} onChange={(e) => update({ companyId: e.target.value })} className={batchInputClass}>
              <option value="" disabled>
                Select
              </option>
              {companyOptions.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </td>
          {/* Typeaheads, not dropdowns, for the same two reasons the edit grid
              uses them: a category or brand that doesn't exist yet is created
              from what you type, and a native <select> swallows Up/Down so the
              arrow keys couldn't cross the row. */}
          <td className={batchCellClass}>
            <ComboBox
              value={row.categoryText}
              options={categoryOpts}
              placeholder="Category"
              className={batchInputClass}
              onChange={(text) => update({ categoryText: text, categoryId: categoryOpts.find((c) => c.name === text)?.id ?? "" })}
            />
          </td>
          <td className={batchCellClass}>
            <ComboBox
              value={row.brandText}
              options={brandOpts}
              placeholder="Brand"
              className={batchInputClass}
              onChange={(text) => update({ brandText: text, brandId: brandOpts.find((b) => b.name === text)?.id ?? "" })}
            />
          </td>
          <td className={batchCellClass}>
            <input value={row.urduName} onChange={(e) => update({ urduName: e.target.value })} className={batchInputClass} placeholder="Urdu Name" />
          </td>
          <td className={`${batchCellClass} text-center`}>
            <input type="checkbox" checked={row.taxable} onChange={(e) => update({ taxable: e.target.checked })} className="h-5 w-5 rounded border-sand" />
          </td>
          <td className={`${batchCellClass} text-center`}>
            <input type="checkbox" checked={row.isActive} onChange={(e) => update({ isActive: e.target.checked })} className="h-5 w-5 rounded border-sand" />
          </td>
        </>
      )}
    />
  );
}
