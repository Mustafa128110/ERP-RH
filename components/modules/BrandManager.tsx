"use client";

import { BrandEditForm, DeleteBrandButton, BrandBatchAddDialog } from "@/components/modules/BrandForm";
import { DangerZone, RecordManager } from "@/components/modules/RecordManager";
import type { ColumnDef } from "@/lib/table";

interface Brand {
  id: string;
  name: string;
}

const columns: ColumnDef[] = [{ key: "name", label: "Name" }];

// Creating is batch-only — the batch dialog handles one row just as well as
// twenty, so a separate single-record create form was redundant. Editing stays
// one-at-a-time, opened by clicking a row.
export function BrandManager({ brands }: { brands: Brand[] }) {
  return (
    <RecordManager
      title="Brands"
      noun="brand"
      records={brands}
      columns={columns}
      toRow={(b) => ({ id: b.id, name: b.name })}
      searchPlaceholder="Search brands…"
      emptyMessage="No brands yet."
      dialogTitle={(b) => b.name}
      renderBatchDialog={({ onClose, onDone }) => <BrandBatchAddDialog onClose={onClose} onDone={onDone} />}
      renderEditBody={({ record, onDone }) => (
        <>
          <BrandEditForm brandId={record.id} defaults={record} onDone={onDone} />
          <DangerZone>
            <DeleteBrandButton brandId={record.id} onDone={onDone} />
          </DangerZone>
        </>
      )}
    />
  );
}
