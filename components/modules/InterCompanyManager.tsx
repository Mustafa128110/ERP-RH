"use client";

import { useState } from "react";
import { useNewEntry } from "@/components/layout/KeyboardShortcuts";
import { Dialog } from "@/components/ui/Dialog";
import { DataTable } from "@/components/ui/DataTable";
import { PageHeader } from "@/components/ui/PageHeader";
import { primaryIconButtonClass } from "@/components/ui/form-styles";
import { Icon } from "@/components/ui/Icon";
import type { ColumnDef, Row } from "@/lib/table";
import { InterCompanyFormPage } from "@/components/modules/InterCompanyForm";

const columns: ColumnDef[] = [
  { key: "saleNumber", label: "Sale" },
  { key: "seller", label: "Seller" },
  { key: "buyer", label: "Buyer" },
  { key: "purchaseNumber", label: "Purchase" },
  { key: "date", label: "Date" },
  { key: "total", label: "Total", align: "right" },
  { key: "status", label: "Status", badge: true },
];

type Option = { id: string; name: string };
type ItemOption = Option & { companyId: string; rate: string | null; salesRate: string | null };

export function InterCompanyManager({
  rows,
  companyOptions,
  itemOptions,
  unitOptions,
  locationOptions,
}: {
  rows: Row[];
  companyOptions: Option[];
  itemOptions: ItemOption[];
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
      <PageHeader
        title="Inter-Company Sales"
        subtitle={`${rows.length} sale(s) — one company selling to the other, both sides booked together`}
      >
        <button
          type="button"
          onClick={() => setOpen(true)}
          className={primaryIconButtonClass}
          aria-label="New inter-company sale"
          title="New inter-company sale — Alt+N"
        >
          <Icon name="plus" />
        </button>
      </PageHeader>

      <DataTable
        columns={columns}
        rows={rows}
        idKey="id"
        hrefBase="/inventory/inter-company"
        emptyMessage="No inter-company sales yet."
        searchPlaceholder="Search sales…"
      />

      {open && (
        <Dialog title="New Inter-Company Sale" onClose={close} size="xwide">
          <InterCompanyFormPage
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
