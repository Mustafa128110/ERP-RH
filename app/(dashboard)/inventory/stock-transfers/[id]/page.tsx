import Link from "next/link";
import { notFound } from "next/navigation";
import { getStockTransfer } from "@/lib/actions/stock-transfers";
import { getCompanies, getItemOptions, getLocations, getUnits } from "@/lib/queries/lookups";
import { StockTransferFormPage } from "@/components/modules/StockTransferForm";
import { DeleteStockTransferButton } from "@/components/modules/DeleteStockTransferButton";
import { formatDate } from "@/lib/format";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [transfer, companyOptions, itemRows, unitRows, locationRows] = await Promise.all([
    getStockTransfer(id),
    getCompanies(),
    getItemOptions(),
    getUnits(),
    getLocations(),
  ]);
  if (!transfer) notFound();

  return (
    <div className="flex h-full flex-col gap-4">
      <div className="flex items-start justify-between">
        <div>
          <Link href="/inventory/stock-transfers" className="text-sm text-steel hover:text-navy-800">
            ← Stock Transfers
          </Link>
          <h1 className="mt-1 text-xl text-navy-800">{transfer.number}</h1>
          <p className="text-sm text-steel">
            {formatDate(transfer.documentDate)} · {transfer.status}
          </p>
        </div>
        <DeleteStockTransferButton transferId={transfer.id} />
      </div>

      {/* Editable: saving replays the transfer — the old movements are dropped and
          the new ones written, so stock ends up matching whatever is on screen. */}
      <StockTransferFormPage
        transferId={transfer.id}
        defaults={{
          companyId: transfer.companyId,
          documentDate: transfer.documentDate,
          fromLocationId: transfer.fromLocationId,
          toLocationId: transfer.toLocationId,
          lines: transfer.lines,
        }}
        companyOptions={companyOptions.map((c) => ({ id: c.id, name: c.name }))}
        itemOptions={itemRows.map((i) => ({ id: i.id, name: `${i.name} (${i.sku})`, companyId: i.companyId }))}
        unitOptions={unitRows.map((u) => ({ id: u.id, name: u.symbol ? `${u.name} (${u.symbol})` : u.name }))}
        locationOptions={locationRows.map((l) => ({ id: l.id, name: l.name }))}
      />
    </div>
  );
}
