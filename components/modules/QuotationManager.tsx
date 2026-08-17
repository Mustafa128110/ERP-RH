"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useNewEntry } from "@/components/layout/KeyboardShortcuts";
import { DataTable } from "@/components/ui/DataTable";
import { Dialog } from "@/components/ui/Dialog";
import { PageHeader } from "@/components/ui/PageHeader";
import { primaryIconButtonClass } from "@/components/ui/form-styles";
import { Icon } from "@/components/ui/Icon";
import { DetailHover } from "@/components/ui/DetailHover";
import { formatDate, money, qty } from "@/lib/format";
import { statusColumn, type ColumnDef, type Row } from "@/lib/table";
import { useCachedOptions } from "@/lib/client-cache";
import type { QuotationListRow } from "@/lib/actions/quotations";
import { QuotationForm } from "@/components/modules/QuotationForm";

const columns: ColumnDef[] = [
  {
    key: "number",
    label: "Number",
    // What was quoted, and how much of it has already gone out on an invoice —
    // which is the whole state of a quotation, and the reason you open one.
    render: (row) => {
      const lines = JSON.parse(String(row.lines ?? "[]")) as { name: string; quantity: string; converted: string }[];
      if (lines.length === 0) return String(row.number);
      return (
        <DetailHover
          trigger={String(row.number)}
          heading={`${lines.length} line${lines.length === 1 ? "" : "s"} · ${row.total}`}
          lines={lines.map((l) => ({
            text: l.name,
            note: Number(l.converted) > 0 ? `${qty(l.converted)} invoiced` : undefined,
            value: qty(l.quantity),
          }))}
          width={320}
        />
      );
    },
  },
  { key: "customer", label: "Customer" },
  { key: "company", label: "Company" },
  { key: "date", label: "Date" },
  { key: "validUntil", label: "Valid Until" },
  { key: "total", label: "Total", align: "right" },
  statusColumn(),
];

export function QuotationManager({
  quotations,
  companyOptions,
  customerOptions,
  itemOptions,
  unitOptions,
}: {
  quotations: QuotationListRow[];
  // The options the add popup's form needs — the same bundle the sale form
  // uses, minus the settlement lists a quotation never touches.
  companyOptions: { id: string; name: string }[];
  customerOptions: { id: string; name: string; companyId: string }[];
  itemOptions: ({ id: string; name: string; companyId: string } & { salesRate: string | null })[];
  unitOptions: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  // Seed the client reference cache from the live options (so an offline form
  // can still fill its pickers) and fall back to the cached copy when the page
  // rendered empty — e.g. a shell served with no data. Live always wins when
  // present, so an online visit is unaffected.
  const cachedCompany = useCachedOptions("companies", companyOptions);
  const cachedCustomers = useCachedOptions("customers", customerOptions);
  const cachedItems = useCachedOptions("items", itemOptions);
  const cachedUnits = useCachedOptions("units", unitOptions);

  const rows: Row[] = quotations.map((q) => ({
    id: q.id,
    number: q.number,
    customer: q.customer ?? "—",
    company: q.company,
    date: formatDate(q.documentDate),
    validUntil: q.validUntil ? formatDate(q.validUntil) : "—",
    total: money(q.grandTotal),
    status: q.status,
    // A Row holds primitives only, so the lines cross as JSON and the renderer
    // parses them back. Same escape hatch the sales list uses for its own panel.
    lines: JSON.stringify(q.lines),
  }));

  const openCount = quotations.filter((q) => q.status === "Open" || q.status === "Partly converted").length;

  useNewEntry(() => setOpen(true));

  function close() {
    setOpen(false);
    router.refresh();
  }

  return (
    <div className="flex h-full flex-col gap-2">
      <PageHeader title="Quotations" subtitle={`${quotations.length} quotation(s) · ${openCount} still open`}>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className={primaryIconButtonClass}
          aria-label="New quotation"
          title="New quotation — Alt+N"
        >
          <Icon name="plus" />
        </button>
      </PageHeader>

      <DataTable
        columns={columns}
        rows={rows}
        idKey="id"
        hrefBase="/sales/quotations"
        emptyMessage="No quotations yet."
        searchPlaceholder="Search quotations…"
      />

      {open && (
        <Dialog title="New Quotation" onClose={close} size="xwide">
          <QuotationForm
            companyOptions={cachedCompany.value}
            customerOptions={cachedCustomers.value}
            itemOptions={cachedItems.value}
            unitOptions={cachedUnits.value}
            onDone={close}
          />
        </Dialog>
      )}
    </div>
  );
}
