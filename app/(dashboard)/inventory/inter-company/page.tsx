import {HistoryProvider} from "@/components/ui/HistoryProvider";
import {historyRequest} from "@/lib/history-window";
import { listInterCompanySalesPage } from "@/lib/actions/inter-company";
import { getCompanies, getItemOptions, getLocations, getUnits } from "@/lib/queries/lookups";
import { InterCompanyManager } from "@/components/modules/InterCompanyManager";
import { formatDate, money } from "@/lib/format";
import type { Row } from "@/lib/table";

export const dynamic = "force-dynamic";

export default async function Page({searchParams}:{searchParams:Promise<Record<string,string|undefined>>}) {
 const params=await searchParams;
  const [sales, companyRows, itemRows, unitRows, locationRows] = await Promise.all([
    listInterCompanySalesPage(historyRequest(params)),
    getCompanies(),
    getItemOptions(),
    getUnits(),
    getLocations(),
  ]);

  const rows: Row[] = sales.records.map((s) => ({
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
    <HistoryProvider info={sales.info}><InterCompanyManager
      rows={rows}
      companyOptions={companyRows.map((c) => ({ id: c.id, name: c.name }))}
      itemOptions={itemRows.map((i) => ({ id: i.id, name: i.name, companyId: i.companyId, rate: i.rate, salesRate: i.salesRate }))}
      unitOptions={unitRows.map((u) => ({ id: u.id, name: u.symbol ? `${u.name} (${u.symbol})` : u.name }))}
      locationOptions={locationRows.map((l) => ({ id: l.id, name: l.name }))}
    /></HistoryProvider>
  );
}
