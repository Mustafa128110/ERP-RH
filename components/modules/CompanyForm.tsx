"use client";

import { useActionState, useEffect } from "react";
import { updateCompany, deleteCompany, createCompaniesBatch, type CompanyBatchRow } from "@/lib/actions/companies";
import { inputClass, labelClass, labelTextClass, submitClass, deleteButtonClass, errorTextClass, successTextClass } from "@/components/ui/form-styles";
import { BatchAddDialog, batchCellClass, batchInputClass } from "@/components/ui/BatchAddDialog";
import { optimistically } from "@/lib/optimistic-records";

interface CompanyValues {
  name: string;
  shortName: string | null;
  phone: string | null;
  email: string | null;
  taxNumber: string | null;
  address: string | null;
}

function Fields({ defaults }: { defaults?: CompanyValues }) {
  return (
    <>
      <label className={labelClass}>
        <span className={labelTextClass}>Name</span>
        <input name="name" type="text" required defaultValue={defaults?.name} className={inputClass} />
      </label>
      <label className={labelClass}>
        <span className={labelTextClass}>Short Name</span>
        <input name="shortName" type="text" defaultValue={defaults?.shortName ?? ""} className={inputClass} />
      </label>
      <label className={labelClass}>
        <span className={labelTextClass}>Phone</span>
        <input name="phone" type="text" defaultValue={defaults?.phone ?? ""} className={inputClass} />
      </label>
      <label className={labelClass}>
        <span className={labelTextClass}>Email</span>
        <input name="email" type="email" defaultValue={defaults?.email ?? ""} className={inputClass} />
      </label>
      <label className={labelClass}>
        <span className={labelTextClass}>Tax Number</span>
        <input name="taxNumber" type="text" defaultValue={defaults?.taxNumber ?? ""} className={inputClass} />
      </label>
      <label className={labelClass}>
        <span className={labelTextClass}>Address</span>
        <textarea name="address" rows={3} defaultValue={defaults?.address ?? ""} className={`${inputClass} h-auto min-h-24 py-2`} />
      </label>
    </>
  );
}

export function CompanyEditForm({
  companyId,
  defaults,
  onDone,
  onSaving,
}: {
  companyId: string;
  defaults: CompanyValues;
  onDone?: () => void;
  // The list's hook: the row takes the change and the popup steps aside the moment
  // Save is pressed. Optional — without it this form waits for the server and then
  // closes, as it always did. No matching failure callback is needed: the popup's
  // visibility comes from the list's pending set, which React clears when this
  // action settles. See lib/optimistic-records.ts.
  onSaving?: (formData: FormData) => void;
}) {
  const [state, action, pending] = useActionState(optimistically(updateCompany.bind(null, companyId), onSaving), undefined);

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

type BatchRow = {
  name: string;
  shortName: string;
  phone: string;
  email: string;
  taxNumber: string;
  address: string;
};

const emptyBatchRow = (): BatchRow => ({ name: "", shortName: "", phone: "", email: "", taxNumber: "", address: "" });

export function CompanyBatchAddDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  return (
    <BatchAddDialog<BatchRow>
      title="Batch Add Companies"
      onClose={onClose}
      onDone={onDone}
      emptyRow={emptyBatchRow}
      headers={["Name", "Short Name", "Phone", "Email", "Tax Number", "Address"]}
      onSubmit={async (rows) => {
        const values: CompanyBatchRow[] = rows.map((r) => ({
          name: r.name.trim(),
          shortName: r.shortName.trim() || null,
          phone: r.phone.trim() || null,
          email: r.email.trim() || null,
          taxNumber: r.taxNumber.trim() || null,
          address: r.address.trim() || null,
        }));
        return createCompaniesBatch(values);
      }}
      renderRow={(row, _index, update) => (
        <>
          <td className={batchCellClass}>
            <input value={row.name} onChange={(e) => update({ name: e.target.value })} className={batchInputClass} placeholder="Name" />
          </td>
          <td className={batchCellClass}>
            <input value={row.shortName} onChange={(e) => update({ shortName: e.target.value })} className={batchInputClass} />
          </td>
          <td className={batchCellClass}>
            <input value={row.phone} onChange={(e) => update({ phone: e.target.value })} className={batchInputClass} />
          </td>
          <td className={batchCellClass}>
            <input value={row.email} onChange={(e) => update({ email: e.target.value })} className={batchInputClass} />
          </td>
          <td className={batchCellClass}>
            <input value={row.taxNumber} onChange={(e) => update({ taxNumber: e.target.value })} className={batchInputClass} />
          </td>
          <td className={batchCellClass}>
            <input value={row.address} onChange={(e) => update({ address: e.target.value })} className={batchInputClass} />
          </td>
        </>
      )}
    />
  );
}

export function DeleteCompanyButton({
  companyId,
  onDone,
  onDeleting,
}: {
  companyId: string;
  onDone?: () => void;
  onDeleting?: () => void;
}) {
  // Inside the action, so it runs after the confirm() below has had its say.
  const [state, action, pending] = useActionState(optimistically(deleteCompany, onDeleting), undefined);

  useEffect(() => {
    if (state?.success) onDone?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.success]);

  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (!confirm("Delete this company permanently? This fails if any contacts/items/documents still reference it.")) {
          e.preventDefault();
        }
      }}
    >
      <input type="hidden" name="companyId" value={companyId} />
      <button type="submit" disabled={pending} className={deleteButtonClass}>
        {pending ? "Deleting…" : "Delete this company"}
      </button>
      {state?.error && <p className={`mt-2 ${errorTextClass}`}>{state.error}</p>}
    </form>
  );
}
