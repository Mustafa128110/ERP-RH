import Link from "next/link";
import { listBankAccounts, listCashAccounts, listGeneralLedgerAccounts, listGeneralLedgerOpeningBalances } from "@/lib/actions/accounts";
import { getCompanies } from "@/lib/queries/lookups";
import { GeneralLedgerMappingManager } from "@/components/modules/GeneralLedgerMappingManager";

export const dynamic = "force-dynamic";

export default async function Page({ searchParams }: { searchParams: Promise<{ company?: string }> }) {
  const [{ company }, companies, bankAccounts, cashAccounts] = await Promise.all([searchParams, getCompanies(), listBankAccounts(), listCashAccounts()]);
  const selected = companies.find((entry) => entry.id === company) ?? companies[0];
  const [accounts, openingBalances] = selected ? await Promise.all([listGeneralLedgerAccounts(selected.id), listGeneralLedgerOpeningBalances(selected.id)]) : [[], []];
  return (
    <div className="flex flex-col gap-4">
      <Link href="/accounts" className="text-sm text-steel hover:text-navy-800">← Accounts</Link>
      <GeneralLedgerMappingManager company={selected ?? null} companies={companies} accounts={accounts} openingBalances={openingBalances} bankAccounts={bankAccounts.filter((account) => account.companyId === selected?.id)} cashAccounts={cashAccounts.filter((account) => account.companyId === selected?.id)} />
    </div>
  );
}
