import { listLedgerBalances } from "@/lib/actions/ledger";
import { getCompanies, getContactOptions } from "@/lib/queries/lookups";
import { LedgerManager } from "@/components/modules/LedgerManager";
import { StockFilter } from "@/components/modules/StockFilters";

export default async function Page({ searchParams }: { searchParams: Promise<{ company?: string }> }) {
  const [{ company }, balances, companyRows, contactRows] = await Promise.all([
    searchParams,
    listLedgerBalances(),
    getCompanies(),
    getContactOptions(),
  ]);

  return (
    <LedgerManager
      balances={balances.filter((b) => !company || b.companyId === company)}
      companyOptions={companyRows.map((c) => ({ id: c.id, name: c.name }))}
      contactOptions={contactRows.map((c) => ({ id: c.id, name: c.displayName, companyId: c.companyId ?? "" }))}
      // key: this element crosses into a children array inside LedgerManager,
      // and React can't infer a key for an element built out here.
      filter={<StockFilter key="company-filter" param="company" allLabel="All Companies" options={companyRows.map((c) => ({ id: c.id, name: c.name }))} />}
    />
  );
}
