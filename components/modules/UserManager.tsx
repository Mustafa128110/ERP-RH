"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useNewEntry } from "@/components/layout/KeyboardShortcuts";
import { getUserDetail, type UserListItem } from "@/lib/actions/users";
import { UserBatchAddDialog } from "@/components/modules/UserForm";
import { UserEditForm, UserRoleAssignments, DeleteUserButton } from "@/components/modules/UserDetail";
import { Dialog } from "@/components/ui/Dialog";
import { DataTable } from "@/components/ui/DataTable";
import { PageHeader } from "@/components/ui/PageHeader";
import { primaryIconButtonClass } from "@/components/ui/form-styles";
import { Icon } from "@/components/ui/Icon";
import type { ColumnDef, Row } from "@/lib/table";

const columns: ColumnDef[] = [
  { key: "name", label: "Name" },
  { key: "email", label: "Email" },
  { key: "roles", label: "Roles" },
  { key: "status", label: "Status", badge: true },
];

type Detail = Awaited<ReturnType<typeof getUserDetail>>;
type ModalState = { kind: "batch" } | { kind: "edit"; id: string } | null;

export function UserManager({
  users,
  roleOptions,
  companyOptions,
}: {
  users: UserListItem[];
  roleOptions: { id: string; name: string }[];
  companyOptions: { id: string; name: string }[];
}) {
  const [modal, setModal] = useState<ModalState>(null);
  const [detail, setDetail] = useState<Detail>(null);
  const router = useRouter();

  function close() {
    setModal(null);
    setDetail(null);
    router.refresh();
  }

  async function openEdit(id: string) {
    setModal({ kind: "edit", id });
    setDetail(await getUserDetail(id));
  }

  async function refreshDetail() {
    if (modal?.kind === "edit") setDetail(await getUserDetail(modal.id));
  }

  const rows: Row[] = users.map((u) => ({
    id: u.id,
    name: u.name,
    email: u.email,
    roles:
      u.roleAssignments.length === 0
        ? "—"
        : u.roleAssignments.map((a) => `${a.roleName}${a.companyName ? ` (${a.companyName})` : " (Global)"}`).join(", "),
    status: u.status.charAt(0).toUpperCase() + u.status.slice(1),
  }));

  useNewEntry(() => setModal({ kind: "batch" }));

  return (
    <div className="flex h-full flex-col gap-2">
      <PageHeader title="Users" subtitle={`${users.length} account(s)`}>
        <button
          type="button"
          onClick={() => setModal({ kind: "batch" })}
          className={primaryIconButtonClass}
          aria-label="Add users"
          title="Add users — Alt+N"
        >
          <Icon name="plus" />
        </button>
      </PageHeader>

      <DataTable
        columns={columns}
        rows={rows}
        idKey="id"
        onRowClick={(row) => openEdit(String(row.id))}
        emptyMessage="No users yet."
        searchPlaceholder="Search users…"
      />

      {modal?.kind === "batch" && (
        <UserBatchAddDialog roleOptions={roleOptions} companyOptions={companyOptions} onClose={() => setModal(null)} onDone={close} />
      )}

      {modal?.kind === "edit" && (
        <Dialog title={detail?.user.name ?? "Edit User"} onClose={close}>
          {detail ? (
            <div className="flex flex-col gap-4">
              <UserEditForm
                userId={modal.id}
                name={detail.user.name}
                email={detail.user.email}
                status={detail.user.status}
              />
              <UserRoleAssignments
                userId={modal.id}
                assignments={detail.assignments}
                roleOptions={roleOptions}
                companyOptions={companyOptions}
                onChanged={refreshDetail}
              />
              <div className="rounded border border-error/30 bg-error-tint p-4">
                <DeleteUserButton userId={modal.id} onDone={close} />
              </div>
            </div>
          ) : (
            <p className="text-sm text-steel">Loading…</p>
          )}
        </Dialog>
      )}
    </div>
  );
}
