import { invoiceFileName, type Invoice } from "@/lib/invoice-pdf";
import { downloadNodeAsPng } from "@/lib/node-download";

// The invoice as a picture — for sending where a PDF arrives as a file someone
// has to open and an image is simply readable.
//
// This photographs the invoice already on screen rather than drawing a third
// layout. There are two of those to keep in step already (the page in
// InvoiceDocument.tsx and the PDF in invoice-pdf.ts); a canvas renderer would be
// a third, and the one nobody would remember to update.
export async function downloadInvoicePng(node: HTMLElement, invoice: Invoice) {
  return downloadNodeAsPng(node, invoiceFileName(invoice, "png"));
}
