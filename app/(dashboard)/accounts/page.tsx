import { listBankAccounts, listCashAccounts, listCheques } from "@/lib/actions/accounts";
import { listCashTransfers } from "@/lib/actions/transfers";
import { getCompanies, getContactOptions } from "@/lib/queries/lookups";
import { AccountsManager } from "@/components/modules/AccountsManager";

export default async function AccountsPage() {
  const [bankAccounts, cashAccounts, cheques, transfers, companyOptions, contactOptions] = await Promise.all([
    listBankAccounts(),
    listCashAccounts(),
    listCheques(),
    listCashTransfers(),
    getCompanies(),
    getContactOptions(),
  ]);

  return (
    <AccountsManager
      bankAccounts={bankAccounts}
      cashAccounts={cashAccounts}
      cheques={cheques}
      transfers={transfers}
      companyOptions={companyOptions}
      contactOptions={contactOptions}
    />
  );
}
