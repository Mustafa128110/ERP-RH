"use client";

import { LocationEditForm, DeleteLocationButton, LocationBatchAddDialog } from "@/components/modules/LocationForm";
import { DangerZone, RecordManager } from "@/components/modules/RecordManager";
import type { ColumnDef } from "@/lib/table";

interface Location {
  id: string;
  name: string;
  code: string | null;
  locationType: string;
}

const columns: ColumnDef[] = [
  { key: "name", label: "Name" },
  { key: "code", label: "Code" },
  { key: "type", label: "Type" },
];

export function LocationManager({ locations }: { locations: Location[] }) {
  return (
    <RecordManager
      title="Warehouses & Locations"
      noun="location"
      records={locations}
      columns={columns}
      toRow={(l) => ({
        id: l.id,
        name: l.name,
        code: l.code ?? "—",
        type: l.locationType[0].toUpperCase() + l.locationType.slice(1),
        // A location typed into a purchase line is created name-only, defaulted
        // to warehouse and left without a code — the same way a unit typed into
        // a sale line arrives without a symbol. The missing code flags it here.
        _incomplete: !l.code,
      })}
      searchPlaceholder="Search locations…"
      emptyMessage="No locations yet."
      dialogTitle={(l) => l.name}
      renderBatchDialog={({ onClose, onDone }) => <LocationBatchAddDialog onClose={onClose} onDone={onDone} />}
      renderEditBody={({ record, onDone }) => (
        <>
          <LocationEditForm locationId={record.id} defaults={record} onDone={onDone} />
          <DangerZone>
            <DeleteLocationButton locationId={record.id} onDone={onDone} />
          </DangerZone>
        </>
      )}
    />
  );
}
