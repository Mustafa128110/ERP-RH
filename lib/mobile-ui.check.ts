import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");
const css = read("app/globals.css");
const layout = read("app/layout.tsx");
const dashboardLayout = read("app/(dashboard)/layout.tsx");
const workspace = read("components/layout/TableWorkspace.tsx");
const pageHeader = read("components/ui/PageHeader.tsx");
const stockCatalogue = read("components/modules/StockCatalogue.tsx");
const productsManager = read("components/modules/ProductsManager.tsx");
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
assert.ok(!layout.includes("@fontsource/fraunces") && !layout.includes("@fontsource/source-code-pro"), "typography must use one uniform font across text and figures");
assert.match(css, /grid-template-rows 260ms/, "table scroll collapse must use a smooth CSS transition");
assert.match(css, /overflow: hidden/, "table cells must prevent text collision across column boundaries");
assert.match(workspace, /role=\{focused && open && !mobile \? "dialog" : undefined\}/, "closed table options popup must not block table keyboard navigation");
assert.match(table, /visibleDialogs/, "DataTable arrow-key navigation must ignore hidden dialogs");
assert.ok(!css.includes("border-color: transparent"), "scrolling a table must keep its container border visible");
assert.match(table, /mobile-data-list[\s\S]*bg-white/, "table container must keep an explicit surface background");
assert.match(dashboardLayout, /MobileWorkspaceRail/, "dashboard layout must render the mobile right side panel");
assert.match(pageHeader, /mobileRail/, "PageHeader actions must move into the mobile right side panel");
assert.match(table, /label="Table controls" mobileRail/, "DataTable search must move into the mobile right side panel");
assert.match(css, /@media \(max-width: 767px\)[\s\S]*\[data-workspace-controls="Application"\][\s\S]*grid-template-rows: 1fr/, "mobile global search bar must stay visible when the table scrolls");
assert.match(stockCatalogue, /baseUnit\?\.symbol\?\.trim\(\)/, "Stock page On Hand must display the unit symbol");
assert.match(stockCatalogue, /_stockPlaces/, "Stock page must serialize multi-location breakdown for inline row rendering");
assert.ok(
  productsManager.indexOf('key: "onHand"') < productsManager.indexOf('key: "location"') &&
    productsManager.indexOf('key: "location"') < productsManager.indexOf('key: "valuation"'),
  "Location column must sit between On Hand and Valuation",
);
assert.ok(
  !productsManager.slice(productsManager.indexOf('key: "onHand"'), productsManager.indexOf('key: "location"')).includes("DetailHover"),
  "On Hand cell must not use DetailHover",
);
assert.match(productsManager, /saveStockColumnVisibility/, "Stock column visibility toggles must persist to Settings");

console.log("ok   mobile UI contracts are present");
