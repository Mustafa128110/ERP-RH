"use client";

import { useActionState, useEffect } from "react";
import { updateLocation, deleteLocation, createLocationsBatch, type LocationBatchRow } from "@/lib/actions/locations";
import { inputClass, labelClass, labelTextClass, submitClass, deleteButtonClass, errorTextClass, successTextClass } from "@/components/ui/form-styles";
import { BatchAddDialog, batchCellClass, batchInputClass } from "@/components/ui/BatchAddDialog";
import { optimistically } from "@/lib/optimistic-records";

// Must match locationTypeEnum in lib/db/schema.ts.
const LOCATION_TYPES = ["shop", "warehouse", "transit", "damaged", "reserved"] as const;

// Locations are global — shops/warehouses shared across companies. Per-user
// access is still modelled by user_warehouse_access. No company field.
interface LocationValues {
  name: string;
  code: string | null;
  locationType: string;
}

function Fields({ defaults }: { defaults?: LocationValues }) {
  return (
    <>
      <label className={labelClass}>
        <span className={labelTextClass}>Name</span>
        <input name="name" type="text" required defaultValue={defaults?.name} className={inputClass} />
      </label>
      <label className={labelClass}>
        <span className={labelTextClass}>Code</span>
        <input name="code" type="text" defaultValue={defaults?.code ?? ""} className={inputClass} />
      </label>
      <label className={labelClass}>
        <span className={labelTextClass}>Type</span>
        <select name="locationType" required defaultValue={defaults?.locationType ?? ""} className={inputClass}>
          <option value="" disabled>
            Select a type
          </option>
          {LOCATION_TYPES.map((t) => (
            <option key={t} value={t}>
              {t[0].toUpperCase() + t.slice(1)}
            </option>
          ))}
        </select>
      </label>
    </>
  );
}

export function LocationEditForm({
  locationId,
  defaults,
  onDone,
  onSaving,
}: {
  locationId: string;
  defaults: LocationValues;
  onDone?: () => void;
  // The list's hook: the row takes the change and the popup steps aside the moment
  // Save is pressed. Optional — without it this form waits for the server and then
  // closes, as it always did. No matching failure callback is needed: the popup's
  // visibility comes from the list's pending set, which React clears when this
  // action settles. See lib/optimistic-records.ts.
  onSaving?: (formData: FormData) => void;
}) {
  const [state, action, pending] = useActionState(optimistically(updateLocation.bind(null, locationId), onSaving), undefined);

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

type BatchRow = { name: string; code: string; locationType: string };

const emptyBatchRow = (): BatchRow => ({ name: "", code: "", locationType: "" });

export type CreatedLocation = { id: string; name: string };

export function LocationBatchAddDialog({
  onClose,
  onDone,
  initialRows,
}: {
  onClose: () => void;
  onDone: (created?: CreatedLocation[]) => void;
  initialRows?: number;
}) {
  return (
    <BatchAddDialog<BatchRow, CreatedLocation>
      title="Add Locations"
      onClose={onClose}
      onDone={onDone}
      initialRows={initialRows}
      emptyRow={emptyBatchRow}
      headers={["Name", "Code", "Type"]}
      onSubmit={async (rows) => {
        const values: LocationBatchRow[] = rows.map((r) => ({
          name: r.name.trim(),
          code: r.code.trim() || null,
          locationType: r.locationType as LocationBatchRow["locationType"],
        }));
        return createLocationsBatch(values);
      }}
      renderRow={(row, _index, update) => (
        <>
          <td className={batchCellClass}>
            <input value={row.name} onChange={(e) => update({ name: e.target.value })} className={batchInputClass} placeholder="Name" />
          </td>
          <td className={batchCellClass}>
            <input value={row.code} onChange={(e) => update({ code: e.target.value })} className={batchInputClass} />
          </td>
          <td className={batchCellClass}>
            <select value={row.locationType} onChange={(e) => update({ locationType: e.target.value })} className={batchInputClass}>
              <option value="" disabled>
                Select
              </option>
              {LOCATION_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t[0].toUpperCase() + t.slice(1)}
                </option>
              ))}
            </select>
          </td>
        </>
      )}
    />
  );
}

export function DeleteLocationButton({
  locationId,
  onDone,
  onDeleting,
}: {
  locationId: string;
  onDone?: () => void;
  onDeleting?: () => void;
}) {
  // Inside the action, so it runs after the confirm() below has had its say.
  const [state, action, pending] = useActionState(optimistically(deleteLocation, onDeleting), undefined);

  useEffect(() => {
    if (state?.success) onDone?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.success]);

  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (!confirm("Delete this location? This fails if stock, transactions, or user access still reference it.")) e.preventDefault();
      }}
    >
      <input type="hidden" name="locationId" value={locationId} />
      <button type="submit" disabled={pending} className={deleteButtonClass}>
        {pending ? "Deleting…" : "Delete this location"}
      </button>
      {state?.error && <p className={`mt-2 ${errorTextClass}`}>{state.error}</p>}
    </form>
  );
}
