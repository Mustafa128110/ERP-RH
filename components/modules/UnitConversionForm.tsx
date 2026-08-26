"use client";

import { useActionState, useEffect, useState } from "react";
import { createUnitConversion, deleteUnitConversion, setUnitConversionRuleItems, updateUnitConversion } from "@/lib/actions/unit-conversions";
import { UnitBatchAddDialog } from "@/components/modules/UnitForm";
import { QuickAddSelect } from "@/components/ui/QuickAddSelect";
import { inputClass, labelClass, labelTextClass, submitClass, deleteButtonClass, errorTextClass, successTextClass } from "@/components/ui/form-styles";

type RuleValues = { id?: string; name: string; fromUnitId: string; toUnitId: string; multiplier: string; itemIds?: string[] };
type ItemOption = { id: string; name: string; sku: string };
type UnitOption = { id: string; name: string; symbol: string | null };

const unitLabel = (unit: UnitOption) => unit.symbol ? `${unit.name} (${unit.symbol})` : unit.name;

function RuleFields({ defaults, unitOptions }: { defaults?: RuleValues; unitOptions: UnitOption[] }) {
  const [fromUnitId, setFromUnitId] = useState(defaults?.fromUnitId ?? "");
  const [toUnitId, setToUnitId] = useState(defaults?.toUnitId ?? "");
  return (
    <>
      <label className={labelClass}>
        <span className={labelTextClass}>Rule Name</span>
        <input name="name" required maxLength={150} defaultValue={defaults?.name ?? ""} placeholder="e.g. Dozen to Pieces" className={inputClass} />
      </label>
      <QuickAddSelect
        label="From Unit"
        name="fromUnitId"
        required
        value={fromUnitId}
        onChange={setFromUnitId}
        options={unitOptions.map((unit) => ({ id: unit.id, name: unitLabel(unit) }))}
        placeholder="Select a unit"
        renderDialog={({ onClose }) => <UnitBatchAddDialog initialRows={1} onClose={onClose} onDone={() => onClose()} />}
      />
      <QuickAddSelect
        label="To Unit"
        name="toUnitId"
        required
        value={toUnitId}
        onChange={setToUnitId}
        options={unitOptions.map((unit) => ({ id: unit.id, name: unitLabel(unit) }))}
        placeholder="Select a unit"
        renderDialog={({ onClose }) => <UnitBatchAddDialog initialRows={1} onClose={onClose} onDone={() => onClose()} />}
      />
      <label className={labelClass}>
        <span className={labelTextClass}>Multiplier</span>
        <input name="multiplier" type="number" step="0.000001" min="0.000001" required defaultValue={defaults?.multiplier ?? "1"} className={inputClass} />
        <span className="text-xs text-steel">Works both ways: 1 dozen = 12 pieces, and 12 pieces = 1 dozen.</span>
      </label>
    </>
  );
}

export function UnitConversionCreateForm({ unitOptions, onDone }: { unitOptions: UnitOption[]; onDone?: () => void }) {
  const [state, action, pending] = useActionState(createUnitConversion, undefined);
  useEffect(() => { if (state?.success) onDone?.(); }, [state?.success, onDone]);
  return (
    <form action={action} className="flex flex-col gap-4">
      <RuleFields unitOptions={unitOptions} />
      <p className="text-xs text-steel">Products are selected after saving this rule.</p>
      {state?.error && <p className={errorTextClass}>{state.error}</p>}
      <button type="submit" disabled={pending} className={submitClass}>{pending ? "Saving…" : "Save rule"}</button>
    </form>
  );
}

export function UnitConversionEditForm({ conversionId, defaults, unitOptions, onDone }: { conversionId: string; defaults: RuleValues; unitOptions: UnitOption[]; onDone?: () => void }) {
  const [state, action, pending] = useActionState(updateUnitConversion.bind(null, conversionId), undefined);
  useEffect(() => { if (state?.success) onDone?.(); }, [state?.success, onDone]);
  return (
    <form action={action} className="flex flex-col gap-4">
      <RuleFields defaults={defaults} unitOptions={unitOptions} />
      {state?.error && <p className={errorTextClass}>{state.error}</p>}
      {state?.success && <p className={successTextClass}>Saved.</p>}
      <button type="submit" disabled={pending} className={submitClass}>{pending ? "Saving…" : "Save rule"}</button>
    </form>
  );
}

export function UnitRuleProductsForm({ ruleId, itemIds, itemOptions, onDone }: { ruleId: string; itemIds: string[]; itemOptions: ItemOption[]; onDone?: () => void }) {
  const [selected, setSelected] = useState(itemIds);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-3 border-t border-sand pt-4">
      <div>
        <p className={labelTextClass}>Products using this rule</p>
        <p className="text-xs text-steel">A product may use more than one compatible rule.</p>
      </div>
      <select
        multiple
        value={selected}
        onChange={(event) => setSelected(Array.from(event.currentTarget.selectedOptions, (option) => option.value))}
        className={`${inputClass} min-h-40`}
        aria-label="Products using this rule"
      >
        {itemOptions.map((item) => <option key={item.id} value={item.id}>{item.sku ? `${item.sku} — ${item.name}` : item.name}</option>)}
      </select>
      {message && <p className={message.startsWith("Saved") ? successTextClass : errorTextClass}>{message}</p>}
      <button
        type="button"
        disabled={saving}
        className={submitClass}
        onClick={async () => {
          setSaving(true);
          setMessage(null);
          const result = await setUnitConversionRuleItems(ruleId, selected);
          setSaving(false);
          if (result.error) setMessage(result.error);
          else { setMessage("Saved product assignments."); onDone?.(); }
        }}
      >
        {saving ? "Saving…" : "Save product assignments"}
      </button>
    </div>
  );
}

export function DeleteUnitConversionButton({ conversionId, onDone }: { conversionId: string; onDone?: () => void }) {
  const [state, action, pending] = useActionState(deleteUnitConversion, undefined);
  useEffect(() => { if (state?.success) onDone?.(); }, [state?.success, onDone]);
  return (
    <form action={action} onSubmit={(event) => { if (!confirm("Delete this rule and remove it from its products?")) event.preventDefault(); }}>
      <input type="hidden" name="id" value={conversionId} />
      <button type="submit" disabled={pending} className={deleteButtonClass}>{pending ? "Deleting…" : "Delete this rule"}</button>
      {state?.error && <p className={`mt-2 ${errorTextClass}`}>{state.error}</p>}
    </form>
  );
}
