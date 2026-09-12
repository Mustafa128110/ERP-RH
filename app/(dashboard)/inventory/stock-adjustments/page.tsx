import {HistoryProvider} from "@/components/ui/HistoryProvider";
import {historyRequest} from "@/lib/history-window";
import { listStockAdjustmentsPage } from "@/lib/actions/stock-adjustments";
import { getCompanies, getItemOptions, getLocations, getUnits } from "@/lib/queries/lookups";
import { StockAdjustmentsManager } from "@/components/modules/StockAdjustmentsManager";
import { getSession } from "@/lib/auth/session";
import { formatDate, qty } from "@/lib/format";
import type { Row } from "@/lib/table";

export const dynamic = "force-dynamic";

export default async function Page({ searchParams }: { searchParams: Promise<Record<string,string|undefined>> }) {
  const params=await searchParams; const {company}=params;
  const [adjustments, companyRows, itemRows, unitRows, locationRows, session] = await Promise.all([
    listStockAdjustmentsPage(company || undefined,historyRequest(params)),
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

  const rows: Row[] = adjustments.records.map((a) => ({
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
    <HistoryProvider info={adjustments.info}><StockAdjustmentsManager
      rows={rows}
      companyOptions={companyRows.map((c) => ({ id: c.id, name: c.name }))}
      itemOptions={itemRows.map((i) => ({ id: i.id, name: `${i.name} (${i.sku})`, companyId: i.companyId }))}
      unitOptions={unitRows.map((u) => ({ id: u.id, name: u.symbol ? `${u.name} (${u.symbol})` : u.name }))}
      locationOptions={accessibleLocations.map((l) => ({ id: l.id, name: l.name }))}
    /></HistoryProvider>
  );
}
