import { listQuotations } from "@/lib/actions/quotations";
import { QuotationManager } from "@/components/modules/QuotationManager";

export const dynamic = "force-dynamic";

export default async function Page() {
  const quotations = await listQuotations();
  return <QuotationManager quotations={quotations} />;
}
