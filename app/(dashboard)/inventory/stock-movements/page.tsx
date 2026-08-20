import { listStockMovements } from "@/lib/actions/stock-movements";
import { StockMovementsManager } from "@/components/modules/StockMovementsManager";
import { ListFilters } from "@/components/ui/ListFilters";

export const dynamic = "force-dynamic";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ reference?: string; item?: string; location?: string; company?: string; type?: string; from?: string; to?: string }>;
}) {
  const filters = await searchParams;
  const movements = await listStockMovements(filters);

  return (
    <StockMovementsManager
      movements={movements}
      filters={
        <ListFilters key="filters" />
      }
    />
  );
}
