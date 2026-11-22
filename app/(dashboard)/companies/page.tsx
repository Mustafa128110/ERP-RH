import { listCompanies } from "@/lib/actions/companies";
import { CompanyEditForm } from "@/components/modules/CompanyForm";
export default async function CompanyPage() {
  const [company] = await listCompanies();
  return <div className="mx-auto flex max-w-2xl flex-col gap-4"><h1 className="text-xl text-navy-800">Royal Hardware details</h1>{company ? <CompanyEditForm companyId={company.id} defaults={company} /> : <p>No company available.</p>}</div>;
}
