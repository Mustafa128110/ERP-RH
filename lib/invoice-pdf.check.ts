import assert from "node:assert/strict";
import { buildInvoicePdf, invoiceFileName, type Invoice } from "./invoice-pdf";

// The generator draws an invoice by hand, so the failure mode is a throw
// half-way through (a null address, an empty line list) producing no file at
// all. This runs it over the shapes that actually occur:
//
//   npx tsx lib/invoice-pdf.check.ts

const base: Invoice = {
  number: "SI-0007",
  documentDate: "2026-07-29",
  subtotal: "1234567.8",
  discountTotal: "0",
  taxTotal: "0",
  shippingTotal: "0",
  grandTotal: "1234567.8",
  paidAmount: "0",
  isPaid: false,
  companyName: "Royal Hardware",
  companyPhone: "021-1234567",
  companyEmail: "mustafa@royalhardware.co",
  companyAddress: "Line one\nLine two",
  companyTaxNumber: "1234567-8",
  customerName: "Counter",
  customerPhone: "0300-1234567",
  customerAddress: "Somewhere\nElse",
  customerCity: "Karachi",
  previousBalance: 0,
  lines: [
    { itemName: "Hinge 4in", sku: "RH-00042", quantity: "12", unitPrice: "250.5", lineTotal: "3006", unitSymbol: "pcs" },
    { itemName: "Screw box", sku: null, quantity: "2.5", unitPrice: "1200", lineTotal: "3000", unitSymbol: null },
  ],
};

const bytes = async (inv: Invoice) => ((await buildInvoicePdf(inv)).output("arraybuffer") as ArrayBuffer).byteLength;

async function main() {
// A full invoice produces a real file, and it is a PDF.
const doc = await buildInvoicePdf(base);
const out = doc.output("arraybuffer") as ArrayBuffer;
assert.ok(out.byteLength > 1000, "a full invoice should produce a non-trivial file");
assert.equal(Buffer.from(out).subarray(0, 5).toString("latin1"), "%PDF-", "output must be a PDF");

// Every optional field is genuinely nullable in the database — none of them may
// throw, and none may collapse the document to nothing.
assert.ok(
  (await bytes({
    ...base,
    companyPhone: null,
    companyEmail: null,
    companyAddress: null,
    companyTaxNumber: null,
    customerName: null,
    customerPhone: null,
    customerAddress: null,
    customerCity: null,
  })) > 1000,
  "an invoice with every optional field null should still render",
);

// A sale with no lines is rare but reachable (every line deleted on an edit).
assert.ok((await bytes({ ...base, lines: [] })) > 1000, "an invoice with no lines should still render");

// The adjustment rows are conditional — exercise the branch where all three show.
assert.ok(
  (await bytes({ ...base, discountTotal: "500", taxTotal: "170.5", shippingTotal: "300", paidAmount: "1000" })) > 1000,
  "discount/tax/shipping rows should render",
);

// A long item list must paginate rather than run off the page.
const many = { ...base, lines: Array.from({ length: 80 }, () => base.lines[0]) };
assert.ok((await buildInvoicePdf(many)).getNumberOfPages() > 1, "80 lines should span more than one page");

// Filenames reach the filesystem: the invoice number alone, and nothing but
// safe characters may survive.
assert.equal(invoiceFileName(base), "SI-0007.pdf");
assert.equal(invoiceFileName({ ...base, number: "SI/0007 draft" }), "SI-0007-draft.pdf");
assert.ok(!/[/\\:*?"<>|]/.test(invoiceFileName({ ...base, number: 'a/b\\c:d*e?f"g<h>i|j' })), "no path or wildcard characters");
// A number of nothing but separators must not sanitise down to a bare ".pdf",
// which downloads as an extensionless hidden file.
assert.equal(invoiceFileName({ ...base, number: "///" }), "invoice.pdf");

// --- What the printed invoice may and may not say -----------------------------
// The company on the document is an accounting fact; the letterhead is always
// Royal Hardware, and the email address never appears.
const text = async (inv: Invoice) => Buffer.from((await buildInvoicePdf(inv)).output("arraybuffer") as ArrayBuffer).toString("latin1");

const branded = await text({ ...base, companyName: "M52 Trading", companyEmail: "mustafa@royalhardware.co" });
assert.ok(branded.includes("Royal Hardware"), "the letterhead must read Royal Hardware");
assert.ok(!branded.includes("M52 Trading"), "the document's own company must not appear");
assert.ok(!branded.includes("mustafa@royalhardware.co"), "the email address must not appear");
assert.ok(!branded.includes("@"), "no address-like text at all on the printed invoice");
// The phone survives — dropping the email must not have taken the contact line.
assert.ok(branded.includes("021-1234567"), "the phone number should still print");

console.log("invoice-pdf checks passed");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
