"use client";

import { useState } from "react";
import { useNewEntry } from "@/components/layout/KeyboardShortcuts";
import { UnitConversionEditForm, DeleteUnitConversionButton, UnitConversionBatchAddDialog } from "@/components/modules/UnitConversionForm";
import { Dialog } from "@/components/ui/Dialog";
import { DataTable } from "@/components/ui/DataTable";
import { PageHeader } from "@/components/ui/PageHeader";
import { primaryIconButtonClass } from "@/components/ui/form-styles";
import { Icon } from "@/components/ui/Icon";
import type { ColumnDef, Row } from "@/lib/table";

interface ConversionListItem {
  id: string;
  multiplier: string;
  itemId: string;
  itemName: string | null;
  itemSku: string | null;
  fromUnitId: string;
  fromUnitName: string | null;
  toUnitId: string;
}

const columns: ColumnDef[] = [
  { key: "item", label: "Item" },
  { key: "fromUnit", label: "From Unit" },
  { key: "baseUnit", label: "Base Unit" },
  { key: "conversion", label: "Stock Conversion" },
];

interface FormOptions {
  itemOptions: { id: string; name: string; sku: string }[];
  unitOptions: { id: string; name: string; symbol: string | null }[];
  companyOptions: { id: string; name: string }[];
}

type ModalState = { kind: "batch" } | { kind: "edit"; id: string } | null;

export function UnitConversionManager({
  conversions,
  getDetail,
  ...options
}: FormOptions & {
  conversions: ConversionListItem[];
  getDetail: (id: string) => Promise<{ companyId: string | null; itemId: string; fromUnitId: string; toUnitId: string; multiplier: string } | null>;
}) {
  const [modal, setModal] = useState<ModalState>(null);
  const [detail, setDetail] = useState<Awaited<ReturnType<typeof getDetail>>>(null);

  function close() {
    setModal(null);
    setDetail(null);
  }

  async function openEdit(id: string) {
    setModal({ kind: "edit", id });
    setDetail(await getDetail(id));
  }

  const rows: Row[] = conversions.map((c) => ({
    id: c.id,
    item: c.itemSku ? `${c.itemSku} — ${c.itemName}` : "—",
    fromUnit: c.fromUnitName ?? "—",
    baseUnit: options.unitOptions.find((unit) => unit.id === c.toUnitId)?.name ?? "—",
    conversion: `1 ${c.fromUnitName ?? "unit"} = ${c.multiplier} ${options.unitOptions.find((unit) => unit.id === c.toUnitId)?.name ?? "base units"}`,
  }));

  useNewEntry(() => setModal({ kind: "batch" }));

  return (
    <div className="flex h-full flex-col gap-2">
      <PageHeader title="Unit Conversions" subtitle={`${conversions.length} conversion(s)`}>
        <button
          type="button"
          onClick={() => setModal({ kind: "batch" })}
          className={primaryIconButtonClass}
          aria-label="Add conversions"
          title="Add conversions — Alt+N"
        >
          <Icon name="plus" />
        </button>
      </PageHeader>

      <DataTable
        columns={columns}
        rows={rows}
        idKey="id"
        onRowClick={(row) => openEdit(String(row.id))}
        emptyMessage="No unit conversions yet."
        searchPlaceholder="Search conversions…"
      />

      {modal?.kind === "batch" && <UnitConversionBatchAddDialog {...options} onClose={() => setModal(null)} onDone={close} />}

      {modal?.kind === "edit" && (
        <Dialog title="Edit Unit Conversion" onClose={close}>
          {detail ? (
            <div className="flex flex-col gap-4">
              <UnitConversionEditForm conversionId={modal.id} defaults={detail} {...options} onDone={close} />
              <div className="rounded border border-error/30 bg-error-tint p-4">
                <DeleteUnitConversionButton conversionId={modal.id} onDone={close} />
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
