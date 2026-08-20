import { listMarketPurchaseRequests } from "@/lib/actions/market-purchases";
import { getAvailableCheques, getBankAccountOptions, getCashAccountOptions } from "@/lib/queries/lookups";
import { MarketPurchaseManager } from "@/components/modules/MarketPurchaseManager";

export const dynamic = "force-dynamic";

export default async function Page() {
  const [requests, bankAccountOptions, cashAccountOptions, chequeOptions] = await Promise.all([
    listMarketPurchaseRequests(),
    getBankAccountOptions(),
    getCashAccountOptions(),
    getAvailableCheques(),
  ]);
  return <MarketPurchaseManager requests={requests} bankAccountOptions={bankAccountOptions} cashAccountOptions={cashAccountOptions} chequeOptions={chequeOptions} />;
}
