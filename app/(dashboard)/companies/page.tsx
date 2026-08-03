import { listCompanies } from "@/lib/actions/companies";
import { CompanyManager } from "@/components/modules/CompanyManager";

export default async function CompaniesPage() {
  const companies = await listCompanies();
  return <CompanyManager companies={companies} />;
}
