import { listLedgerBalances } from "@/lib/actions/ledger";
import { INVOICE_COMPANY_NAME } from "@/lib/invoice-pdf";
import { getCompanies, getContactOptions } from "@/lib/queries/lookups";
import { LedgerManager } from "@/components/modules/LedgerManager";

export default async function Page() {
  const [balances, companyRows, contactRows] = await Promise.all([
    listLedgerBalances(),
    getCompanies(),
    getContactOptions(),
  ]);

  // Whose name is at the top of a statement or a balance sheet. Always the name
  // the outside world knows, whichever company a balance is booked under
  // internally — the same rule invoices already print by. Falls back to the
  // first company on file if that record has been renamed.
  const outward = companyRows.find((c) => c.name === INVOICE_COMPANY_NAME) ?? companyRows[0];

  const byContact = new Map(balances.map(balance=>[balance.contactId,balance]));
  for (const contact of contactRows) if (!byContact.has(contact.id) && outward) byContact.set(contact.id,{contactId:contact.id,displayName:contact.displayName,companyId:outward.id,company:outward.name,credit:0,debit:0,balance:0,recentPayments:[],recentInvoices:[],recentPurchases:[]});
  return (
    <LedgerManager
      balances={[...byContact.values()].sort((a,b)=>a.displayName.localeCompare(b.displayName))}
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
