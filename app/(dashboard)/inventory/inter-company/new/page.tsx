import Link from "next/link";
import { getCompanies, getItemOptions, getLocations, getUnits } from "@/lib/queries/lookups";
import { InterCompanyFormPage } from "@/components/modules/InterCompanyForm";

// Same reason as /sales/new: nothing here would otherwise touch a request-time
// API, so it'd try to prerender (and hit the DB) at build time.
export const dynamic = "force-dynamic";

export default async function Page() {
  const [companyOptions, itemRows, unitRows, locationRows] = await Promise.all([
    getCompanies(),
    getItemOptions(),
    getUnits(),
    getLocations(),
  ]);

  return (
    <div className="flex h-full flex-col gap-4">
      <div>
        <Link href="/inventory/inter-company" className="text-sm text-steel hover:text-navy-800">
          ← Inter-Company Sales
        </Link>
        <h1 className="mt-1 text-xl text-navy-800">New Inter-Company Sale</h1>
        <p className="text-sm text-steel">One company sells to the other — books both sides in one go.</p>
      </div>

      <InterCompanyFormPage
        companyOptions={companyOptions.map((c) => ({ id: c.id, name: c.name }))}
        itemOptions={itemRows.map((i) => ({
          id: i.id,
          name: i.name,
          companyId: i.companyId,
          rate: i.rate,
          salesRate: i.salesRate,
        }))}
        unitOptions={unitRows.map((u) => ({ id: u.id, name: u.symbol ? `${u.name} (${u.symbol})` : u.name }))}
        locationOptions={locationRows.map((l) => ({ id: l.id, name: l.name }))}
      />
    </div>
  );
}
