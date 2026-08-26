import { PageHeader } from "@/components/ui/PageHeader";
import { listWhatsAppMessages, listWhatsAppRecipients } from "@/lib/actions/whatsapp";
import { getCompanies } from "@/lib/queries/lookups";
import { WhatsAppHandoff } from "@/components/modules/WhatsAppHandoff";

export default async function Page() {
  const [recipients, messages, companies] = await Promise.all([listWhatsAppRecipients(), listWhatsAppMessages(), getCompanies()]);
  return (
    <div className="flex h-full flex-col gap-4">
      <PageHeader title="WhatsApp" subtitle="Messaging" />
      <WhatsAppHandoff recipients={recipients} messages={messages} companies={companies.map((company) => ({ id: company.id, name: company.shortName || company.name }))} />
    </div>
  );
}
