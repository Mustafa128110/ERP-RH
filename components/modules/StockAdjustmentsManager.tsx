"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useNewEntry } from "@/components/layout/KeyboardShortcuts";
import { Dialog } from "@/components/ui/Dialog";
import { DataTable } from "@/components/ui/DataTable";
import { PageHeader } from "@/components/ui/PageHeader";
import { primaryIconButtonClass } from "@/components/ui/form-styles";
import { Icon } from "@/components/ui/Icon";
import type { ColumnDef, Row } from "@/lib/table";
import { StockFilter } from "@/components/modules/StockFilters";
import { StockAdjustmentFormPage } from "@/components/modules/StockAdjustmentForm";

const columns: ColumnDef[] = [
  { key: "number", label: "Number" },
  { key: "company", label: "Company" },
  { key: "location", label: "Location" },
  { key: "reason", label: "Reason" },
  { key: "net", label: "Net Qty", align: "right" },
  { key: "date", label: "Date" },
  { key: "status", label: "Status", badge: true },
];

type Option = { id: string; name: string };
type ScopedOption = Option & { companyId: string };

export function StockAdjustmentsManager({
  rows,
  companyOptions,
  itemOptions,
  unitOptions,
  locationOptions,
}: {
  rows: Row[];
  companyOptions: Option[];
  itemOptions: ScopedOption[];
  unitOptions: Option[];
  locationOptions: Option[];
}) {
  const [open, setOpen] = useState(false);
  const router = useRouter();

  function close() {
    setOpen(false);
    router.refresh();
  }

  useNewEntry(() => setOpen(true));

  return (
    <div className="flex h-full flex-col gap-2">
      <PageHeader title="Stock Adjustments" subtitle={`${rows.length} adjustment(s)`}>
        <StockFilter param="company" allLabel="All Companies" options={companyOptions} />
        <button
          type="button"
          onClick={() => setOpen(true)}
          className={primaryIconButtonClass}
          aria-label="New adjustment"
          title="New adjustment — Alt+N"
        >
          <Icon name="plus" />
        </button>
      </PageHeader>

      <DataTable
        columns={columns}
        rows={rows}
        idKey="id"
        hrefBase="/inventory/stock-adjustments"
        emptyMessage="No stock adjustments yet."
        searchPlaceholder="Search adjustments…"
      />

      {open && (
        <Dialog title="New Stock Adjustment" onClose={close} size="xwide">
          <StockAdjustmentFormPage
            companyOptions={companyOptions}
            itemOptions={itemOptions}
            unitOptions={unitOptions}
            locationOptions={locationOptions}
            onDone={close}
          />
        </Dialog>
      )}
    </div>
  );
}
