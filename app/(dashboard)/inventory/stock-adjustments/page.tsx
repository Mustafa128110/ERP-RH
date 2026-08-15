import { listStockAdjustments } from "@/lib/actions/stock-adjustments";
import { getCompanies, getItemOptions, getLocations, getUnits } from "@/lib/queries/lookups";
import { StockAdjustmentsManager } from "@/components/modules/StockAdjustmentsManager";
import { formatDate, qty } from "@/lib/format";
import type { Row } from "@/lib/table";

export const dynamic = "force-dynamic";

export default async function Page({ searchParams }: { searchParams: Promise<{ company?: string }> }) {
  const { company } = await searchParams;
  const [adjustments, companyRows, itemRows, unitRows, locationRows] = await Promise.all([
    listStockAdjustments(company || undefined),
    getCompanies(),
    getItemOptions(),
    getUnits(),
    getLocations(),
  ]);

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
    <StockAdjustmentsManager
      rows={rows}
      companyOptions={companyRows.map((c) => ({ id: c.id, name: c.name }))}
      itemOptions={itemRows.map((i) => ({ id: i.id, name: `${i.name} (${i.sku})`, companyId: i.companyId }))}
      unitOptions={unitRows.map((u) => ({ id: u.id, name: u.symbol ? `${u.name} (${u.symbol})` : u.name }))}
      locationOptions={locationRows.map((l) => ({ id: l.id, name: l.name }))}
    />
  );
}
