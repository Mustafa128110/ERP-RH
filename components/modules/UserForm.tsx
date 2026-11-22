"use client";

import { createUsersBatch, type UserBatchRow } from "@/lib/actions/users";
import { BatchAddDialog, batchCellClass, batchInputClass } from "@/components/ui/BatchAddDialog";

type BatchRow = { name: string; email: string; password: string; roleId: string; companyId: string };

const emptyBatchRow = (defaultRoleId: string): BatchRow => ({ name: "", email: "", password: "", roleId: defaultRoleId, companyId: "global" });

export function UserBatchAddDialog({
  roleOptions,
  onClose,
  onDone,
}: {
  roleOptions: { id: string; name: string }[];
  companyOptions: { id: string; name: string }[];
  onClose: () => void;
  onDone: () => void;
}) {
  const defaultRoleId = "";

  return (
    <BatchAddDialog<BatchRow>
      preserveDraft={false}
      title="Batch Add Users"
      onClose={onClose}
      onDone={onDone}
      emptyRow={() => emptyBatchRow(defaultRoleId)}
      headers={["Name", "Email", "Password", "Role"]}
      onSubmit={async (rows) => {
        const values: UserBatchRow[] = rows.map((r) => ({
          name: r.name.trim(),
          email: r.email.trim(),
          password: r.password,
          roleId: r.roleId,
          companyId: r.companyId === "global" ? null : r.companyId,
        }));
        return createUsersBatch(values);
      }}
      renderRow={(row, _index, update) => (
        <>
          <td className={batchCellClass}>
            <input value={row.name} onChange={(e) => update({ name: e.target.value })} className={batchInputClass} placeholder="Name" />
          </td>
          <td className={batchCellClass}>
            <input type="email" value={row.email} onChange={(e) => update({ email: e.target.value })} className={batchInputClass} placeholder="Email" />
          </td>
          <td className={batchCellClass}>
            <input
              type="password"
              minLength={10}
              value={row.password}
              onChange={(e) => update({ password: e.target.value })}
              className={batchInputClass}
            />
          </td>
          <td className={batchCellClass}>
            <select required value={row.roleId} onChange={(e) => update({ roleId: e.target.value })} className={batchInputClass}>
              <option value="" disabled>Choose a role</option>
              {roleOptions.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </td>

        </>
      )}
    />
  );
}
