"use client";

import { UnitEditForm, DeleteUnitButton, UnitBatchAddDialog } from "@/components/modules/UnitForm";
import { DangerZone, RecordManager } from "@/components/modules/RecordManager";
import type { ColumnDef } from "@/lib/table";

interface Unit {
  id: string;
  name: string;
  symbol: string | null;
}

const columns: ColumnDef[] = [
  { key: "name", label: "Name" },
  { key: "symbol", label: "Symbol" },
];

export function UnitManager({ units }: { units: Unit[] }) {
  return (
    <RecordManager
      title="Units"
      noun="unit"
      records={units}
      columns={columns}
      // A unit typed into a sale line is created name-only; the missing symbol is
      // what flags it incomplete here.
      toRow={(u) => ({ id: u.id, name: u.name, symbol: u.symbol ?? "—", _searchUnit: `${u.name} ${u.symbol ?? ""}`, _incomplete: !u.symbol })}
      searchPlaceholder="Search units…"
      emptyMessage="No units yet."
      dialogTitle={(u) => u.name}
      renderBatchDialog={({ onClose, onDone }) => <UnitBatchAddDialog onClose={onClose} onDone={onDone} />}
      renderEditBody={({ record, onDone, onSaving, onDeleting }) => (
        <>
          <UnitEditForm unitId={record.id} defaults={record} onDone={onDone} onSaving={onSaving} />
          <DangerZone>
            <DeleteUnitButton unitId={record.id} onDone={onDone} onDeleting={onDeleting} />
          </DangerZone>
        </>
      )}
    />
  );
}
