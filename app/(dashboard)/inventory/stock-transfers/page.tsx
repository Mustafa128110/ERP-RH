import { listStockTransfers } from "@/lib/actions/stock-transfers";
import { getCompanies, getItemOptions, getLocations, getUnits } from "@/lib/queries/lookups";
import { StockTransfersManager } from "@/components/modules/StockTransfersManager";
import { getSession } from "@/lib/auth/session";
import { formatDate } from "@/lib/format";
import type { Row } from "@/lib/table";

export const dynamic = "force-dynamic";

export default async function Page() {
  const [transfers, companyOptions, itemRows, unitRows, locationRows, session] = await Promise.all([
    listStockTransfers(),
    getCompanies(),
    getItemOptions(),
    getUnits(),
    getLocations(),
    getSession(),
  ]);

  // Only show locations the user has warehouse access for
  const warehouseIds = session?.warehouseIds ?? [];
  const accessibleLocations = warehouseIds.length > 0
    ? locationRows.filter((l) => warehouseIds.includes(l.id))
    : locationRows;

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
    <StockTransfersManager
      rows={rows}
      companyOptions={companyOptions.map((c) => ({ id: c.id, name: c.name }))}
      itemOptions={itemRows.map((i) => ({ id: i.id, name: `${i.name} (${i.sku})`, companyId: i.companyId }))}
      unitOptions={unitRows.map((u) => ({ id: u.id, name: u.symbol ? `${u.name} (${u.symbol})` : u.name }))}
      locationOptions={accessibleLocations.map((l) => ({ id: l.id, name: l.name }))}
    />
  );
}
