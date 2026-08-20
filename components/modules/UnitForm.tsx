"use client";

import { useActionState, useEffect } from "react";
import { updateUnit, deleteUnit, createUnitsBatch, type UnitBatchRow } from "@/lib/actions/units";
import { inputClass, labelClass, labelTextClass, submitClass, deleteButtonClass, errorTextClass, successTextClass } from "@/components/ui/form-styles";
import { BatchAddDialog, batchCellClass, batchInputClass } from "@/components/ui/BatchAddDialog";

interface UnitValues {
  name: string;
  symbol: string | null;
}

function Fields({ defaults }: { defaults?: UnitValues }) {
  return (
    <>
      <label className={labelClass}>
        <span className={labelTextClass}>Name</span>
        <input name="name" type="text" required defaultValue={defaults?.name} className={inputClass} />
      </label>
      <label className={labelClass}>
        <span className={labelTextClass}>Symbol</span>
        <input name="symbol" type="text" defaultValue={defaults?.symbol ?? ""} className={inputClass} />
      </label>
    </>
  );
}

export function UnitEditForm({
  unitId,
  defaults,
  onDone,
}: {
  unitId: string;
  defaults: UnitValues;
  onDone?: () => void;
}) {
  const [state, action, pending] = useActionState(updateUnit.bind(null, unitId), undefined);

  useEffect(() => {
    if (state?.success) onDone?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.success]);

  return (
    <form action={action} className="flex flex-col gap-4">
      <Fields defaults={defaults} />
      {state?.error && <p className={errorTextClass}>{state.error}</p>}
      {state?.success && <p className={successTextClass}>Saved.</p>}
      <button
        type="submit"
        disabled={pending}
        className={submitClass}
      >
        {pending ? "Saving…" : "Save"}
      </button>
    </form>
  );
}

type BatchRow = { name: string; symbol: string };

const emptyBatchRow = (): BatchRow => ({ name: "", symbol: "" });

export type CreatedUnit = { id: string; name: string; symbol: string | null };

export function UnitBatchAddDialog({
  onClose,
  onDone,
  initialRows,
}: {
  onClose: () => void;
  onDone: (created?: CreatedUnit[]) => void;
  initialRows?: number;
}) {
  return (
    <BatchAddDialog<BatchRow, CreatedUnit>
      title="Add Units"
      onClose={onClose}
      onDone={onDone}
      initialRows={initialRows}
      emptyRow={emptyBatchRow}
      headers={["Name", "Symbol"]}
      onSubmit={async (rows) => {
        const values: UnitBatchRow[] = rows.map((r) => ({ name: r.name.trim(), symbol: r.symbol.trim() }));
        return createUnitsBatch(values);
      }}
      renderRow={(row, _index, update) => (
        <>
          <td className={batchCellClass}>
            <input value={row.name} onChange={(e) => update({ name: e.target.value })} className={batchInputClass} placeholder="Kilogram" />
          </td>
          <td className={batchCellClass}>
            <input value={row.symbol} onChange={(e) => update({ symbol: e.target.value })} className={batchInputClass} placeholder="kg" />
          </td>
        </>
      )}
    />
  );
}

export function DeleteUnitButton({ unitId, onDone }: { unitId: string; onDone?: () => void }) {
  const [state, action, pending] = useActionState(deleteUnit, undefined);

  useEffect(() => {
    if (state?.success) onDone?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.success]);

  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (!confirm("Delete this unit? This fails if items or unit conversions still reference it.")) e.preventDefault();
      }}
    >
      <input type="hidden" name="unitId" value={unitId} />
      <button type="submit" disabled={pending} className={deleteButtonClass}>
        {pending ? "Deleting…" : "Delete this unit"}
      </button>
      {state?.error && <p className={`mt-2 ${errorTextClass}`}>{state.error}</p>}
    </form>
  );
}
