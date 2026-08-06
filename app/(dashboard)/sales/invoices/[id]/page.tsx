import Link from "next/link";
import { notFound } from "next/navigation";
import { getInvoice } from "@/lib/actions/sales";
import { whatsappStatus } from "@/lib/actions/whatsapp";
import { InvoiceDocument, DownloadInvoiceButton, DownloadInvoiceImageButton } from "@/components/modules/InvoiceDocument";
import { SendWhatsAppButton } from "@/components/modules/SendWhatsAppButton";
import { formatDate, money } from "@/lib/format";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [invoice, { configured }] = await Promise.all([getInvoice(id), whatsappStatus()]);
  if (!invoice) notFound();

  const balance = Number(invoice.grandTotal) - Number(invoice.paidAmount);
  // A missing phone number is the only thing that stops this now: sending opens
  // the message in the user's own WhatsApp, which needs no provider at all. A
  // connected provider only adds the option of sending straight from the server.
  const cannotSend = invoice.customerPhone ? null : "This customer has no phone number on file.";

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
          <SendWhatsAppButton
            companyId={invoice.companyId}
            contactId={invoice.contactId}
            phone={invoice.customerPhone}
            documentId={invoice.id}
            template="invoice"
            input={{
              companyName: invoice.companyName,
              recipientName: invoice.customerName ?? "there",
              documentNumber: invoice.number,
              amount: `PKR ${money(invoice.grandTotal)}`,
              balance: `PKR ${money(balance)}`,
              date: formatDate(invoice.documentDate),
            }}
            disabledReason={cannotSend}
            providerConfigured={configured}
          />
          <DownloadInvoiceImageButton invoice={invoice} />
          <DownloadInvoiceButton invoice={invoice} />
        </div>
      </div>

      <InvoiceDocument invoice={invoice} />
    </div>
  );
}
