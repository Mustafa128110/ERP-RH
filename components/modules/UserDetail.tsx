"use client";

import { useActionState, useEffect, useState } from "react";
import { updateUser, addUserRole, removeUserRole, deleteUser } from "@/lib/actions/users";
import { inputClass, labelClass, labelTextClass, submitClass, deleteButtonClass, errorTextClass, successTextClass } from "@/components/ui/form-styles";

interface Assignment {
  id: string;
  roleId: string;
  roleName: string;
  companyId: string | null;
  companyName: string | null;
}

export function UserEditForm({
  userId,
  name,
  email,
  status,
}: {
  userId: string;
  name: string;
  email: string;
  status: string;
}) {
  const [state, action, pending] = useActionState(updateUser.bind(null, userId), undefined);
  return (
    <form action={action} className="flex flex-col gap-4">
      <label className={labelClass}>
        <span className={labelTextClass}>Name</span>
        <input name="name" type="text" defaultValue={name} required className={inputClass} />
      </label>

      <label className={labelClass}>
        <span className={labelTextClass}>Email</span>
        <input type="email" value={email} disabled className={`${inputClass} bg-ivory text-steel`} />
      </label>

      <label className={labelClass}>
        <span className={labelTextClass}>Status</span>
        <select name="status" defaultValue={status} className={inputClass}>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
          <option value="locked">Locked</option>
        </select>
      </label>

      {state?.error && <p className={errorTextClass}>{state.error}</p>}
      {state?.success && <p className={successTextClass}>Saved.</p>}

      <button type="submit" disabled={pending} className={submitClass}>
        {pending ? "Saving…" : "Save"}
      </button>
    </form>
  );
}

export function UserRoleAssignments({
  userId,
  assignments,
  roleOptions,
  companyOptions,
  onChanged,
}: {
  userId: string;
  assignments: Assignment[];
  roleOptions: { id: string; name: string }[];
  companyOptions: { id: string; name: string }[];
  onChanged: () => void;
}) {
  const [state, action, pending] = useActionState(addUserRole.bind(null, userId), undefined);
  // Removing a role is one small form per row, so it can't use useActionState —
  // and its failure used to be dropped on the floor, leaving the row on screen
  // with no hint that nothing had happened.
  const [removeError, setRemoveError] = useState<string | null>(null);

  useEffect(() => {
    if (state && !state.error) onChanged();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-sand bg-ivory p-5">
      <h3 className="font-display text-sm font-semibold text-navy-800">Role Assignments</h3>

      {assignments.length === 0 ? (
        <p className="text-sm text-steel">No roles assigned — this user can&apos;t do anything yet.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {assignments.map((a) => (
            <li key={a.id} className="flex items-center justify-between rounded border border-sand bg-white px-3 py-2 text-sm">
              <span className="text-ink">
                {a.roleName} — {a.companyName ?? "Global (all companies)"}
              </span>
              <form
                action={async (formData) => {
                  setRemoveError(null);
                  const result = await removeUserRole(formData);
                  if (result.error) setRemoveError(result.error);
                  else onChanged();
                }}
              >
                <input type="hidden" name="assignmentId" value={a.id} />
                <input type="hidden" name="userId" value={userId} />
                <button type="submit" className="text-xs font-medium text-error hover:underline">
                  Remove
                </button>
              </form>
            </li>
          ))}
        </ul>
      )}

      <form action={action} className="flex flex-wrap items-end gap-3 border-t border-sand pt-4">
        <label className={labelClass}>
          <span className={labelTextClass}>Role</span>
          <select name="roleId" required className={`${inputClass} h-11`}>
            {roleOptions.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </label>
        <label className={labelClass}>
          <span className={labelTextClass}>Company</span>
          <select name="companyId" className={`${inputClass} h-11`}>
            <option value="global">Global (all companies)</option>
            {companyOptions.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <button
          type="submit"
          disabled={pending}
          className="h-11 rounded border border-navy-800 px-4 text-sm font-semibold text-navy-800 hover:bg-navy-100 disabled:opacity-40"
        >
          {pending ? "Adding…" : "+ Add"}
        </button>
      </form>
      {state?.error && <p className={errorTextClass}>{state.error}</p>}
      {removeError && <p className={errorTextClass}>{removeError}</p>}
    </div>
  );
}

export function DeleteUserButton({ userId, onDone }: { userId: string; onDone?: () => void }) {
  const [state, action, pending] = useActionState(deleteUser, undefined);

  useEffect(() => {
    if (state?.success) onDone?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.success]);

  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (!confirm("Delete this user permanently? This also removes their Supabase Auth account.")) {
          e.preventDefault();
        }
      }}
    >
      <input type="hidden" name="userId" value={userId} />
      <button type="submit" disabled={pending} className={deleteButtonClass}>
        {pending ? "Deleting…" : "Delete this user"}
      </button>
      {state?.error && <p className={`mt-2 ${errorTextClass}`}>{state.error}</p>}
    </form>
  );
}
