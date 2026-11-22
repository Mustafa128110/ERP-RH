import {HistoryProvider} from "@/components/ui/HistoryProvider";
import {historyRequest} from "@/lib/history-window";
import { listStockAdjustmentsPage } from "@/lib/actions/stock-adjustments";
import { getStockFormOptions } from "@/lib/queries/lookups";
import { StockAdjustmentsManager } from "@/components/modules/StockAdjustmentsManager";
import { formatDate, qty } from "@/lib/format";
import type { Row } from "@/lib/table";

export const dynamic = "force-dynamic";

export async function StockAdjustmentHistory({ searchParams }: { searchParams: Promise<Record<string,string|undefined>> }) {
  const params=await searchParams;
  const [adjustments, options] = await Promise.all([listStockAdjustmentsPage(undefined,historyRequest(params)), getStockFormOptions()]);

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
      {...options}
    /></HistoryProvider>
  );
}
