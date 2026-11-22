"use client";
import { includeViewPermissions, modulePermissionKeys, presetPermissionKeys, type AccessLevel } from "@/lib/role-permissions";
import { saveStatus } from "@/lib/save-status";

import { useActionState, useEffect, useMemo } from "react";
import { FormRecovery, useRecoveryState } from "@/components/ui/FormRecovery";
import { createRole, updateRole, deleteRole, type PermissionCatalog } from "@/lib/client-actions/roles";
import { inputClass, labelClass, labelTextClass, submitClass, deleteButtonClass, errorTextClass, successTextClass } from "@/components/ui/form-styles";

// The role editor: a name plus the permission grid — one row per area, one
// column per action, a checkbox where the area supports that action. This IS
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
  onToggleModule: (area: string, on: boolean) => void;
  onToggleAction: (action: string, on: boolean) => void;
}) {
  const supports = (area: string, action: string) =>
    catalog.modules.find((m) => m.module === area)?.actions.includes(action) ?? false;

  const moduleAllOn = (area: string, actions: string[]) => actions.every((a) => granted.has(`${area}.${a}`));
  const actionAllOn = (action: string) =>
    catalog.modules.filter((m) => m.actions.includes(action)).every((m) => granted.has(`${m.module}.${action}`));

  const label = (s: string) => s.replace(/_/g, " ");

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-steel">Choose an access level for each area. Work allows viewing, adding and editing. Full access also includes deletion and approval where supported.</p>
      <div className="flex flex-wrap gap-2">{(["sales", "warehouse"] as const).map((preset) => <button type="button" key={preset} onClick={() => { const desired = new Set(presetPermissionKeys(catalog.modules, preset)); for (const area of catalog.modules) for (const action of area.actions) { const key = `${area.module}.${action}`; if (granted.has(key) !== desired.has(key)) onToggle(key); } }} className="rounded border border-navy-800 px-3 py-2 text-xs font-medium text-navy-800">{preset === "sales" ? "Sales entry preset" : "Warehouse preset"}</button>)}{(["none", "view", "work"] as const).map((level) => <button key={level} type="button" onClick={() => { for (const area of catalog.modules) { const desired = new Set(modulePermissionKeys(area, level)); for (const action of area.actions) { const key = `${area.module}.${action}`; if (granted.has(key) !== desired.has(key)) onToggle(key); } } }} className="rounded border border-sand px-3 py-2 text-xs">{level === "none" ? "Clear all" : level === "view" ? "View all" : "Work in all areas"}</button>)}</div>
      <div className="grid gap-2 sm:grid-cols-2">{catalog.modules.filter((area) => area.module !== "companies").map((area) => {
        const keys = area.actions.map((action) => `${area.module}.${action}`);
        const level = (["none", "view", "work", "full"] as const).find((candidate) => { const desired = new Set(modulePermissionKeys(area, candidate)); return keys.every((key) => granted.has(key) === desired.has(key)); }) ?? "custom";
        return <label key={area.module} className="flex items-center justify-between gap-3 rounded border border-sand p-3 text-sm"><span className="capitalize">{area.module.replace(/_/g, " ")}</span><select aria-label={`${area.module} access`} value={level} onChange={(event) => { const desired = new Set(modulePermissionKeys(area, event.target.value as AccessLevel)); for (const key of keys) if (granted.has(key) !== desired.has(key)) onToggle(key); }} className="rounded border border-sand px-2 py-1"><option value="none">No access</option><option value="view">View</option><option value="work">Work</option><option value="full">Full access</option>{level === "custom" && <option value="custom">Custom</option>}</select></label>;
      })}</div>
      <details><summary className="cursor-pointer text-sm font-medium text-navy-800">Advanced permissions</summary>
    <div className="matrix-scroll scroll-thin overflow-auto rounded border border-sand">
      <table className="w-full min-w-max table-fixed border-collapse text-sm">
        <thead>
          <tr className="sticky top-0 z-10 border-b border-sand bg-ivory">
            <th className="w-44 px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-steel">Module</th>
            {catalog.actions.map((a) => (
              <th key={a} className="w-24 px-3 py-2 text-center text-xs font-semibold uppercase tracking-wide text-steel">
                <div className="flex flex-col items-center gap-1">
                  <span>{label(a)}</span>
                  {/* Column toggle: grant this action across every area that has it. */}
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
          {catalog.modules.map(({ module: area, actions }) => (
            <tr key={area} className="border-b border-sand/60 last:border-0">
              <td className="whitespace-nowrap px-3 py-2 capitalize text-ink">
                <label className="flex items-center gap-2">
                  {/* Row toggle: grant every action this area supports. */}
                  <input
                    type="checkbox"
                    checked={moduleAllOn(area, actions)}
                    onChange={(e) => onToggleModule(area, e.target.checked)}
                    className="h-4 w-4 rounded border-sand"
                    title={`Toggle all for ${label(area)}`}
                  />
                  {label(area)}
                </label>
              </td>
              {catalog.actions.map((a) => {
                const key = `${area}.${a}`;
                return (
                  <td key={a} className="px-3 py-2 text-center">
                    {supports(area, a) ? (
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
      </details>
    </div>
  );
}

function useGranted(initial: string[], catalog: PermissionCatalog) {
  const [granted, setGranted] = useRecoveryState<Set<string>>("granted", () => new Set(initial));

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

  const toggleModule = (area: string, on: boolean) =>
    setGranted((prev) => {
      const next = new Set(prev);
      for (const a of catalog.modules.find((m) => m.module === area)?.actions ?? []) {
        const key = `${area}.${a}`;
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

  const keys = useMemo(() => includeViewPermissions([...granted].filter((k) => validKeys.has(k)), catalog.modules), [granted, validKeys, catalog.modules]);

  return { granted, toggle, toggleModule, toggleAction, keys };
}

function RoleCreateFormBody({ catalog, onDone }: { catalog: PermissionCatalog; onDone: () => void }) {
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

export function RoleCreateForm(props: Parameters<typeof RoleCreateFormBody>[0]) {
  return <FormRecovery domain="roles" id="new" revision="0" createAction="roles.createRole"><RoleCreateFormBody {...props} /></FormRecovery>;
}

function RoleEditFormBody({
  roleId,
  roleName,
  catalog,
  initialKeys,
  onDone,
}: {
  roleId: string;
  revision: string;
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
      {state?.success && <p className={successTextClass}>{saveStatus(state)}</p>}
      <button type="submit" disabled={pending} className={submitClass}>
        {pending ? "Saving…" : "Save"}
      </button>
    </form>
  );
}

export function RoleEditForm(props: Parameters<typeof RoleEditFormBody>[0]) {
  return <FormRecovery domain="roles" id={props.roleId} revision={props.revision}><RoleEditFormBody {...props} /></FormRecovery>;
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
