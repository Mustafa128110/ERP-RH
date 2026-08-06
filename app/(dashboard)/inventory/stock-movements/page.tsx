import { listStockMovements, movementTypes } from "@/lib/actions/stock-movements";
import { getCompanies, getLocations } from "@/lib/queries/lookups";
import { StockMovementsManager } from "@/components/modules/StockMovementsManager";
import { ListFilters } from "@/components/ui/ListFilters";
import { StockFilter } from "@/components/modules/StockFilters";

export const dynamic = "force-dynamic";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ reference?: string; item?: string; location?: string; company?: string; type?: string; from?: string; to?: string }>;
}) {
  const filters = await searchParams;
  const [movements, types, locationRows, companyRows] = await Promise.all([
    listStockMovements(filters),
    movementTypes(),
    getLocations(),
    getCompanies(),
  ]);

  return (
    <StockMovementsManager
      movements={movements}
      filters={
        // ListFilters is here for the date range — reaching past the 500-row cap
        // is what it's for. Finding a row that's already on screen is the table's
        // own search box, which is instant.
        <ListFilters key="filters" nameParam="reference" namePlaceholder="Reference">
          <StockFilter param="type" allLabel="All movements" options={types} />
          <StockFilter param="location" allLabel="All locations" options={locationRows.map((l) => ({ id: l.id, name: l.name }))} />
          <StockFilter param="company" allLabel="All companies" options={companyRows.map((c) => ({ id: c.id, name: c.name }))} />
        </ListFilters>
      }
    />
  );
}
