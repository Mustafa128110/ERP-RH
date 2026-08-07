"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useNewEntry } from "@/components/layout/KeyboardShortcuts";
import { getRolePermissionKeys, type PermissionCatalog, type RoleListItem } from "@/lib/actions/roles";
import { RoleCreateForm, RoleEditForm, DeleteRoleButton } from "@/components/modules/RoleForm";
import { Dialog } from "@/components/ui/Dialog";
import { DataTable } from "@/components/ui/DataTable";
import { PageHeader } from "@/components/ui/PageHeader";
import { primaryIconButtonClass } from "@/components/ui/form-styles";
import { Icon } from "@/components/ui/Icon";
import type { ColumnDef, Row } from "@/lib/table";

const columns: ColumnDef[] = [
  { key: "name", label: "Role" },
  { key: "permissions", label: "Permissions", align: "right" },
  { key: "users", label: "Users", align: "right" },
];

type EditState = { role: RoleListItem; keys: string[] } | null;

// Roles are created and edited through the same permission grid — a single
// record with a big matrix, so a dialog rather than the batch template the
// simple master-data pages use.
export function RoleManager({ roles, catalog }: { roles: RoleListItem[]; catalog: PermissionCatalog }) {
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<EditState>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const router = useRouter();

  function close() {
    setCreating(false);
    setEditing(null);
    router.refresh();
  }

  async function openEdit(row: Row) {
    const role = roles.find((r) => r.id === row.id);
    if (!role) return;
    setLoadingId(role.id);
    // The role's current grants are fetched on open so the list query stays a
    // cheap count rather than dragging every role's full permission set.
    const keys = await getRolePermissionKeys(role.id);
    setLoadingId(null);
    setEditing({ role, keys });
  }

  const rows: Row[] = roles.map((r) => ({
    id: r.id,
    name: r.name,
    permissions: r.permissionCount,
    users: r.userCount,
  }));

  useNewEntry(() => setCreating(true));

  return (
    <div className="flex h-full flex-col gap-2">
      <PageHeader title="Roles" subtitle={`${roles.length} role(s)`}>
        <button
          type="button"
          onClick={() => setCreating(true)}
          className={primaryIconButtonClass}
          aria-label="New role"
          title="New role — Alt+N"
        >
          <Icon name="plus" />
        </button>
      </PageHeader>

      <DataTable columns={columns} rows={rows} idKey="id" onRowClick={openEdit} emptyMessage="No roles yet." searchPlaceholder="Search roles…" />
      {loadingId && <p className="text-xs text-steel">Loading…</p>}

      {creating && (
        <Dialog title="New Role" onClose={close} size="wide">
          <RoleCreateForm catalog={catalog} onDone={close} />
        </Dialog>
      )}

      {editing && (
        <Dialog title={editing.role.name} onClose={close} size="wide">
          <div className="flex flex-col gap-4">
            <RoleEditForm
              roleId={editing.role.id}
              roleName={editing.role.name}
              catalog={catalog}
              initialKeys={editing.keys}
              onDone={close}
            />
            <div className="rounded border border-error/30 bg-error-tint p-4">
              <DeleteRoleButton roleId={editing.role.id} onDone={close} />
            </div>
          </div>
        </Dialog>
      )}
    </div>
  );
}
