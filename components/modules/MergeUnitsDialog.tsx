"use client";

import { useActionState, useEffect, useState } from "react";
import { mergeUnits } from "@/lib/actions/units";
import { Dialog } from "@/components/ui/Dialog";
import { errorTextClass, inputClass, labelClass, labelTextClass, submitClass } from "@/components/ui/form-styles";

type Unit = { id: string; name: string; symbol: string | null };
const label = (unit: Unit) => unit.symbol ? `${unit.name} (${unit.symbol})` : unit.name;

export function MergeUnitsDialog({ units, onClose, onDone }: { units: Unit[]; onClose: () => void; onDone: () => void }) {
  const [sourceUnitId, setSourceUnitId] = useState("");
  const [targetUnitId, setTargetUnitId] = useState("");
  const [state, action, pending] = useActionState(mergeUnits, undefined);
  const source = units.find((unit) => unit.id === sourceUnitId);
  const target = units.find((unit) => unit.id === targetUnitId);

  useEffect(() => {
    if (state?.success) onDone();
  }, [state?.success, onDone]);

  return (
    <Dialog title="Merge Units" onClose={onClose}>
      <form
        action={action}
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          if (!source || !target || !confirm(`Merge ${label(source)} into ${label(target)}? ${label(source)} will be deleted and all of its history will use ${label(target)}.`)) {
            event.preventDefault();
          }
        }}
      >
        <label className={labelClass}>
          <span className={labelTextClass}>Unit to delete</span>
          <select name="sourceUnitId" value={sourceUnitId} onChange={(event) => setSourceUnitId(event.target.value)} className={inputClass}>
            <option value="">Select a duplicate unit</option>
            {units.filter((unit) => unit.id !== targetUnitId).map((unit) => <option key={unit.id} value={unit.id}>{label(unit)}</option>)}
          </select>
        </label>
        <label className={labelClass}>
          <span className={labelTextClass}>Surviving unit</span>
          <select name="targetUnitId" value={targetUnitId} onChange={(event) => setTargetUnitId(event.target.value)} className={inputClass}>
            <option value="">Select the unit to keep</option>
            {units.filter((unit) => unit.id !== sourceUnitId).map((unit) => <option key={unit.id} value={unit.id}>{label(unit)}</option>)}
          </select>
        </label>
        {source && target && (
          <p className="text-sm text-steel">
            Products, purchases, sales, stock history, pending market purchases, and conversion rules that reference {label(source)} will reference {label(target)} instead.
            Quantities and recorded prices do not change. Direct rules between these two units are removed because they become self-conversions.
          </p>
        )}
        {state?.error && <p className={errorTextClass}>{state.error}</p>}
        <button type="submit" disabled={pending || !source || !target} className={submitClass}>
          {pending ? "Merging…" : "Merge Units"}
        </button>
      </form>
    </Dialog>
  );
}
