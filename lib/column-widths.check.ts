import assert from "node:assert/strict";
import { columnWidthKey, fittedColumnWidth } from "./column-widths";

assert.equal(columnWidthKey("__sno"), columnWidthKey("rowNumber"));
assert.equal(columnWidthKey("unitPrice"), columnWidthKey("salesRate"));
assert.equal(columnWidthKey("item_name"), columnWidthKey("productName"));
assert.equal(columnWidthKey("saleType"), columnWidthKey("channel"));
assert.equal(fittedColumnWidth(50, [100, 720], 100), 760, "longest content must fit without cropping");
assert.equal(fittedColumnWidth(0, [], 100), 100);
console.log("global column sizing checks passed");
