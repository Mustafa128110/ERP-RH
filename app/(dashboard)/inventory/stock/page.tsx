import { listStockLevels } from "@/lib/actions/stock";
import { getCompanies, getLocations } from "@/lib/queries/lookups";
import { StockFilter } from "@/components/modules/StockFilters";
import { StockLevels } from "@/components/modules/StockLevels";
import { DataTable } from "@/components/ui/DataTable";
import { PageHeader } from "@/components/ui/PageHeader";
import type { ColumnDef, Row } from "@/lib/table";
import { UNASSIGNED_LABEL, UNASSIGNED_LOCATION } from "@/lib/location-constants";
import { money, qty } from "@/lib/format";

// Filtered to one location there is nothing to break down — every row is already
// that location — so the list flattens to one row per item and unit.
const flatColumns: ColumnDef[] = [
  { key: "sku", label: "SKU" },
  { key: "itemName", label: "Product" },
  { key: "company", label: "Company" },
  { key: "location", label: "Location" },
  { key: "onHand", label: "On Hand", align: "right" },
  { key: "valuation", label: "Valuation", align: "right" },
  { key: "status", label: "Status", badge: true },
];

export default async function Page({ searchParams }: { searchParams: Promise<{ location?: string; company?: string }> }) {
  const { location, company } = await searchParams;
  const [items, locationRows, companyRows] = await Promise.all([
    listStockLevels(location || undefined, company || undefined),
    getLocations(),
    getCompanies(),
  ]);

  return (
    <div className="flex h-full flex-col gap-4">
      <PageHeader title="Stock" subtitle={`${items.length} item(s)`}>
        <StockFilter param="company" allLabel="All Companies" options={companyRows.map((c) => ({ id: c.id, name: c.name }))} />
        <StockFilter
          param="location"
          allLabel="All Locations"
          options={locationRows.map((l) => ({ id: l.id, name: l.name }))}
          extraOption={{ value: UNASSIGNED_LOCATION, label: UNASSIGNED_LABEL }}
        />
      </PageHeader>

      {location ? (
        <DataTable
          columns={flatColumns}
          rows={items.flatMap((it) =>
            it.unitTotals.map(
              (u): Row => ({
                id: `${it.itemId}::${u.unit}`,
                sku: it.sku,
                itemName: it.itemName,
                company: it.company,
                location: it.location,
                onHand: `${qty(u.onHand)} ${u.unit}`,
                valuation: money(u.valuation),
                status: u.onHand <= 0 ? "Out" : u.onHand <= it.lowStockQty ? "Low" : "OK",
              }),
            ),
          )}
          idKey="id"
          searchPlaceholder="Search stock…"
        />
      ) : (
        <StockLevels items={items} />
      )}
    </div>
  );
}
