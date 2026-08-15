// jspdf and jspdf-autotable are deliberately NOT imported at module scope: they
// are ~400KB between them, and this file is imported by the invoice list and
// ledger pages (for the letterhead constant and the row download buttons).
// Both load on the first click that actually draws a file — the invoices page
// should not pay for the printer on the way in.
import type { jsPDF } from "jspdf";
import { formatDate, money, qty } from "@/lib/format";

// What an invoice looks like once it's for reading rather than editing: names,
// not ids. getInvoice() returns this plus a few internals (id, status, code)
// that neither renderer needs. It lives here rather than beside the on-screen
// component so both the page and this generator take the same shape without
// lib/ having to reach up into components/.
type InvoiceLine = {
  itemName: string | null;
  sku: string | null;
  quantity: string;
  unitPrice: string;
  lineTotal: string;
  unitSymbol: string | null;
};

export type Invoice = {
  number: string;
  documentDate: string;
  subtotal: string;
  discountTotal: string;
  taxTotal: string;
  shippingTotal: string;
  grandTotal: string;
  paidAmount: string;
  isPaid: boolean;
  companyName: string;
  companyPhone: string | null;
  companyEmail: string | null;
  companyAddress: string | null;
  companyTaxNumber: string | null;
  customerName: string | null;
  customerPhone: string | null;
  customerAddress: string | null;
  customerCity: string | null;
  lines: InvoiceLine[];
};

// A real PDF, not the browser's print dialog: doc.save() writes the file
// straight to the downloads folder, so the invoice row's button is one click
// and nothing else. The text stays selectable and searchable because this draws
// text, not a screenshot of the page (html2canvas would rasterize it).
//
// The cost of that is this file: the invoice layout exists twice, here and in
// components/modules/InvoiceDocument.tsx, which stays as the on-screen view.
// They have to be changed together — the shared parts (money/qty/date
// formatting, and what counts as paid) come from lib/format so at least the
// numbers can't drift apart.

// Brand palette, from app/globals.css. jsPDF takes RGB triples.
const NAVY: [number, number, number] = [16, 38, 63];
const STEEL: [number, number, number] = [91, 100, 112];
const INK: [number, number, number] = [28, 30, 33];
const SAND: [number, number, number] = [226, 223, 216];

const MARGIN = 15;

// Every invoice that leaves the building is a Royal Hardware invoice, whichever
// company the sale is booked under internally. The document's own companyName
// is deliberately not read here — it's an accounting fact, not the name the
// customer is meant to see. The on-screen copy still shows the real one.
// Exported because it is not the invoice's fact: it's the name at the top of
// anything that leaves the building, statements and balance sheets included.
export const INVOICE_COMPANY_NAME = "Royal Hardware";

// The invoice number and nothing else: SI-0042.pdf, or SI-0042.png for the
// image copy.
export function invoiceFileName(invoice: Invoice, extension = "pdf") {
  // Anything a filesystem objects to becomes a hyphen. Document numbers are
  // "SI-0007" today, but the number can be typed by hand on a purchase-style
  // entry, so this doesn't assume the shape. A number made entirely of such
  // characters would sanitise away to nothing and produce a bare ".pdf", which
  // downloads as an extensionless hidden file — hence the fallback.
  const safe = invoice.number.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return `${safe || "invoice"}.${extension}`;
}

export async function buildInvoicePdf(invoice: Invoice): Promise<jsPDF> {
  // The two heavy dependencies, loaded the moment a file is actually asked for.
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([import("jspdf"), import("jspdf-autotable")]);

  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const right = pageWidth - MARGIN;
  let y = MARGIN + 4;

  // --- Header: company on the left, invoice identity on the right ---
  doc.setFont("helvetica", "bold").setFontSize(18).setTextColor(...NAVY);
  doc.text(INVOICE_COMPANY_NAME, MARGIN, y);

  doc.setFont("helvetica", "normal").setFontSize(9).setTextColor(...STEEL);
  let leftY = y + 6;
  // Addresses are free text and routinely multi-line; splitTextToSize wraps
  // them to the column rather than letting them run under the invoice number.
  if (invoice.companyAddress) {
    const lines = doc.splitTextToSize(invoice.companyAddress, pageWidth / 2 - MARGIN);
    doc.text(lines, MARGIN, leftY);
    leftY += lines.length * 4;
  }
  // Phone only — the email address is deliberately kept off the printed
  // invoice. companyEmail is never read in this file.
  if (invoice.companyPhone) {
    doc.text(invoice.companyPhone, MARGIN, leftY);
    leftY += 4;
  }
  if (invoice.companyTaxNumber) {
    doc.text(`NTN: ${invoice.companyTaxNumber}`, MARGIN, leftY);
    leftY += 4;
  }

  doc.setFont("helvetica", "bold").setFontSize(8).setTextColor(...STEEL);
  doc.text("INVOICE", right, y - 4, { align: "right" });
  doc.setFontSize(15).setTextColor(...NAVY);
  doc.text(invoice.number, right, y + 2, { align: "right" });
  doc.setFont("helvetica", "normal").setFontSize(9).setTextColor(...STEEL);
  doc.text(formatDate(invoice.documentDate), right, y + 7, { align: "right" });
  doc.setFont("helvetica", "bold").setFontSize(9).setTextColor(...INK);
  const status = invoice.isPaid ? "Paid" : Number(invoice.paidAmount) > 0 ? "Part paid" : "Unpaid";
  doc.text(status, right, y + 12, { align: "right" });

  y = Math.max(leftY, y + 16) + 2;
  doc.setDrawColor(...SAND).setLineWidth(0.3);
  doc.line(MARGIN, y, right, y);
  y += 7;

  // --- Billed to ---
  doc.setFont("helvetica", "bold").setFontSize(8).setTextColor(...STEEL);
  doc.text("BILLED TO", MARGIN, y);
  y += 5;
  doc.setFont("helvetica", "bold").setFontSize(11).setTextColor(...INK);
  doc.text(invoice.customerName ?? "—", MARGIN, y);
  y += 5;
  doc.setFont("helvetica", "normal").setFontSize(9).setTextColor(...STEEL);
  if (invoice.customerAddress) {
    const lines = doc.splitTextToSize(invoice.customerAddress, pageWidth / 2);
    doc.text(lines, MARGIN, y);
    y += lines.length * 4;
  }
  const custContact = [invoice.customerCity, invoice.customerPhone].filter(Boolean).join("  ·  ");
  if (custContact) {
    doc.text(custContact, MARGIN, y);
    y += 4;
  }
  y += 4;

  // --- Line items ---
  autoTable(doc, {
    startY: y,
    margin: { left: MARGIN, right: MARGIN },
    head: [["#", "Item", "Qty", "Rate", "Amount"]],
    body: invoice.lines.map((l, i) => [
      String(i + 1),
      l.sku ? `${l.itemName ?? "—"}\n${l.sku}` : (l.itemName ?? "—"),
      `${qty(l.quantity)} ${l.unitSymbol ?? ""}`.trim(),
      money(l.unitPrice),
      money(l.lineTotal),
    ]),
    theme: "plain",
    styles: { font: "helvetica", fontSize: 9, textColor: INK, cellPadding: { top: 2, bottom: 2, left: 1, right: 1 } },
    headStyles: { fontStyle: "bold", fontSize: 8, textColor: STEEL, lineColor: SAND, lineWidth: { top: 0.3, bottom: 0.3 } },
    bodyStyles: { lineColor: SAND, lineWidth: { bottom: 0.2 } },
    columnStyles: {
      0: { halign: "right", cellWidth: 10, textColor: STEEL },
      1: { halign: "left" },
      2: { halign: "right", cellWidth: 26 },
      3: { halign: "right", cellWidth: 28 },
      4: { halign: "right", cellWidth: 32 },
    },
    // The SKU rides under the item name at a smaller size, the same as on screen.
    didParseCell: (data) => {
      if (data.section === "body" && data.column.index === 1 && String(data.cell.raw).includes("\n")) {
        data.cell.styles.fontSize = 9;
      }
    },
  });

  // autoTable records where it finished on the doc it drew into.
  y = (doc as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8;

  // --- Totals. Zero discount/tax/shipping rows are omitted, same as on screen. ---
  const labelX = right - 62;
  const row = (label: string, value: string, bold = false, rule = false) => {
    if (rule) {
      doc.setDrawColor(...SAND).setLineWidth(0.3);
      doc.line(labelX, y - 3.5, right, y - 3.5);
    }
    doc.setFont("helvetica", bold ? "bold" : "normal").setFontSize(9);
    doc.setTextColor(...(bold ? INK : STEEL));
    doc.text(label, labelX, y);
    doc.setTextColor(...INK);
    doc.text(value, right, y, { align: "right" });
    y += 5;
  };

  const discount = Number(invoice.discountTotal);
  const tax = Number(invoice.taxTotal);
  const shipping = Number(invoice.shippingTotal);
  const balance = Number(invoice.grandTotal) - Number(invoice.paidAmount);

  row("Subtotal", money(invoice.subtotal));
  if (discount > 0) row("Discount", `-${money(discount)}`);
  if (tax > 0) row("Tax", `+${money(tax)}`);
  if (shipping > 0) row("Shipping", `+${money(shipping)}`);
  row("Grand Total", money(invoice.grandTotal), true, true);
  row("Paid", money(invoice.paidAmount));
  row("Balance Due", money(balance), true);

  // --- Footer, pinned to the bottom of the last page ---
  const pageHeight = doc.internal.pageSize.getHeight();
  doc.setDrawColor(...SAND).setLineWidth(0.3);
  doc.line(MARGIN, pageHeight - 20, right, pageHeight - 20);
  doc.setFont("helvetica", "normal").setFontSize(8).setTextColor(...STEEL);
  doc.text(`${INVOICE_COMPANY_NAME} · ${invoice.number} · ${formatDate(invoice.documentDate)}`, MARGIN, pageHeight - 14);

  return doc;
}

// One click, no dialog: this writes the file and returns.
export async function downloadInvoicePdf(invoice: Invoice) {
  (await buildInvoicePdf(invoice)).save(invoiceFileName(invoice));
}
