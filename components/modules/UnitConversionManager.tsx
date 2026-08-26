"use client";

import { useState } from "react";
import { useNewEntry } from "@/components/layout/KeyboardShortcuts";
import { DeleteUnitConversionButton, UnitConversionCreateForm, UnitConversionEditForm, UnitRuleProductsForm } from "@/components/modules/UnitConversionForm";
import { Dialog } from "@/components/ui/Dialog";
import { DataTable } from "@/components/ui/DataTable";
import { PageHeader } from "@/components/ui/PageHeader";
import { primaryIconButtonClass } from "@/components/ui/form-styles";
import { Icon } from "@/components/ui/Icon";
import type { ColumnDef, Row } from "@/lib/table";

type ConversionListItem = { id: string; name: string; multiplier: string; fromUnitId: string; fromUnitName: string | null; toUnitId: string; assignedCount: number };
type ItemOption = { id: string; name: string; sku: string };
type UnitOption = { id: string; name: string; symbol: string | null };
type Detail = { id: string; name: string; fromUnitId: string; toUnitId: string; multiplier: string; itemIds: string[] } | null;

const columns: ColumnDef[] = [
  { key: "name", label: "Rule Name" },
  { key: "conversion", label: "Conversion" },
  { key: "products", label: "Products", align: "right" },
];

type ModalState = { kind: "create" } | { kind: "edit"; id: string } | null;

export function UnitConversionManager({ conversions, getDetail, itemOptions, unitOptions }: { conversions: ConversionListItem[]; getDetail: (id: string) => Promise<Detail>; itemOptions: ItemOption[]; unitOptions: UnitOption[] }) {
  const [modal, setModal] = useState<ModalState>(null);
  const [detail, setDetail] = useState<Detail>(null);
  function close() { setModal(null); setDetail(null); }
  async function openEdit(id: string) { setModal({ kind: "edit", id }); setDetail(await getDetail(id)); }
  const unitName = (id: string) => unitOptions.find((unit) => unit.id === id)?.name ?? "unit";
  const rows: Row[] = conversions.map((rule) => ({
    id: rule.id,
    name: rule.name,
    conversion: `1 ${rule.fromUnitName ?? "unit"} = ${rule.multiplier} ${unitName(rule.toUnitId)}`,
    products: rule.assignedCount,
  }));
  useNewEntry(() => setModal({ kind: "create" }));

  return (
    <div className="flex h-full flex-col gap-2">
      <PageHeader title="Unit Rules" subtitle={`${conversions.length} rule(s)`}>
        <button type="button" onClick={() => setModal({ kind: "create" })} className={primaryIconButtonClass} aria-label="Add unit rule" title="Add unit rule — Alt+N"><Icon name="plus" /></button>
      </PageHeader>
      <DataTable columns={columns} rows={rows} idKey="id" onRowClick={(row) => void openEdit(String(row.id))} emptyMessage="No unit rules yet." searchPlaceholder="Search rules…" />
      {modal?.kind === "create" && <Dialog title="Add Unit Rule" onClose={close}><UnitConversionCreateForm unitOptions={unitOptions} onDone={close} /></Dialog>}
      {modal?.kind === "edit" && (
        <Dialog title="Edit Unit Rule" onClose={close}>
          {detail ? (
            <div className="flex flex-col gap-4">
              <UnitConversionEditForm conversionId={modal.id} defaults={detail} unitOptions={unitOptions} onDone={close} />
              <UnitRuleProductsForm ruleId={modal.id} itemIds={detail.itemIds} itemOptions={itemOptions} onDone={close} />
              <div className="rounded border border-error/30 bg-error-tint p-4"><DeleteUnitConversionButton conversionId={modal.id} onDone={close} /></div>
            </div>
          ) : <p className="text-sm text-steel">Loading…</p>}
        </Dialog>
      )}
    </div>
  );
}
