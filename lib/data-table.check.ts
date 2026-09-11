import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const table = readFileSync("components/ui/DataTable.tsx", "utf8");

// Every page already receives its complete, scoped row set. Keeping a 100-row
// client rendering window made ordinary lists look incomplete even though the
// search and select-all operated over records that were invisible. The table
// must now render every matching row in that supplied set.
assert.ok(table.includes("count: visible.length"), "the scrollable range must include every matching row");
assert.ok(table.includes("visible.map((row, rowIndex)"), "an explicit all-rows mode must remain available");
assert.ok(table.includes("Show all rows at once"), "browser find and accessibility must have an all-rows alternative");
assert.ok(table.includes("virtualizer.scrollToIndex(clamped"), "keyboard navigation must reach rows outside the mounted window");
assert.ok(table.includes("beforeprint"), "printing must render the complete list");
assert.ok(!table.includes("PAGE_SIZE"), "DataTable must not limit the visible rows to a fixed page size");
assert.ok(!table.includes("Previous page") && !table.includes("Next page"), "DataTable must not render pagination controls");

console.log("data table complete-range checks passed");
