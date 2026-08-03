import { listWhatsAppMessages, whatsappRecipients, whatsappStatus } from "@/lib/actions/whatsapp";
import { getCompanies } from "@/lib/queries/lookups";
import { WhatsAppManager } from "@/components/modules/WhatsAppManager";

export const dynamic = "force-dynamic";

export default async function Page() {
  const [messages, { configured }, companyRows, recipients] = await Promise.all([
    listWhatsAppMessages(),
    whatsappStatus(),
    getCompanies(),
    whatsappRecipients(),
  ]);

  return (
    <WhatsAppManager
      messages={messages}
      configured={configured}
      companies={companyRows.map((c) => ({ id: c.id, name: c.name }))}
      recipients={recipients}
    />
  );
}
