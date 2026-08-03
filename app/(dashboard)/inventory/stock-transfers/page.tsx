import Link from "next/link";
import { listStockTransfers } from "@/lib/actions/stock-transfers";
import { DataTable } from "@/components/ui/DataTable";
import type { ColumnDef, Row } from "@/lib/table";
import { formatDate } from "@/lib/format";

const columns: ColumnDef[] = [
  { key: "number", label: "Number" },
  { key: "company", label: "Company" },
  { key: "from", label: "From" },
  { key: "to", label: "To" },
  { key: "items", label: "Items", align: "right" },
  { key: "date", label: "Date" },
  { key: "status", label: "Status", badge: true },
];

export default async function Page() {
  const transfers = await listStockTransfers();

  const rows: Row[] = transfers.map((t) => ({
    id: t.id,
    number: t.number,
    company: t.company,
    from: t.from,
    to: t.to,
    items: t.items.length,
    date: formatDate(t.documentDate),
    status: t.status,
  }));

  return (
    <div className="flex h-full flex-col gap-4">
      <div className="flex shrink-0 items-center justify-between">
        <div>
          <h1 className="text-xl text-navy-800">Stock Transfers</h1>
          <p className="text-sm text-steel">{transfers.length} transfer(s)</p>
        </div>
        <Link
          href="/inventory/stock-transfers/new"
          className="flex h-11 items-center rounded bg-navy-800 px-5 text-sm font-semibold text-white hover:bg-navy-700"
        >
          + New Transfer
        </Link>
      </div>

      <DataTable
        columns={columns}
        rows={rows}
        idKey="id"
        hrefBase="/inventory/stock-transfers"
        emptyMessage="No stock transfers yet."
        searchPlaceholder="Search transfers…"
      />
    </div>
  );
}
