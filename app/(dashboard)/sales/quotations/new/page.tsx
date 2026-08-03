import Link from "next/link";
import { getSaleFormOptions } from "@/lib/queries/lookups";
import { QuotationForm } from "@/components/modules/QuotationForm";

// Same reason as /sales/new: nothing here touches a request-time API of its own,
// so without this it would try to prerender (and hit the database) at build time.
export const dynamic = "force-dynamic";

export default async function Page() {
  // A quotation needs the same customers, items and units a sale does, so it
  // reuses that option bundle rather than growing a near-identical twin. The
  // settlement lists it also carries are simply unused here.
  const { companyOptions, customerOptions, itemOptions, unitOptions } = await getSaleFormOptions();

  return (
    <div className="flex h-full flex-col gap-4">
      <div className="shrink-0">
        <Link href="/sales/quotations" className="text-sm text-steel hover:text-navy-800">
          ← Quotations
        </Link>
        <h1 className="mt-1 text-xl text-navy-800">New Quotation</h1>
        <p className="text-sm text-steel">A price held open for a customer. Nothing moves until it&apos;s converted to an invoice.</p>
      </div>

      <QuotationForm companyOptions={companyOptions} customerOptions={customerOptions} itemOptions={itemOptions} unitOptions={unitOptions} />
    </div>
  );
}
