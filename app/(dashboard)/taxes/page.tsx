import { listTaxes } from "@/lib/actions/taxes";
import { TaxManager } from "@/components/modules/TaxManager";

export default async function TaxesPage() {
  const taxes = await listTaxes();
  return <TaxManager taxes={taxes} />;
}
