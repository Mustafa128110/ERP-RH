import {HistoryProvider} from "@/components/ui/HistoryProvider";
import {historyRequest} from "@/lib/history-window";
import { listMarketPurchaseRequestsPage } from "@/lib/actions/market-purchases";
import { getAvailableCheques, getBankAccountOptions, getCashAccountOptions } from "@/lib/queries/lookups";
import { MarketPurchaseManager } from "@/components/modules/MarketPurchaseManager";

export const dynamic = "force-dynamic";

export default async function Page({searchParams}:{searchParams:Promise<Record<string,string|undefined>>}) {
  const params=await searchParams;
  const [requests, bankAccountOptions, cashAccountOptions, chequeOptions] = await Promise.all([
    listMarketPurchaseRequestsPage(historyRequest(params)),
    getBankAccountOptions(),
    getCashAccountOptions(),
    getAvailableCheques(),
  ]);
  return <HistoryProvider info={requests.info}><MarketPurchaseManager requests={requests.records} bankAccountOptions={bankAccountOptions} cashAccountOptions={cashAccountOptions} chequeOptions={chequeOptions} /></HistoryProvider>;
}
