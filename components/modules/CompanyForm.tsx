"use client";
import { saveStatus } from "@/lib/save-status";

import { useActionState, useEffect } from "react";
import { updateCompany } from "@/lib/client-actions/companies";
import { inputClass, labelClass, labelTextClass, submitClass, errorTextClass, successTextClass } from "@/components/ui/form-styles";
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
      {state?.success && <p className={successTextClass}>{saveStatus(state)}</p>}
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
