import { listQuotations } from "@/lib/actions/quotations";
import { getSaleFormOptions } from "@/lib/queries/lookups";
import { QuotationManager } from "@/components/modules/QuotationManager";

export const dynamic = "force-dynamic";

export default async function Page() {
  const [quotations, options] = await Promise.all([listQuotations(), getSaleFormOptions()]);
  return (
    <QuotationManager
      quotations={quotations}
      companyOptions={options.companyOptions}
      customerOptions={options.customerOptions}
      itemOptions={options.itemOptions}
      unitOptions={options.unitOptions}
    />
  );
}
