"use client";

import { useActionState, useEffect } from "react";
import { updateTax, deleteTax, createTaxesBatch, type TaxBatchRow } from "@/lib/actions/taxes";
import { inputClass, labelClass, labelTextClass, submitClass, deleteButtonClass, errorTextClass, successTextClass } from "@/components/ui/form-styles";
import { BatchAddDialog, batchCellClass, batchInputClass } from "@/components/ui/BatchAddDialog";
import { optimistically } from "@/lib/optimistic-records";

// Taxes are global reference data — no company scope, so no company field.
interface TaxValues {
  name: string;
  rate: string;
  isActive: boolean;
}

function Fields({ defaults }: { defaults?: TaxValues }) {
  return (
    <>
      <label className={labelClass}>
        <span className={labelTextClass}>Name</span>
        <input name="name" type="text" required defaultValue={defaults?.name} className={inputClass} />
      </label>
      <label className={labelClass}>
        <span className={labelTextClass}>Rate (%)</span>
        <input name="rate" type="number" step="0.0001" required defaultValue={defaults?.rate} className={inputClass} />
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input name="isActive" type="checkbox" defaultChecked={defaults?.isActive ?? true} className="h-5 w-5 rounded border-sand" />
        <span className={labelTextClass}>Active</span>
      </label>
    </>
  );
}

export function TaxEditForm({
  taxId,
  defaults,
  onDone,
  onSaving,
}: {
  taxId: string;
  defaults: TaxValues;
  onDone?: () => void;
  // The list's hook: the row takes the change and the popup steps aside the moment
  // Save is pressed. Optional — without it this form waits for the server and then
  // closes, as it always did. No matching failure callback is needed: the popup's
  // visibility comes from the list's pending set, which React clears when this
  // action settles. See lib/optimistic-records.ts.
  onSaving?: (formData: FormData) => void;
}) {
  const [state, action, pending] = useActionState(optimistically(updateTax.bind(null, taxId), onSaving), undefined);

  useEffect(() => {
    if (state?.success) onDone?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.success]);

  return (
    <form action={action} className="flex flex-col gap-4">
      <Fields defaults={defaults} />
      {state?.error && <p className={errorTextClass}>{state.error}</p>}
      {state?.success && <p className={successTextClass}>Saved.</p>}
      <button type="submit" disabled={pending} className={submitClass}>
        {pending ? "Saving…" : "Save"}
      </button>
    </form>
  );
}

type BatchRow = { name: string; rate: string; isActive: boolean };

const emptyBatchRow = (): BatchRow => ({ name: "", rate: "0", isActive: true });

export function TaxBatchAddDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  return (
    <BatchAddDialog<BatchRow>
      title="Add Taxes"
      onClose={onClose}
      onDone={onDone}
      emptyRow={emptyBatchRow}
      headers={["Name", "Rate (%)", "Active"]}
      onSubmit={async (rows) => {
        const values: TaxBatchRow[] = rows.map((r) => ({ name: r.name.trim(), rate: r.rate, isActive: r.isActive }));
        return createTaxesBatch(values);
      }}
      renderRow={(row, _index, update) => (
        <>
          <td className={batchCellClass}>
            <input value={row.name} onChange={(e) => update({ name: e.target.value })} className={batchInputClass} placeholder="GST" />
          </td>
          <td className={batchCellClass}>
            <input type="number" step="0.0001" value={row.rate} onChange={(e) => update({ rate: e.target.value })} className={batchInputClass} />
          </td>
          <td className={`${batchCellClass} text-center`}>
            <input type="checkbox" checked={row.isActive} onChange={(e) => update({ isActive: e.target.checked })} className="h-5 w-5 rounded border-sand" />
          </td>
        </>
      )}
    />
  );
}

export function DeleteTaxButton({
  taxId,
  onDone,
  onDeleting,
}: {
  taxId: string;
  onDone?: () => void;
  onDeleting?: () => void;
}) {
  // Inside the action, so it runs after the confirm() below has had its say.
  const [state, action, pending] = useActionState(optimistically(deleteTax, onDeleting), undefined);

  useEffect(() => {
    if (state?.success) onDone?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.success]);

  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (!confirm("Delete this tax? This fails if document lines still reference it.")) e.preventDefault();
      }}
    >
      <input type="hidden" name="taxId" value={taxId} />
      <button type="submit" disabled={pending} className={deleteButtonClass}>
        {pending ? "Deleting…" : "Delete this tax"}
      </button>
      {state?.error && <p className={`mt-2 ${errorTextClass}`}>{state.error}</p>}
    </form>
  );
}
