"use client";

import { TaxEditForm, DeleteTaxButton, TaxBatchAddDialog } from "@/components/modules/TaxForm";
import { DangerZone, RecordManager } from "@/components/modules/RecordManager";
import { statusColumn, type ColumnDef } from "@/lib/table";

interface Tax {
  id: string;
  name: string;
  rate: string;
  isActive: boolean;
}

const columns: ColumnDef[] = [
  { key: "name", label: "Name" },
  { key: "rate", label: "Rate", align: "right" },
  statusColumn(),
];

export function TaxManager({ taxes }: { taxes: Tax[] }) {
  return (
    <RecordManager
      title="Taxes"
      noun="tax"
      plural="taxes"
      records={taxes}
      columns={columns}
      toRow={(t) => ({ id: t.id, name: t.name, rate: `${t.rate}%`, status: t.isActive ? "Active" : "Inactive" })}
      searchPlaceholder="Search taxes…"
      emptyMessage="No taxes yet."
      dialogTitle={(t) => t.name}
      renderBatchDialog={({ onClose, onDone }) => <TaxBatchAddDialog onClose={onClose} onDone={onDone} />}
      renderEditBody={({ record, onDone, onSaving, onDeleting }) => (
        <>
          <TaxEditForm taxId={record.id} defaults={record} onDone={onDone} onSaving={onSaving} />
          <DangerZone>
            <DeleteTaxButton taxId={record.id} onDone={onDone} onDeleting={onDeleting} />
          </DangerZone>
        </>
      )}
    />
  );
}
