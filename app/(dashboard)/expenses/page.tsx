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

  const companyCodeMap = new Map(companyRows.map((c) => [c.id, c.shortName ?? c.name]));

  return (
    <ExpenseManager
      expenses={expenses}
      filtered={Object.values(filters).some(Boolean)}
      companyOptions={companyRows}
      companyCodeMap={companyCodeMap}
      categoryOptions={categoryRows}
      contactOptions={contactRows.map((c) => ({ id: c.id, name: c.displayName, companyId: c.companyId ?? "" }))}
      bankAccountOptions={bankAccountOptions}
      cashAccountOptions={cashAccountOptions}
      chequeOptions={chequeOptions}
      filters={
        <ListFilters key="filters" />
      }
    />
  );
}
