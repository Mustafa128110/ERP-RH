import {HistoryProvider} from "@/components/ui/HistoryProvider";
import {historyRequest} from "@/lib/history-window";
import { listQuotationsPage } from "@/lib/actions/quotations";
import { getSaleFormOptions } from "@/lib/queries/lookups";
import { QuotationManager } from "@/components/modules/QuotationManager";

export const dynamic = "force-dynamic";

export default async function Page({searchParams}:{searchParams:Promise<Record<string,string|undefined>>}) {
  const params=await searchParams;
  const [quotations, options] = await Promise.all([listQuotationsPage(historyRequest(params)), getSaleFormOptions()]);
  return (
    <HistoryProvider info={quotations.info}><QuotationManager
      quotations={quotations.records}
      companyOptions={options.companyOptions}
      customerOptions={options.customerOptions}
      itemOptions={options.itemOptions}
      unitOptions={options.unitOptions}
      taxOptions={options.taxOptions}
      conversionOptions={options.conversionOptions}
      taxSettings={options.taxSettings}
    /></HistoryProvider>
  );
}
