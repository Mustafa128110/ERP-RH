"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useNewEntry } from "@/components/layout/KeyboardShortcuts";
import { DataTable } from "@/components/ui/DataTable";
import { PageHeader } from "@/components/ui/PageHeader";
import { primaryActionClass } from "@/components/ui/form-styles";
import { DetailHover } from "@/components/ui/DetailHover";
import { formatDate, money, qty } from "@/lib/format";
import { statusColumn, type ColumnDef, type Row } from "@/lib/table";
import type { QuotationListRow } from "@/lib/actions/quotations";

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

export function QuotationManager({ quotations }: { quotations: QuotationListRow[] }) {
  const router = useRouter();
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

  const open = quotations.filter((q) => q.status === "Open" || q.status === "Partly converted").length;

  // No popup here — a quotation is its own page, so Alt+N goes where the button
  // links.
  useNewEntry(() => router.push("/sales/quotations/new"));

  return (
    <div className="flex h-full flex-col gap-4">
      <PageHeader
        title="Quotations"
        subtitle={`${quotations.length} quotation(s) · ${open} still open`}
      >
        <Link href="/sales/quotations/new" className={`flex items-center ${primaryActionClass}`}>
          + New Quotation
        </Link>
      </PageHeader>

      <DataTable
        columns={columns}
        rows={rows}
        idKey="id"
        hrefBase="/sales/quotations"
        emptyMessage="No quotations yet."
        searchPlaceholder="Search quotations…"
      />
    </div>
  );
}
