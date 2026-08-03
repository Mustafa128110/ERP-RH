import { listSuppliers } from "@/lib/actions/contacts";
import { getCompanies } from "@/lib/queries/lookups";
import { SuppliersManager } from "@/components/modules/SuppliersManager";
import type { Row } from "@/lib/table";
import { formatDate, money } from "@/lib/format";

export default async function Page() {
  const [suppliers, companyRows] = await Promise.all([listSuppliers(), getCompanies()]);

  const rows: Row[] = suppliers.map((s) => ({
    id: s.id,
    displayName: s.displayName,
    company: s.company ?? "Global",
    companyName: s.companyName,
    phone: s.phone,
    email: s.email,
    city: s.city,
    creditLimit: money(s.creditLimit ?? 0),
    status: s.isActive ? "Active" : "Inactive",
    // Read by the hover panel on the name. A contact list that can't tell you
    // whether the person owes you anything is a phone book, not a ledger.
    owesUs: Number(s.owesUs) > 0 ? money(s.owesUs) : null,
    weOwe: Number(s.weOwe) > 0 ? money(s.weOwe) : null,
    lastDocument: s.lastDocument ? formatDate(s.lastDocument) : null,
    documentCount: s.documentCount,
    address: s.address,
    taxNumber: s.taxNumber,
    // Incomplete when there's no way to reach them (no phone and no email).
    _incomplete: !s.phone && !s.email,
  }));

  return <SuppliersManager rows={rows} companyOptions={companyRows} />;
}
