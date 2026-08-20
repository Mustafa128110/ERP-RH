import Link from "next/link";
import { notFound } from "next/navigation";
import { conversionsOf, getQuotation } from "@/lib/actions/quotations";
import { getSaleFormOptions } from "@/lib/queries/lookups";
import { QuotationDetail } from "@/components/modules/QuotationDetail";
import { StatusPill } from "@/components/ui/StatusPill";
import { formatDate, money } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [quotation, options, conversions] = await Promise.all([getQuotation(id), getSaleFormOptions(), conversionsOf(id)]);
  if (!quotation) notFound();

  // Something is left to convert when any line still has quantity unaccounted
  // for. Derived from the lines rather than from the status string, so the two
  // can't disagree about it.
  const convertible = quotation.lines.some((l) => Number(l.quantity) - Number(l.convertedQuantity) > 0);

  return (
    <div className="flex h-full flex-col gap-4">
      <div className="flex shrink-0 items-start justify-between gap-4">
        <div>
          <Link href="/sales/quotations" className="text-sm text-steel hover:text-navy-800">
            ← Quotations
          </Link>
          <div className="mt-1 flex items-center gap-2">
            <h1 className="text-xl text-navy-800">{quotation.number}</h1>
            <StatusPill value={quotation.status} />
          </div>
          <p className="text-sm text-steel">
            {formatDate(quotation.documentDate)}
            {quotation.validUntil && ` · valid until ${formatDate(quotation.validUntil)}`} · {money(quotation.grandTotal)}
          </p>
        </div>
      </div>

      <QuotationDetail
        quotationId={quotation.id}
        defaults={{
          companyId: quotation.companyId,
          contactId: quotation.contactId,
          documentDate: quotation.documentDate,
          validUntil: quotation.validUntil,
          discountTotal: quotation.discountTotal,
          taxId: quotation.taxId,
          shippingTotal: quotation.shippingTotal,
          lines: quotation.lines,
        }}
        lines={quotation.lines}
        convertible={quotation.documentStatus === "pending" && convertible}
        cancelled={quotation.documentStatus === "cancelled"}
        companyOptions={options.companyOptions}
        customerOptions={options.customerOptions}
        itemOptions={options.itemOptions}
        unitOptions={options.unitOptions}
        taxOptions={options.taxOptions}
        conversionOptions={options.conversionOptions}
        taxSettings={options.taxSettings}
      />

      {conversions.length > 0 && (
        <div className="shrink-0 rounded-lg border border-sand bg-white p-4">
          <h2 className="mb-2 text-sm font-semibold text-navy-800">Invoices raised from this quotation</h2>
          <ul className="flex flex-col divide-y divide-sand">
            {conversions.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-4 py-2 text-sm">
                <Link href={`/sales/invoices/${c.id}`} className="font-medium text-navy-800 hover:underline">
                  {c.number}
                </Link>
                <span className="text-steel">{formatDate(c.documentDate)}</span>
                <span className="tabular-nums text-ink">{money(c.grandTotal)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
