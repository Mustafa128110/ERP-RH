import { getSaleFormOptions } from "@/lib/queries/lookups";
import { SaleFormPage } from "@/components/modules/SaleForm";

// Sales opens straight into the entry form. The list of what's been sold lives
// on /sales/invoices, which is where a saved sale goes back to — the shop enters
// sales far more often than it reads them back, and the old landing page was one
// click of nothing before every single one.
//
// Standalone route with no session-gated call in its data fetching, so it'd
// otherwise default to static prerendering (and hang trying to hit the DB at
// build time).
export const dynamic = "force-dynamic";

export default async function Page() {
  const options = await getSaleFormOptions();
  return <SaleFormPage title="New Sale" {...options} />;
}
