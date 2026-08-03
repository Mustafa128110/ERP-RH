"use client";

import { useActionState, useEffect, useState } from "react";
import { updateUnitConversion, deleteUnitConversion, createUnitConversionsBatch, type UnitConversionBatchRow } from "@/lib/actions/unit-conversions";
import { ProductBatchAddDialog } from "@/components/modules/ProductForm";
import { UnitBatchAddDialog } from "@/components/modules/UnitForm";
import { QuickAddSelect, QuickAddButton } from "@/components/ui/QuickAddSelect";
import { BatchAddDialog, batchCellClass, batchInputClass } from "@/components/ui/BatchAddDialog";
import { inputClass, labelClass, labelTextClass, submitClass, deleteButtonClass, errorTextClass, successTextClass } from "@/components/ui/form-styles";

interface ConversionValues {
  companyId: string | null;
  itemId: string;
  fromUnitId: string;
  toUnitId: string;
  multiplier: string;
}

type Option = { id: string; name: string };
type ItemOption = { id: string; name: string; sku: string };
type UnitOption = { id: string; name: string; symbol: string | null };

const itemLabel = (o: ItemOption) => `${o.sku} — ${o.name}`;
const unitLabel = (o: UnitOption) => `${o.name} (${o.symbol})`;

// --- Batch add ------------------------------------------------------------

type BatchRow = { companyId: string; itemId: string; fromUnitId: string; toUnitId: string; multiplier: string };

export function UnitConversionBatchAddDialog({
  companyOptions,
  itemOptions,
  unitOptions,
  onClose,
  onDone,
  initialRows,
}: {
  companyOptions: Option[];
  itemOptions: ItemOption[];
  unitOptions: UnitOption[];
  onClose: () => void;
  onDone: () => void;
  initialRows?: number;
}) {
  // Items and units created from the toolbar go into these, so every row's
  // dropdowns pick them up immediately.
  const [itemOpts, setItemOpts] = useState(itemOptions);
  const [unitOpts, setUnitOpts] = useState(unitOptions);

  // companyId "" = global, the default.
  const emptyRow = (): BatchRow => ({ companyId: "", itemId: "", fromUnitId: "", toUnitId: "", multiplier: "1" });

  return (
    <BatchAddDialog<BatchRow>
      title="Add Unit Conversions"
      onClose={onClose}
      onDone={onDone}
      initialRows={initialRows}
      emptyRow={emptyRow}
      headers={["Company", "Item", "From Unit", "To Unit", "Multiplier"]}
      toolbar={
        <>
          <QuickAddButton
            label="+ Add Item"
            onCreated={(rows) => setItemOpts((prev) => [...rows.map((r) => ({ id: r.id, name: r.name, sku: "" })), ...prev])}
            renderDialog={({ onClose, onCreated }) => (
              <ProductBatchAddDialog
                companyOptions={companyOptions}
                categoryOptions={[]}
                brandOptions={[]}
                initialRows={1}
                onClose={onClose}
                onDone={(created) => onCreated((created ?? []).map((c) => ({ id: c.id, name: `${c.sku} — ${c.name}` })))}
              />
            )}
          />
          <QuickAddButton
            label="+ Add Unit"
            onCreated={(rows) => setUnitOpts((prev) => [...rows.map((r) => ({ id: r.id, name: r.name, symbol: "" })), ...prev])}
            renderDialog={({ onClose, onCreated }) => (
              <UnitBatchAddDialog
                initialRows={1}
                onClose={onClose}
                onDone={(created) => onCreated((created ?? []).map((c) => ({ id: c.id, name: `${c.name} (${c.symbol})` })))}
              />
            )}
          />
        </>
      }
      onSubmit={async (rows) => {
        const values: UnitConversionBatchRow[] = rows.map((r) => ({
          companyId: r.companyId || null,
          itemId: r.itemId,
          fromUnitId: r.fromUnitId,
          toUnitId: r.toUnitId,
          multiplier: r.multiplier.trim() || "0",
        }));
        return createUnitConversionsBatch(values);
      }}
      renderRow={(row, i, update) => (
        <>
          <td className={batchCellClass}>
            <select value={row.companyId} onChange={(e) => update({ companyId: e.target.value })} className={batchInputClass}>
              <option value="">Global</option>
              {companyOptions.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </td>
          <td className={batchCellClass}>
            <select value={row.itemId} onChange={(e) => update({ itemId: e.target.value })} className={batchInputClass}>
              <option value="">—</option>
              {itemOpts.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.sku ? itemLabel(o) : o.name}
                </option>
              ))}
            </select>
          </td>
          <td className={batchCellClass}>
            <select value={row.fromUnitId} onChange={(e) => update({ fromUnitId: e.target.value })} className={batchInputClass}>
              <option value="">—</option>
              {unitOpts.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.symbol ? unitLabel(o) : o.name}
                </option>
              ))}
            </select>
          </td>
          <td className={batchCellClass}>
            <select value={row.toUnitId} onChange={(e) => update({ toUnitId: e.target.value })} className={batchInputClass}>
              <option value="">—</option>
              {unitOpts.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.symbol ? unitLabel(o) : o.name}
                </option>
              ))}
            </select>
          </td>
          <td className={batchCellClass}>
            <input
              type="number"
              step="0.000001"
              min="0"
              value={row.multiplier}
              onChange={(e) => update({ multiplier: e.target.value })}
              className={batchInputClass}
            />
          </td>
        </>
      )}
    />
  );
}

// --- Edit (single) --------------------------------------------------------

function EditFields({
  defaults,
  companyOptions,
  itemOptions,
  unitOptions,
}: {
  defaults: ConversionValues;
  companyOptions: Option[];
  itemOptions: ItemOption[];
  unitOptions: UnitOption[];
}) {
  const [itemId, setItemId] = useState(defaults.itemId);
  const [fromUnitId, setFromUnitId] = useState(defaults.fromUnitId);
  const [toUnitId, setToUnitId] = useState(defaults.toUnitId);

  return (
    <>
      <label className={labelClass}>
        <span className={labelTextClass}>Company</span>
        <select name="companyId" defaultValue={defaults.companyId ?? ""} className={inputClass}>
          <option value="">Global (all companies)</option>
          {companyOptions.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>

      <QuickAddSelect
        label="Item"
        name="itemId"
        required
        value={itemId}
        onChange={setItemId}
        options={itemOptions.map((o) => ({ id: o.id, name: itemLabel(o) }))}
        placeholder="Select an item"
        renderDialog={({ onClose, onCreated }) => (
          <ProductBatchAddDialog
            companyOptions={companyOptions}
            categoryOptions={[]}
            brandOptions={[]}
            initialRows={1}
            onClose={onClose}
            onDone={(created) => onCreated((created ?? []).map((c) => ({ id: c.id, name: `${c.sku} — ${c.name}` })))}
          />
        )}
      />

      <QuickAddSelect
        label="From Unit"
        name="fromUnitId"
        required
        value={fromUnitId}
        onChange={setFromUnitId}
        options={unitOptions.map((o) => ({ id: o.id, name: unitLabel(o) }))}
        placeholder="Select a unit"
        renderDialog={({ onClose, onCreated }) => (
          <UnitBatchAddDialog
            initialRows={1}
            onClose={onClose}
            onDone={(created) => onCreated((created ?? []).map((c) => ({ id: c.id, name: `${c.name} (${c.symbol})` })))}
          />
        )}
      />

      <QuickAddSelect
        label="To Unit"
        name="toUnitId"
        required
        value={toUnitId}
        onChange={setToUnitId}
        options={unitOptions.map((o) => ({ id: o.id, name: unitLabel(o) }))}
        placeholder="Select a unit"
        renderDialog={({ onClose, onCreated }) => (
          <UnitBatchAddDialog
            initialRows={1}
            onClose={onClose}
            onDone={(created) => onCreated((created ?? []).map((c) => ({ id: c.id, name: `${c.name} (${c.symbol})` })))}
          />
        )}
      />

      <label className={labelClass}>
        <span className={labelTextClass}>Multiplier</span>
        <input name="multiplier" type="number" step="0.000001" min="0" required defaultValue={defaults.multiplier} className={inputClass} />
        <span className="text-xs text-steel">1 From Unit = this many To Units</span>
      </label>
    </>
  );
}

export function UnitConversionEditForm({
  conversionId,
  defaults,
  companyOptions,
  itemOptions,
  unitOptions,
  onDone,
}: {
  conversionId: string;
  defaults: ConversionValues;
  companyOptions: Option[];
  itemOptions: ItemOption[];
  unitOptions: UnitOption[];
  onDone?: () => void;
}) {
  const [state, action, pending] = useActionState(updateUnitConversion.bind(null, conversionId), undefined);

  useEffect(() => {
    if (state?.success) onDone?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.success]);

  return (
    <form action={action} className="flex flex-col gap-4">
      <EditFields defaults={defaults} companyOptions={companyOptions} itemOptions={itemOptions} unitOptions={unitOptions} />
      {state?.error && <p className={errorTextClass}>{state.error}</p>}
      {state?.success && <p className={successTextClass}>Saved.</p>}
      <button type="submit" disabled={pending} className={submitClass}>
        {pending ? "Saving…" : "Save"}
      </button>
    </form>
  );
}

export function DeleteUnitConversionButton({ conversionId, onDone }: { conversionId: string; onDone?: () => void }) {
  const [state, action, pending] = useActionState(deleteUnitConversion, undefined);

  useEffect(() => {
    if (state?.success) onDone?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.success]);

  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (!confirm("Delete this unit conversion?")) e.preventDefault();
      }}
    >
      <input type="hidden" name="id" value={conversionId} />
      <button type="submit" disabled={pending} className={deleteButtonClass}>
        {pending ? "Deleting…" : "Delete this conversion"}
      </button>
      {state?.error && <p className={`mt-2 ${errorTextClass}`}>{state.error}</p>}
    </form>
  );
}
