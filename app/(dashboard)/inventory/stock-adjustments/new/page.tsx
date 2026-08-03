import Link from "next/link";
import { getCompanies, getItemOptions, getLocations, getUnits } from "@/lib/queries/lookups";
import { StockAdjustmentFormPage } from "@/components/modules/StockAdjustmentForm";

// Same reason as /sales/new: nothing here would otherwise touch a request-time
// API, so it'd try to prerender (and hit the DB) at build time.
export const dynamic = "force-dynamic";

export default async function Page() {
  const [companyOptions, itemRows, unitRows, locationRows] = await Promise.all([
    getCompanies(),
    getItemOptions(),
    getUnits(),
    getLocations(),
  ]);

  return (
    <div className="flex h-full flex-col gap-4">
      <div>
        <Link href="/inventory/stock-adjustments" className="text-sm text-steel hover:text-navy-800">
          ← Stock Adjustments
        </Link>
        <h1 className="mt-1 text-xl text-navy-800">New Stock Adjustment</h1>
      </div>

      <StockAdjustmentFormPage
        companyOptions={companyOptions.map((c) => ({ id: c.id, name: c.name }))}
        itemOptions={itemRows.map((i) => ({ id: i.id, name: `${i.name} (${i.sku})`, companyId: i.companyId }))}
        unitOptions={unitRows.map((u) => ({ id: u.id, name: u.symbol ? `${u.name} (${u.symbol})` : u.name }))}
        locationOptions={locationRows.map((l) => ({ id: l.id, name: l.name }))}
      />
    </div>
  );
}
