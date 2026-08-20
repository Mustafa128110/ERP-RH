import { getContactOptions } from "@/lib/queries/lookups";
import { PartyLedgerPage } from "@/components/modules/PartyLedger";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ contact?: string }>;
}) {
  const [{ contact }, contactRows] = await Promise.all([
    searchParams,
    getContactOptions(),
  ]);

  const contactOptions = contactRows.map((c) => ({
    id: c.id,
    name: c.displayName,
    companyId: c.companyId ?? "",
  }));

  return (
    <PartyLedgerPage
      contactId={contact ?? null}
      contactOptions={contactOptions}
    />
  );
}
