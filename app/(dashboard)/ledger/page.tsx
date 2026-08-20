import { listLedgerBalances } from "@/lib/actions/ledger";
import { INVOICE_COMPANY_NAME } from "@/lib/invoice-pdf";
import { getCompanies, getContactOptions } from "@/lib/queries/lookups";
import { LedgerManager } from "@/components/modules/LedgerManager";

export default async function Page({ searchParams }: { searchParams: Promise<{ company?: string }> }) {
  const [{ company }, balances, companyRows, contactRows] = await Promise.all([
    searchParams,
    listLedgerBalances(),
    getCompanies(),
    getContactOptions(),
  ]);

  // Whose name is at the top of a statement or a balance sheet. Always the name
  // the outside world knows, whichever company a balance is booked under
  // internally — the same rule invoices already print by. Falls back to the
  // first company on file if that record has been renamed.
  const outward = companyRows.find((c) => c.name === INVOICE_COMPANY_NAME) ?? companyRows[0];

  return (
    <LedgerManager
      balances={balances.filter((b) => !company || b.companyId === company)}
      companyOptions={companyRows.map((c) => ({ id: c.id, name: c.name }))}
      letterhead={{
        name: outward?.name ?? INVOICE_COMPANY_NAME,
        address: outward?.address ?? null,
        phone: outward?.phone ?? null,
        email: outward?.email ?? null,
        taxNumber: outward?.taxNumber ?? null,
      }}
      contactOptions={contactRows.map((c) => ({ id: c.id, name: c.displayName, companyId: c.companyId ?? "" }))}
      filter={undefined}
    />
  );
}
