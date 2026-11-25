import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");
const css = read("app/globals.css");
const table = read("components/ui/DataTable.tsx");
const sale = read("components/modules/SaleForm.tsx");
const quotation = read("components/modules/QuotationForm.tsx");
const purchase = read("components/modules/StockPurchaseForm.tsx");
const conversion = read("components/modules/ConversionEntry.tsx");
const share = read("components/ui/ExportShareSheet.tsx");

assert.match(table, /mobile-data-list/, "DataTable must retain the mobile list hook");
assert.match(table, /data-label="Select"/, "selected DataTable rows need a mobile label");
assert.ok(!table.includes("col.hideOnMobile"), "small screens must retain every column for horizontal scrolling");
assert.match(css, /min-width: max\(100%, var\(--table-min-width/, "tables must fill the available screen while retaining fixed column minima");
assert.match(css, /td\[data-cell-kind="text"\][\s\S]*white-space: normal/, "names and other strings must wrap");
assert.match(css, /data-cell-kind="number"[\s\S]*white-space: nowrap/, "dates and figures must stay on one line");
assert.match(css, /\.sale-items-grid/, "SaleForm mobile line grid needs its responsive CSS contract");
assert.match(sale, /sale-line-item/, "SaleForm item needs the full-row mobile hook");
assert.match(sale, /sale-line-total/, "SaleForm total needs the mobile fact hook");
assert.match(css, /grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/, "mobile entry cards must use a readable two-column fact grid");
assert.match(css, /\.document-lines-grid/, "document editors need the shared mobile line contract");
assert.match(css, /\.conversion-items-grid/, "stock conversion grids need the mobile line contract");
assert.match(quotation, /document-lines-grid/, "quotation lines must adopt the mobile document line contract");
assert.match(purchase, /document-lines-grid/, "stock purchase lines must adopt the mobile document line contract");
assert.match(conversion, /conversion-items-grid/, "conversion lines must adopt the conversion line contract");
assert.match(css, /\.matrix-scroll/, "dense accounting matrices need bounded mobile scrolling");
assert.match(share, /navigator\.canShare/, "Export sharing must capability-check native file sharing");
assert.match(share, /Download again/, "export fallback must keep a second download available");

console.log("ok   mobile UI contracts are present");
