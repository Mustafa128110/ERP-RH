import { listContacts } from "@/lib/actions/contacts";
import { getCompanies } from "@/lib/queries/lookups";
import { ContactsManager } from "@/components/modules/ContactsManager";
import type { Row } from "@/lib/table";
import { formatDate, money } from "@/lib/format";

export default async function Page() {
  const [contacts, companyRows] = await Promise.all([listContacts(), getCompanies()]);
  const rows: Row[] = contacts.map((contact) => ({
    id: contact.id,
    displayName: contact.displayName,
    company: contact.company ?? "Global",
    companyName: contact.companyName,
    phone: contact.phone,
    email: contact.email,
    city: contact.city,
    creditLimit: money(contact.creditLimit ?? 0),
    status: contact.isActive ? "Active" : "Inactive",
    owesUs: Number(contact.owesUs) > 0 ? money(contact.owesUs) : null,
    weOwe: Number(contact.weOwe) > 0 ? money(contact.weOwe) : null,
    lastDocument: contact.lastDocument ? formatDate(contact.lastDocument) : null,
    documentCount: contact.documentCount,
    address: contact.address,
    taxNumber: contact.taxNumber,
    _incomplete: !contact.phone && !contact.email,
    _searchContact: [contact.displayName, contact.companyName, contact.phone, contact.email].filter(Boolean).join(" "),
  }));

  return <ContactsManager rows={rows} companyOptions={companyRows} />;
}
