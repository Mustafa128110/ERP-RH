"use client";

import { useActionState, useEffect } from "react";
import { updateBrand, deleteBrand, createBrandsBatch, type BrandBatchRow } from "@/lib/actions/brands";
import { inputClass, labelClass, labelTextClass, submitClass, deleteButtonClass, errorTextClass, successTextClass } from "@/components/ui/form-styles";
import { BatchAddDialog, batchCellClass, batchInputClass } from "@/components/ui/BatchAddDialog";
import { optimistically } from "@/lib/optimistic-records";

// Brands are global reference data — no company scope, no company field.
interface BrandValues {
  name: string;
}

function Fields({ defaults }: { defaults?: BrandValues }) {
  return (
    <>
      <label className={labelClass}>
        <span className={labelTextClass}>Name</span>
        <input name="name" type="text" required defaultValue={defaults?.name} className={inputClass} />
      </label>
    </>
  );
}

export function BrandEditForm({
  brandId,
  defaults,
  onDone,
  onSaving,
}: {
  brandId: string;
  defaults: BrandValues;
  onDone?: () => void;
  // The list's hook, optional. Given it, the row changes and the popup steps aside
  // the moment Save is pressed; without it this form waits for the server and then
  // closes, exactly as it always did. See lib/optimistic-records.ts —
  // `optimistically` is what puts the update inside the action, which is the only
  // place React will accept it.
  //
  // There is no matching failure callback: the popup's visibility comes from the
  // list's pending set, and React clears that when this action settles — so an
  // error, or a request to confirm, brings the popup back on its own.
  onSaving?: (formData: FormData) => void;
}) {
  const [state, action, pending] = useActionState(optimistically(updateBrand.bind(null, brandId), onSaving), undefined);

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

type BatchRow = { name: string };

const emptyBatchRow = (): BatchRow => ({ name: "" });

export type CreatedBrand = { id: string; name: string };

export function BrandBatchAddDialog({
  onClose,
  onDone,
  initialRows,
}: {
  onClose: () => void;
  onDone: (created?: CreatedBrand[]) => void;
  initialRows?: number;
}) {
  return (
    <BatchAddDialog<BatchRow, CreatedBrand>
      title="Add Brands"
      onClose={onClose}
      onDone={onDone}
      initialRows={initialRows}
      emptyRow={emptyBatchRow}
      headers={["Name"]}
      onSubmit={async (rows) => {
        const values: BrandBatchRow[] = rows.map((r) => ({ name: r.name.trim() }));
        return createBrandsBatch(values);
      }}
      renderRow={(row, _index, update) => (
        <>
          <td className={batchCellClass}>
            <input value={row.name} onChange={(e) => update({ name: e.target.value })} className={batchInputClass} placeholder="Name" />
          </td>
        </>
      )}
    />
  );
}

export function DeleteBrandButton({
  brandId,
  onDone,
  onDeleting,
}: {
  brandId: string;
  onDone?: () => void;
  onDeleting?: () => void;
}) {
  // onDeleting runs inside the action, which is after the confirm() below has had
  // its say: cancelling the prompt prevents the submit, so the action never runs
  // and the row never moves.
  const [state, action, pending] = useActionState(optimistically(deleteBrand, onDeleting), undefined);

  useEffect(() => {
    if (state?.success) onDone?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.success]);

  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (!confirm("Delete this brand? This fails if items still reference it.")) e.preventDefault();
      }}
    >
      <input type="hidden" name="brandId" value={brandId} />
      <button type="submit" disabled={pending} className={deleteButtonClass}>
        {pending ? "Deleting…" : "Delete this brand"}
      </button>
      {state?.error && <p className={`mt-2 ${errorTextClass}`}>{state.error}</p>}
    </form>
  );
}
