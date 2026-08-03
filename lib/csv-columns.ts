import type { CsvColumn } from "@/lib/csv";

// The CSV shape of a product and of a stock purchase, in one place: the template
// download, the export file and the server-side import all read this list, so a
// new field is added once and shows up in all three.
//
// Everything a user types here is a *name*, never an id — the same names the
// pickers show. Unmatched names are created on save, exactly as typing one into
// a form field does (lib/actions/resolve-refs.ts).

export const PRODUCT_CSV_COLUMNS: CsvColumn[] = [
  { key: "company", label: "Company", required: true, sample: "Royal Hardware" },
  { key: "name", label: "Item Name", required: true, sample: "OPC Cement 50kg" },
  // Blank takes the next RH- number, the same as leaving it blank in the batch
  // add dialog.
  { key: "sku", label: "SKU", sample: "" },
  { key: "urduName", label: "Urdu Name", sample: "" },
  { key: "category", label: "Category", sample: "Cement" },
  { key: "brand", label: "Brand", sample: "Lucky" },
  { key: "taxable", label: "Taxable (yes/no)", sample: "no" },
  { key: "isActive", label: "Active (yes/no)", sample: "yes" },
  // Read off past documents, not stored on the product: the three purchase rates
  // come from the rate_list view, the sales rate from the last sales invoice
  // line. Type a rate on the Stock Purchase import instead — that's what a rate
  // is, a price something was bought at.
  { key: "purchaseRate1", label: "Purchase Rate 1", readOnly: true },
  { key: "purchaseRate2", label: "Purchase Rate 2", readOnly: true },
  { key: "purchaseRate3", label: "Purchase Rate 3", readOnly: true },
  { key: "salesRate", label: "Sales Rate", readOnly: true },
];

// Exactly what the New Stock Purchase popup asks for, and nothing else. The
// document number, the document type and the line cost aren't here because the
// popup doesn't ask for them either: the number comes off the PI- counter, the
// type is always Purchase Invoice, and the cost is quantity × unit price.
//
// One row per line item, not per purchase: a purchase is a header plus lines,
// and a spreadsheet is flat. What ties the lines back together is the delivery
// itself — rows that name the same company, supplier, date and location are one
// purchase, so a day's goods from one supplier arrive as one document with all
// its items on it. Nothing extra to number or keep track of; the header fields
// are read off the first row of each group.
export const PURCHASE_CSV_COLUMNS: CsvColumn[] = [
  { key: "company", label: "Company", required: true, sample: "Royal Hardware" },
  { key: "supplier", label: "Supplier", required: true, sample: "Lucky Cement Dealers" },
  { key: "documentDate", label: "Document Date (DD-MM-YYYY)", required: true, sample: "25-12-2026" },
  // Where the goods arrived. Required whenever a line carries a quantity —
  // stock that is on hand but nowhere is stock nobody can go and count.
  { key: "location", label: "Location", required: true, sample: "Main Warehouse" },
  // --- the line grid ---
  { key: "item", label: "Item", required: true, sample: "OPC Cement 50kg" },
  { key: "unit", label: "Unit", sample: "Bag" },
  { key: "quantity", label: "Quantity", required: true, sample: "100" },
  { key: "unitPrice", label: "Unit Price", required: true, sample: "1450" },
  // --- totals, taken from the group's first row and ignored on the rest ---
  // Rupees or a percentage of the subtotal ("250" or "5%"), same as the box in
  // the popup.
  { key: "discountTotal", label: "Discount", sample: "0" },
  { key: "taxTotal", label: "Tax", sample: "0" },
  { key: "shippingTotal", label: "Shipping Total", sample: "0" },
  { key: "paid", label: "Paid (yes/no)", sample: "no" },
  { key: "settlementType", label: "Settle via (account/cash/cheque)", sample: "" },
  // The bank account, cash account or cheque number that settled it — which of
  // the three is decided by Settle via. Only read when Paid is yes.
  { key: "settlementAccount", label: "Settlement Account / Cheque No", sample: "" },
];
