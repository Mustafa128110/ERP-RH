import assert from "node:assert/strict";
import { compareTableValues, tableColumnSortKey } from "@/lib/table-sort";

assert.equal(tableColumnSortKey({ key: "name" }, "__sno"), "name");
assert.equal(tableColumnSortKey({ key: "name", render: true }, "__sno"), null);
assert.equal(tableColumnSortKey({ key: "name", render: true, sortable: true }, "__sno"), "name");
assert.equal(
  tableColumnSortKey({ key: "valuation", render: true, sortable: true, sortBy: "_sortValuation" }, "__sno"),
  "_sortValuation",
);
assert.equal(tableColumnSortKey({ key: "__sno", sortable: true }, "__sno"), null);

assert.ok(compareTableValues(350, 1200, "asc") < 0, "numeric valuation must sort numerically");
assert.ok(compareTableValues(350, 1200, "desc") > 0, "descending numeric valuation must reverse the order");
assert.ok(compareTableValues("02-01-2026", "15-12-2025", "asc") > 0, "display dates must sort chronologically");
assert.ok(compareTableValues("Ali", "Zahid", "asc") < 0, "names must sort alphabetically");

console.log("table sorting checks passed");
