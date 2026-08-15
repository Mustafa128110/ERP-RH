import { listInterCompanySales } from "@/lib/actions/inter-company";
import { getCompanies, getItemOptions, getLocations, getUnits } from "@/lib/queries/lookups";
import { InterCompanyManager } from "@/components/modules/InterCompanyManager";
import { formatDate, money } from "@/lib/format";
import type { Row } from "@/lib/table";

export const dynamic = "force-dynamic";

export default async function Page() {
  const [sales, companyRows, itemRows, unitRows, locationRows] = await Promise.all([
    listInterCompanySales(),
    getCompanies(),
    getItemOptions(),
    getUnits(),
    getLocations(),
  ]);

  const rows: Row[] = sales.map((s) => ({
    id: s.id,
    saleNumber: s.saleNumber,
    seller: s.seller,
    buyer: s.buyer,
    purchaseNumber: s.purchaseNumber,
    date: formatDate(s.documentDate),
    total: money(s.grandTotal),
    status: s.status,
  }));

  return (
    <InterCompanyManager
      rows={rows}
      companyOptions={companyRows.map((c) => ({ id: c.id, name: c.name }))}
      itemOptions={itemRows.map((i) => ({ id: i.id, name: i.name, companyId: i.companyId, rate: i.rate, salesRate: i.salesRate }))}
      unitOptions={unitRows.map((u) => ({ id: u.id, name: u.symbol ? `${u.name} (${u.symbol})` : u.name }))}
      locationOptions={locationRows.map((l) => ({ id: l.id, name: l.name }))}
    />
  );
}
