import {HistoryProvider} from "@/components/ui/HistoryProvider";
import {historyRequest} from "@/lib/history-window";
import { listStockMovementsPage } from "@/lib/actions/stock-movements";
import { StockMovementsManager } from "@/components/modules/StockMovementsManager";
import { ListFilters } from "@/components/ui/ListFilters";

export const dynamic = "force-dynamic";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string,string|undefined>>;
}) {
  const filters = await searchParams;
  const movements = await listStockMovementsPage(filters,historyRequest(filters));

  return (
    <HistoryProvider info={movements.info}><StockMovementsManager
      movements={movements.records}
      filters={
        <ListFilters key="filters" />
      }
    /></HistoryProvider>
  );
}
