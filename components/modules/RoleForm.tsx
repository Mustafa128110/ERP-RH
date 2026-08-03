"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { createRole, updateRole, deleteRole, type PermissionCatalog } from "@/lib/actions/roles";
import { inputClass, labelClass, labelTextClass, submitClass, deleteButtonClass, errorTextClass, successTextClass } from "@/components/ui/form-styles";

// The role editor: a name plus the permission grid — one row per module, one
// column per action, a checkbox where the module supports that action. This IS
// the data model (role_permissions), not a preview; ticking a box and saving
// writes it. Column and row "all" toggles keep granting a full role from being
// dozens of clicks.
function PermissionGrid({
  catalog,
  granted,
  onToggle,
  onToggleModule,
  onToggleAction,
}: {
  catalog: PermissionCatalog;
  granted: Set<string>;
  onToggle: (key: string) => void;
  onToggleModule: (module: string, on: boolean) => void;
  onToggleAction: (action: string, on: boolean) => void;
}) {
  const supports = (module: string, action: string) =>
    catalog.modules.find((m) => m.module === module)?.actions.includes(action) ?? false;

  const moduleAllOn = (module: string, actions: string[]) => actions.every((a) => granted.has(`${module}.${a}`));
  const actionAllOn = (action: string) =>
    catalog.modules.filter((m) => m.actions.includes(action)).every((m) => granted.has(`${m.module}.${action}`));

  const label = (s: string) => s.replace(/_/g, " ");

  return (
    <div className="scroll-thin overflow-auto rounded border border-sand">
      <table className="w-full min-w-max border-collapse text-sm">
        <thead>
          <tr className="sticky top-0 z-10 border-b border-sand bg-ivory">
            <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-steel">Module</th>
            {catalog.actions.map((a) => (
              <th key={a} className="px-3 py-2 text-center text-xs font-semibold uppercase tracking-wide text-steel">
                <div className="flex flex-col items-center gap-1">
                  <span>{label(a)}</span>
                  {/* Column toggle: grant this action across every module that has it. */}
                  <input
                    type="checkbox"
                    checked={actionAllOn(a)}
                    onChange={(e) => onToggleAction(a, e.target.checked)}
                    className="h-4 w-4 rounded border-sand"
                    title={`Toggle ${label(a)} for all modules`}
                  />
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {catalog.modules.map(({ module, actions }) => (
            <tr key={module} className="border-b border-sand/60 last:border-0">
              <td className="whitespace-nowrap px-3 py-2 capitalize text-ink">
                <label className="flex items-center gap-2">
                  {/* Row toggle: grant every action this module supports. */}
                  <input
                    type="checkbox"
                    checked={moduleAllOn(module, actions)}
                    onChange={(e) => onToggleModule(module, e.target.checked)}
                    className="h-4 w-4 rounded border-sand"
                    title={`Toggle all for ${label(module)}`}
                  />
                  {label(module)}
                </label>
              </td>
              {catalog.actions.map((a) => {
                const key = `${module}.${a}`;
                return (
                  <td key={a} className="px-3 py-2 text-center">
                    {supports(module, a) ? (
                      <input
                        type="checkbox"
                        checked={granted.has(key)}
                        onChange={() => onToggle(key)}
                        className="h-4 w-4 rounded border-sand accent-navy-800"
                      />
                    ) : (
                      // Module genuinely has no such action (Stock has no delete),
                      // so there's nothing to grant — a dash reads clearer than a
                      // disabled box.
                      <span className="text-sand">—</span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function useGranted(initial: string[], catalog: PermissionCatalog) {
  const [granted, setGranted] = useState<Set<string>>(() => new Set(initial));

  // All valid keys, so the column/row toggles only ever set keys that exist.
  const validKeys = useMemo(() => {
    const s = new Set<string>();
    for (const m of catalog.modules) for (const a of m.actions) s.add(`${m.module}.${a}`);
    return s;
  }, [catalog]);

  const toggle = (key: string) =>
    setGranted((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const toggleModule = (module: string, on: boolean) =>
    setGranted((prev) => {
      const next = new Set(prev);
      for (const a of catalog.modules.find((m) => m.module === module)?.actions ?? []) {
        const key = `${module}.${a}`;
        if (on) next.add(key);
        else next.delete(key);
      }
      return next;
    });

  const toggleAction = (action: string, on: boolean) =>
    setGranted((prev) => {
      const next = new Set(prev);
      for (const m of catalog.modules) {
        if (!m.actions.includes(action)) continue;
        const key = `${m.module}.${action}`;
        if (on) next.add(key);
        else next.delete(key);
      }
      return next;
    });

  const keys = useMemo(() => [...granted].filter((k) => validKeys.has(k)), [granted, validKeys]);

  return { granted, toggle, toggleModule, toggleAction, keys };
}

export function RoleCreateForm({ catalog, onDone }: { catalog: PermissionCatalog; onDone: () => void }) {
  const [state, action, pending] = useActionState(createRole, undefined);
  const { granted, toggle, toggleModule, toggleAction, keys } = useGranted([], catalog);

  useEffect(() => {
    if (state?.success) onDone();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.success]);

  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="permissionKeys" value={JSON.stringify(keys)} />
      <label className={labelClass}>
        <span className={labelTextClass}>Role name</span>
        <input name="name" type="text" required placeholder="Warehouse Manager" className={inputClass} />
      </label>
      <PermissionGrid
        catalog={catalog}
        granted={granted}
        onToggle={toggle}
        onToggleModule={toggleModule}
        onToggleAction={toggleAction}
      />
      {state?.error && <p className={errorTextClass}>{state.error}</p>}
      <button type="submit" disabled={pending} className={submitClass}>
        {pending ? "Creating…" : "Create Role"}
      </button>
    </form>
  );
}

export function RoleEditForm({
  roleId,
  roleName,
  catalog,
  initialKeys,
  onDone,
}: {
  roleId: string;
  roleName: string;
  catalog: PermissionCatalog;
  initialKeys: string[];
  onDone: () => void;
}) {
  const [state, action, pending] = useActionState(updateRole.bind(null, roleId), undefined);
  const { granted, toggle, toggleModule, toggleAction, keys } = useGranted(initialKeys, catalog);

  useEffect(() => {
    if (state?.success) onDone();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.success]);

  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="permissionKeys" value={JSON.stringify(keys)} />
      <label className={labelClass}>
        <span className={labelTextClass}>Role name</span>
        <input name="name" type="text" required defaultValue={roleName} className={inputClass} />
      </label>
      <PermissionGrid
        catalog={catalog}
        granted={granted}
        onToggle={toggle}
        onToggleModule={toggleModule}
        onToggleAction={toggleAction}
      />
      {state?.error && <p className={errorTextClass}>{state.error}</p>}
      {state?.success && <p className={successTextClass}>Saved.</p>}
      <button type="submit" disabled={pending} className={submitClass}>
        {pending ? "Saving…" : "Save"}
      </button>
    </form>
  );
}

export function DeleteRoleButton({ roleId, onDone }: { roleId: string; onDone: () => void }) {
  const [state, action, pending] = useActionState(deleteRole, undefined);

  useEffect(() => {
    if (state?.success) onDone();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.success]);

  return (
    <form action={action} onSubmit={(e) => { if (!confirm("Delete this role?")) e.preventDefault(); }}>
      <input type="hidden" name="roleId" value={roleId} />
      <button type="submit" disabled={pending} className={deleteButtonClass}>
        {pending ? "Deleting…" : "Delete this role"}
      </button>
      {state?.error && <p className={`mt-2 ${errorTextClass}`}>{state.error}</p>}
    </form>
  );
}
