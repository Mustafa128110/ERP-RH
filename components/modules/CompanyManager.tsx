"use client";

import { CompanyEditForm, DeleteCompanyButton, CompanyBatchAddDialog } from "@/components/modules/CompanyForm";
import { DangerZone, RecordManager } from "@/components/modules/RecordManager";
import type { ColumnDef } from "@/lib/table";

interface Company {
  id: string;
  name: string;
  shortName: string | null;
  phone: string | null;
  email: string | null;
  taxNumber: string | null;
  address: string | null;
}

const columns: ColumnDef[] = [
  { key: "name", label: "Name" },
  { key: "shortName", label: "Short Name" },
  { key: "phone", label: "Phone" },
  { key: "taxNumber", label: "Tax Number" },
];

export function CompanyManager({ companies }: { companies: Company[] }) {
  return (
    <RecordManager
      title="Companies"
      noun="company"
      plural="companies"
      records={companies}
      columns={columns}
      toRow={(c) => ({
        id: c.id,
        name: c.name,
        shortName: c.shortName ?? "—",
        phone: c.phone ?? "—",
        taxNumber: c.taxNumber ?? "—",
      })}
      searchPlaceholder="Search companies…"
      emptyMessage="No companies yet."
      dialogTitle={(c) => c.name}
      renderBatchDialog={({ onClose, onDone }) => <CompanyBatchAddDialog onClose={onClose} onDone={onDone} />}
      renderEditBody={({ record, onDone, onSaving, onDeleting }) => (
        <>
          <CompanyEditForm companyId={record.id} defaults={record} onDone={onDone} onSaving={onSaving} />
          <DangerZone>
            <DeleteCompanyButton companyId={record.id} onDone={onDone} onDeleting={onDeleting} />
          </DangerZone>
        </>
      )}
    />
  );
}
