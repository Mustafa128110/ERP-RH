"use client";

import { useState } from "react";
import { useNewEntry } from "@/components/layout/KeyboardShortcuts";
import { Dialog } from "@/components/ui/Dialog";
import { DataTable } from "@/components/ui/DataTable";
import { PageHeader } from "@/components/ui/PageHeader";
import { primaryIconButtonClass } from "@/components/ui/form-styles";
import { Icon } from "@/components/ui/Icon";
import type { ColumnDef, Row } from "@/lib/table";
import { StockTransferFormPage } from "@/components/modules/StockTransferForm";

const columns: ColumnDef[] = [
  { key: "number", label: "Number" },
  { key: "company", label: "Company" },
  { key: "from", label: "From" },
  { key: "to", label: "To" },
  { key: "items", label: "Items", align: "right" },
  { key: "date", label: "Date" },
  { key: "status", label: "Status", badge: true },
];

type Option = { id: string; name: string };
type ScopedOption = Option & { companyId: string };

export function StockTransfersManager({
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

  function close() {
    setOpen(false);
  }

  useNewEntry(() => setOpen(true));

  return (
    <div className="flex h-full flex-col gap-2">
      <PageHeader title="Stock Transfers" subtitle={`${rows.length} transfer(s)`}>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className={primaryIconButtonClass}
          aria-label="New transfer"
          title="New transfer — Alt+N"
        >
          <Icon name="plus" />
        </button>
      </PageHeader>

      <DataTable
        columns={columns}
        rows={rows}
        idKey="id"
        hrefBase="/inventory/stock-transfers"
        emptyMessage="No stock transfers yet."
        searchPlaceholder="Search transfers…"
      />

      {open && (
        <Dialog title="New Stock Transfer" onClose={close} size="xwide">
          <StockTransferFormPage
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
