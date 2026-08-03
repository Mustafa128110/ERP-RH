import Link from "next/link";
import { listInterCompanySales } from "@/lib/actions/inter-company";
import { DataTable } from "@/components/ui/DataTable";
import type { ColumnDef, Row } from "@/lib/table";
import { formatDate, money } from "@/lib/format";

export const dynamic = "force-dynamic";

const columns: ColumnDef[] = [
  { key: "saleNumber", label: "Sale" },
  { key: "seller", label: "Seller" },
  { key: "buyer", label: "Buyer" },
  { key: "purchaseNumber", label: "Purchase" },
  { key: "date", label: "Date" },
  { key: "total", label: "Total", align: "right" },
  { key: "status", label: "Status", badge: true },
];

export default async function Page() {
  const sales = await listInterCompanySales();

  const rows: Row[] = sales.map((s) => ({
    id: s.id,
    saleNumber: s.saleNumber,
    seller: s.seller,
    buyer: s.buyer,
    purchaseNumber: s.purchaseNumber,
    date: formatDate(s.documentDate),
    total: money(s.grandTotal),
    status: s.status,
  }));

  return (
    <div className="flex h-full flex-col gap-4">
      <div className="flex shrink-0 items-center justify-between">
        <div>
          <h1 className="text-xl text-navy-800">Inter-Company Sales</h1>
          <p className="text-sm text-steel">{sales.length} sale(s) — one company selling to the other, both sides booked together</p>
        </div>
        <Link
          href="/inventory/inter-company/new"
          className="flex h-11 items-center rounded bg-navy-800 px-5 text-sm font-semibold text-white hover:bg-navy-700"
        >
          + New Inter-Company Sale
        </Link>
      </div>

      <DataTable
        columns={columns}
        rows={rows}
        idKey="id"
        hrefBase="/inventory/inter-company"
        emptyMessage="No inter-company sales yet."
        searchPlaceholder="Search sales…"
      />
    </div>
  );
}
