"use client";

import { useActionState } from "react";
import { saveSettings } from "@/lib/actions/settings";
import type { SettingDef } from "@/lib/setting-constants";
import { errorTextClass, inputClass, labelClass, labelTextClass, submitClass, successTextClass } from "@/components/ui/form-styles";

// One form rendered from SETTING_DEFS, so adding a setting is one entry in
// lib/actions/settings.ts rather than a field here, a read there and a write in
// a third place.
export function SettingsForm({
  companyId,
  defs,
  values,
  taxOptions,
}: {
  companyId: string;
  defs: SettingDef[];
  values: Record<string, string>;
  taxOptions: { id: string; name: string; rate: string }[];
}) {
  const [state, action, pending] = useActionState(saveSettings.bind(null, companyId), undefined);

  return (
    // key on companyId: switching company has to re-seed every defaultValue,
    // and an uncontrolled input keeps whatever was typed unless React is told
    // this is a different form.
    <form key={companyId} action={action} className="flex flex-col gap-5">
      {defs.map((def) => (
        <label key={def.key} className={labelClass}>
          <span className={labelTextClass}>{def.label}</span>
          <span className="text-xs text-steel">{def.help}</span>
          <span className="flex items-center gap-2">
            {def.kind === "text" ? (
              <textarea name={def.key} defaultValue={values[def.key]} rows={2} className="w-full rounded border border-sand p-3 text-sm text-ink focus:border-navy-800" />
            ) : def.kind === "tax" ? (
              <select name={def.key} defaultValue={values[def.key]} className={`${inputClass} w-72`}>
                <option value="">No default tax</option>
                {taxOptions.map((tax) => (
                  <option key={tax.id} value={tax.id}>{tax.name} ({tax.rate}%)</option>
                ))}
              </select>
            ) : def.kind === "boolean" ? (
              <input name={def.key} type="checkbox" defaultChecked={values[def.key] === "true"} className="h-5 w-5 rounded border-sand" />
            ) : def.kind === "date" ? (
              <input name={def.key} type="date" defaultValue={values[def.key]} className={`${inputClass} w-48`} />
            ) : (
              <input name={def.key} type="number" step="any" min="0" defaultValue={values[def.key]} className={`${inputClass} w-40`} />
            )}
            {def.suffix && <span className="text-sm text-steel">{def.suffix}</span>}
          </span>
        </label>
      ))}

      {state?.error && <p className={errorTextClass}>{state.error}</p>}
      {state?.success && <p className={successTextClass}>Saved.</p>}

      <button type="submit" disabled={pending} className={submitClass}>
        {pending ? "Saving…" : "Save Settings"}
      </button>
    </form>
  );
}
