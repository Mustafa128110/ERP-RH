import Link from "next/link";
import { notFound } from "next/navigation";
import { getInvoice } from "@/lib/actions/sales";
import { InvoiceDocument, DownloadInvoiceButton, DownloadInvoiceImageButton } from "@/components/modules/InvoiceDocument";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const invoice = await getInvoice(id);
  if (!invoice) notFound();

  return (
    <div className="flex flex-col gap-4">
      {/* Everything but the document itself is print:hidden — Ctrl+P here still
          yields the invoice rather than the screen around it, though the
          Download PDF button generates a real file instead. */}
      <div className="flex items-start justify-between gap-4 print:hidden">
        <div>
          <Link href="/sales/invoices" className="text-sm text-steel hover:text-navy-800">
            ← Invoices
          </Link>
          <h1 className="mt-1 text-xl text-navy-800">{invoice.number}</h1>
        </div>
        <div className="flex gap-2">
          <Link
            href={`/sales/${invoice.id}`}
            className="flex h-11 items-center rounded border border-sand px-4 text-sm font-medium text-steel hover:bg-ivory"
          >
            Edit Sale
          </Link>
          <DownloadInvoiceImageButton invoice={invoice} />
          <DownloadInvoiceButton invoice={invoice} />
        </div>
      </div>

      <InvoiceDocument invoice={invoice} />
    </div>
  );
}
