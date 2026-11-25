import assert from "node:assert/strict";
import { columnWidthKey, columnContentKind, fixedColumnMinimum, createColumnLayout, minimumColumnWidth, TABLE_COLUMN_GUTTER } from "./column-widths";

assert.equal(columnWidthKey("__sno"), columnWidthKey("rowNumber"));
assert.equal(columnWidthKey("unitPrice"), columnWidthKey("salesRate"));
assert.equal(columnWidthKey("item_name"), columnWidthKey("productName"));
assert.equal(columnWidthKey("saleType"), columnWidthKey("channel"));
assert.equal(columnContentKind("customer"), "text");
assert.equal(columnContentKind("notes"), "text");
assert.equal(columnContentKind("documentDate"), "date");
assert.equal(columnContentKind("unknownNumeric", "right"), "number");
assert.equal(columnContentKind("onHand"), "number");
assert.equal(fixedColumnMinimum({ key: "total", width: 120 }), 120, "explicit positive column widths are respected");
assert.equal(fixedColumnMinimum({ key: "total" }), 132, "monetary totals use compact proportional width");
assert.equal(fixedColumnMinimum({ key: "quantity" }), 88, "quantities stay compact rather than taking money width");
assert.equal(fixedColumnMinimum({ key: "name", width: 220 }), 220, "an explicit fixed text width is retained");
assert.equal(minimumColumnWidth("date"), 108);
assert.equal(fixedColumnMinimum({ key: "age", align: "right" }), 68, "days stay compact beside financial amounts");
assert.equal(fixedColumnMinimum({ key: "documents", align: "right" }), 88, "record counts have their own compact fixed width");
assert.equal(TABLE_COLUMN_GUTTER, 12);

const columns = [
  { key: "__sno", minimum: minimumColumnWidth("__sno") },
  { key: "name", minimum: 200 },
  { key: "total", minimum: 132 },
  { key: "actions", minimum: 84 },
];
const layout = createColumnLayout(columns);
assert.equal(layout.minimumWidth, 468);
assert.equal(layout.shares[0], 0, "row numbers never absorb spare screen width");
assert.equal(layout.shares[3], 0, "action controls remain compact");
assert.equal(layout.shares[1], 1, "text receives spare viewport width");
assert.equal(layout.shares[2], 0, "figures keep a fixed width");

for (const available of [320, 468, 1280, 2560]) {
  const resized = createColumnLayout(columns, available);
  const extra = Math.max(0, available - layout.minimumWidth);
  const widths = columns.map((column, index) => column.minimum + extra * layout.shares[index]);
  assert.ok(widths.every((width, index) => width >= columns[index].minimum), "narrow screens preserve every fixed minimum");
  assert.ok(Math.abs(widths.reduce((sum, width) => sum + width, 0) - Math.max(available, layout.minimumWidth)) < 1e-8, "wide tables fill the available space exactly");
  assert.equal(widths[0], 52, "serial stays compact on every screen size");
  assert.equal(widths[2], 132, "numeric columns do not stretch with the screen");
  assert.equal(resized.tableWidth, Math.max(available, layout.minimumWidth));
  assert.ok(Math.abs(resized.widths.reduce((sum, width) => sum + parseFloat(width), 0) - resized.tableWidth) < 1e-8, "allocated pixel widths fill the table exactly");
}

assert.equal(createColumnLayout([]).minimumWidth, 0);
assert.deepEqual(createColumnLayout([{ key: "__sno", minimum: 52 }]).widths, ["52px"]);
assert.deepEqual(
  createColumnLayout([{ key: "module", minimum: 160 }, { key: "view", minimum: 90, grow: 0 }, { key: "edit", minimum: 90, grow: 0 }], 1600).widths,
  ["1420px", "90px", "90px"],
  "checkbox-only columns do not absorb spare space",
);
console.log("fixed column widths, numeric/date classification, viewport filling and narrow-screen overflow checks passed");
