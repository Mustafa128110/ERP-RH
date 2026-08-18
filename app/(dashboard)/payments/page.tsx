import { listPayments } from "@/lib/actions/payments";
import { listPaymentLedgerBalances } from "@/lib/actions/ledger";
import {
  getAvailableCheques,
  getBankAccountOptions,
  getCashAccountOptions,
  getCompanies,
  getContactOptions,
} from "@/lib/queries/lookups";
import { PaymentManager } from "@/components/modules/PaymentManager";
import { ListFilters } from "@/components/ui/ListFilters";
import { StockFilter } from "@/components/modules/StockFilters";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ contact?: string; direction?: string; company?: string; from?: string; to?: string }>;
}) {
  const filters = await searchParams;
  const [payments, companyRows, contactRows, bankAccountOptions, cashAccountOptions, chequeOptions, ledgerBalances] = await Promise.all([
    listPayments(filters),
    getCompanies(),
    getContactOptions(),
    getBankAccountOptions(),
    getCashAccountOptions(),
    getAvailableCheques(),
    // Which company each contact's balance sits in, so a new payment settles the
    // books that actually hold it rather than whichever company sorts first.
    listPaymentLedgerBalances(),
  ]);

  return (
    <PaymentManager
      payments={payments}
      filtered={Object.values(filters).some(Boolean)}
      companyOptions={companyRows}
      contactOptions={contactRows.map((c) => ({ id: c.id, name: c.displayName, companyId: c.companyId ?? "" }))}
      contactBalances={ledgerBalances.map((b) => ({ contactId: b.contactId, companyId: b.companyId, balance: b.balance }))}
      bankAccountOptions={bankAccountOptions}
      cashAccountOptions={cashAccountOptions}
      chequeOptions={chequeOptions}
      filters={
        <ListFilters key="filters">
          <StockFilter
            param="direction"
            allLabel="Made & Received"
            options={[
              { id: "made", name: "Made" },
              { id: "received", name: "Received" },
            ]}
          />
          <StockFilter param="company" allLabel="All Companies" options={companyRows.map((c) => ({ id: c.id, name: c.name }))} />
        </ListFilters>
      }
    />
  );
}
