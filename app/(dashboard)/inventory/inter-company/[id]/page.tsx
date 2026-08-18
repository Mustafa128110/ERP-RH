import Link from "next/link";
import { notFound } from "next/navigation";
import { getInterCompanySale } from "@/lib/actions/inter-company";
import { getCompanies, getItemOptions, getLocations, getUnits } from "@/lib/queries/lookups";
import { InterCompanyFormPage } from "@/components/modules/InterCompanyForm";
import { DeleteInterCompanySaleButton } from "@/components/modules/DeleteInterCompanySaleButton";
import { formatDate } from "@/lib/format";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [sale, companyOptions, itemRows, unitRows, locationRows] = await Promise.all([
    getInterCompanySale(id),
    getCompanies(),
    getItemOptions(),
    getUnits(),
    getLocations(),
  ]);
  if (!sale) notFound();

  return (
    <div className="flex h-full flex-col gap-4">
      <div className="flex items-start justify-between">
        <div>
          <Link href="/inventory/inter-company" className="text-sm text-steel hover:text-navy-800">
            ← Inter-Company Sales
          </Link>
          <h1 className="mt-1 text-xl text-navy-800">
            {sale.saleNumber} / {sale.purchaseNumber}
          </h1>
          <p className="text-sm text-steel">
            {formatDate(sale.documentDate)} · {sale.sellerName} → {sale.buyerName} · {sale.status}
          </p>
        </div>
        {sale.status === "posted" && <DeleteInterCompanySaleButton saleId={sale.id} />}
      </div>

      {/* Editable: saving replays both documents — the old lines, movements and
          receivable/payable rows are dropped and rewritten, so everything ends up
          matching what's on screen. */}
      {sale.status === "cancelled" ? (
        <div className="rounded-lg border border-sand bg-white p-5 text-sm text-steel">
          This inter-company sale and its matching purchase are preserved as cancelled records. They can no longer be edited.
        </div>
      ) : <InterCompanyFormPage
        saleId={sale.id}
        defaults={{
          sellerCompanyId: sale.sellerCompanyId,
          buyerCompanyId: sale.buyerCompanyId,
          sellerName: sale.sellerName,
          buyerName: sale.buyerName,
          documentDate: sale.documentDate,
          fromLocationId: sale.fromLocationId,
          toLocationId: sale.toLocationId,
          lines: sale.lines,
        }}
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
      />}
    </div>
  );
}
