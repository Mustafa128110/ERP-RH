import { listExpenses } from "@/lib/actions/expenses";
import {
  getBankAccountOptions,
  getCashAccountOptions,
  getAvailableCheques,
  getCompanies,
  getContactOptions,
  getExpenseCategories,
} from "@/lib/queries/lookups";
import { ExpenseManager } from "@/components/modules/ExpenseManager";
import { ListFilters } from "@/components/ui/ListFilters";
import { StockFilter } from "@/components/modules/StockFilters";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ company?: string; from?: string; to?: string }>;
}) {
  const filters = await searchParams;
  const [expenses, companyRows, categoryRows, contactRows, bankAccountOptions, cashAccountOptions, chequeOptions] = await Promise.all([
    listExpenses(filters),
    getCompanies(),
    getExpenseCategories(),
    getContactOptions(),
    getBankAccountOptions(),
    getCashAccountOptions(),
    getAvailableCheques(),
  ]);

  return (
    <ExpenseManager
      expenses={expenses}
      filtered={Object.values(filters).some(Boolean)}
      companyOptions={companyRows}
      categoryOptions={categoryRows}
      contactOptions={contactRows.map((c) => ({ id: c.id, name: c.displayName, companyId: c.companyId ?? "" }))}
      bankAccountOptions={bankAccountOptions}
      cashAccountOptions={cashAccountOptions}
      chequeOptions={chequeOptions}
      filters={
        <ListFilters>
          <StockFilter param="company" allLabel="All Companies" options={companyRows.map((c) => ({ id: c.id, name: c.name }))} />
        </ListFilters>
      }
    />
  );
}
