import {HistoryProvider} from "@/components/ui/HistoryProvider";
import {historyRequest} from "@/lib/history-window";
import { listBankAccounts, listCashAccounts, listCheques } from "@/lib/actions/accounts";
import { listCashTransfersPage } from "@/lib/actions/transfers";
import { getCompanies, getContactOptions } from "@/lib/queries/lookups";
import { AccountsManager } from "@/components/modules/AccountsManager";

export default async function AccountsPage({searchParams}:{searchParams:Promise<Record<string,string|undefined>>}) {
 const params=await searchParams;
  const [bankAccounts, cashAccounts, cheques, transfers, companyOptions, contactOptions] = await Promise.all([
    listBankAccounts(),
    listCashAccounts(),
    listCheques(),
    listCashTransfersPage(historyRequest(params)),
    getCompanies(),
    getContactOptions(),
  ]);

  return (
    <HistoryProvider info={transfers.info}><AccountsManager
      bankAccounts={bankAccounts}
      cashAccounts={cashAccounts}
      cheques={cheques}
      transfers={transfers.records}
      companyOptions={companyOptions}
      contactOptions={contactOptions}
    /></HistoryProvider>
  );
}
