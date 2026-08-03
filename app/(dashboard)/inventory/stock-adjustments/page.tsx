import Link from "next/link";
import { listStockAdjustments } from "@/lib/actions/stock-adjustments";
import { getCompanies } from "@/lib/queries/lookups";
import { DataTable } from "@/components/ui/DataTable";
import { StockFilter } from "@/components/modules/StockFilters";
import type { ColumnDef, Row } from "@/lib/table";
import { formatDate, qty } from "@/lib/format";

const columns: ColumnDef[] = [
  { key: "number", label: "Number" },
  { key: "company", label: "Company" },
  { key: "location", label: "Location" },
  { key: "reason", label: "Reason" },
  { key: "net", label: "Net Qty", align: "right" },
  { key: "date", label: "Date" },
  { key: "status", label: "Status", badge: true },
];

export default async function Page({ searchParams }: { searchParams: Promise<{ company?: string }> }) {
  const { company } = await searchParams;
  const [adjustments, companyRows] = await Promise.all([listStockAdjustments(company || undefined), getCompanies()]);

  const rows: Row[] = adjustments.map((a) => ({
    id: a.id,
    number: a.number,
    company: a.company,
    location: a.location,
    reason: a.reason ?? "—",
    // Signed on purpose: a write-off should read as negative at a glance.
    net: qty(a.net),
    date: formatDate(a.documentDate),
    status: a.status,
  }));

  return (
    <div className="flex h-full flex-col gap-4">
      <div className="flex shrink-0 items-center justify-between">
        <div>
          <h1 className="text-xl text-navy-800">Stock Adjustments</h1>
          <p className="text-sm text-steel">{adjustments.length} adjustment(s)</p>
        </div>
        <div className="flex items-center gap-2">
          <StockFilter param="company" allLabel="All Companies" options={companyRows.map((c) => ({ id: c.id, name: c.name }))} />
          <Link
            href="/inventory/stock-adjustments/new"
            className="flex h-11 items-center rounded bg-navy-800 px-5 text-sm font-semibold text-white hover:bg-navy-700"
          >
            + New Adjustment
          </Link>
        </div>
      </div>

      <DataTable
        columns={columns}
        rows={rows}
        idKey="id"
        hrefBase="/inventory/stock-adjustments"
        emptyMessage="No stock adjustments yet."
        searchPlaceholder="Search adjustments…"
      />
    </div>
  );
}
