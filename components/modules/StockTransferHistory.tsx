import {HistoryProvider} from "@/components/ui/HistoryProvider";
import {historyRequest} from "@/lib/history-window";
import { listStockTransfersPage } from "@/lib/actions/stock-transfers";
import { getStockFormOptions } from "@/lib/queries/lookups";
import { StockTransfersManager } from "@/components/modules/StockTransfersManager";
import { formatDate } from "@/lib/format";
import type { Row } from "@/lib/table";

export const dynamic = "force-dynamic";

export async function StockTransferHistory({searchParams}:{searchParams:Promise<Record<string,string|undefined>>}) {
  const params=await searchParams;
  const [transfers, options] = await Promise.all([listStockTransfersPage(historyRequest(params)), getStockFormOptions()]);

  const rows: Row[] = transfers.records.map((t) => ({
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
    <HistoryProvider info={transfers.info}><StockTransfersManager
      rows={rows}
      {...options}
    /></HistoryProvider>
  );
}
