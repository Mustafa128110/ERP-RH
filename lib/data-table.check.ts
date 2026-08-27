import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const table = readFileSync("components/ui/DataTable.tsx", "utf8");

// Every page already receives its complete, scoped row set. Keeping a 100-row
// client rendering window made ordinary lists look incomplete even though the
// search and select-all operated over records that were invisible. The table
// must now render every matching row in that supplied set.
assert.ok(table.includes("{visible.map((row, rowIndex) =>"), "DataTable must render every matching row");
assert.ok(!table.includes("PAGE_SIZE"), "DataTable must not limit the visible rows to a fixed page size");
assert.ok(!table.includes("Previous page") && !table.includes("Next page"), "DataTable must not render pagination controls");

console.log("data table all-rows checks passed");
