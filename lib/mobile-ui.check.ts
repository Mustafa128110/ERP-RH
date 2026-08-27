import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");
const css = read("app/globals.css");
const table = read("components/ui/DataTable.tsx");
const sale = read("components/modules/SaleForm.tsx");
const quotation = read("components/modules/QuotationForm.tsx");
const purchase = read("components/modules/StockPurchaseForm.tsx");
const share = read("components/ui/ExportShareSheet.tsx");

assert.match(table, /mobile-data-list/, "DataTable must retain the mobile list hook");
assert.match(table, /data-label="Select"/, "selected DataTable rows need a mobile label");
assert.match(table, /p-0\$\{col\.hideOnMobile/, "linked and clickable DataTable cells must hide at the cell level");
assert.match(css, /table\[data-responsive\][\s\S]*min-width: 0/, "mobile DataTable must not force a wide table");
assert.match(css, /\.sale-items-grid/, "SaleForm mobile line grid needs its responsive CSS contract");
assert.match(sale, /sale-line-item/, "SaleForm item needs the full-row mobile hook");
assert.match(sale, /sale-line-total/, "SaleForm total needs the mobile fact hook");
assert.match(css, /grid-template-columns: 1\.05fr 0\.8fr 0\.95fr 0\.95fr 1\.85fr/, "mobile sale facts must share one compact five-column row");
assert.match(css, /\.document-lines-grid/, "document editors need the shared mobile line contract");
assert.match(quotation, /document-lines-grid/, "quotation lines must adopt the mobile document line contract");
assert.match(purchase, /document-lines-grid/, "stock purchase lines must adopt the mobile document line contract");
assert.match(css, /\.matrix-scroll/, "dense accounting matrices need bounded mobile scrolling");
assert.match(share, /navigator\.canShare/, "Export sharing must capability-check native file sharing");
assert.match(share, /Download again/, "export fallback must keep a second download available");

console.log("ok   mobile UI contracts are present");
