import assert from "node:assert/strict";
import { csvBool, csvHeader, csvToObjects, objectsToCsv, parseCsv, templateCsv, toCsv } from "./csv";
import { PRODUCT_CSV_COLUMNS, PURCHASE_CSV_COLUMNS } from "./csv-columns";

// The parser and writer the CSV import/export ride on.
//
//   npx tsx lib/csv.check.ts

// --- Parsing -----------------------------------------------------------------
assert.deepEqual(parseCsv("a,b\n1,2"), [["a", "b"], ["1", "2"]]);
assert.deepEqual(parseCsv("a,b\r\n1,2\r\n"), [["a", "b"], ["1", "2"]], "CRLF and a trailing newline");
assert.deepEqual(parseCsv("\uFEFFa\n1"), [["a"], ["1"]], "the BOM Excel writes is not part of the heading");
assert.deepEqual(parseCsv('a,b\n"x,y",2'), [["a", "b"], ["x,y", "2"]], "a comma inside quotes is not a separator");
assert.deepEqual(parseCsv('a\n"he said ""hi"""'), [["a"], ['he said "hi"']], "doubled quotes are one quote");
assert.deepEqual(parseCsv('a\n"line1\nline2"'), [["a"], ["line1\nline2"]], "a newline inside quotes is not a row break");
assert.deepEqual(parseCsv("a,b\n1,2\n\n\n"), [["a", "b"], ["1", "2"]], "blank trailing rows are dropped");
assert.deepEqual(parseCsv(""), [], "an empty file is no rows, not one blank row");

// --- Writing -----------------------------------------------------------------
assert.equal(toCsv([["a", "b,c"]]), 'a,"b,c"');
assert.equal(toCsv([['say "hi"']]), '"say ""hi"""');
// Formula injection: a cell opening with =, + or @ runs when the file is opened
// in Excel or Sheets, so it goes out as text.
assert.equal(toCsv([["=1+1"]]), "'=1+1");
assert.equal(toCsv([["@SUM(A1)"]]), "'@SUM(A1)");
assert.equal(toCsv([["-5"]]), "-5", "a negative number is a number, not a formula");
// Round trip through both.
assert.deepEqual(parseCsv(toCsv([["a", "b,c"], ['d"e', "f\ng"]])), [["a", "b,c"], ['d"e', "f\ng"]]);

// --- Headings ----------------------------------------------------------------
assert.equal(csvHeader({ key: "k", label: "Company", required: true }), "Company *");
assert.equal(csvHeader({ key: "k", label: "SKU" }), "SKU");

// --- Objects -----------------------------------------------------------------
const cols = [
  { key: "company", label: "Company", required: true },
  { key: "name", label: "Item Name", required: true },
  { key: "sku", label: "SKU" },
];

// The "*" is display only — a file saved straight from the template still maps.
const ok = csvToObjects("Company *,Item Name *,SKU\nRoyal,Cement,RH-1", cols);
assert.equal(ok.error, undefined);
assert.deepEqual(ok.rows, [{ company: "Royal", name: "Cement", sku: "RH-1" }]);

// Headings are matched case- and space-insensitively, unknown ones are ignored,
// and a column the file doesn't carry reads as blank rather than undefined.
const loose = csvToObjects(" company ,ITEM NAME,Notes\nRoyal,Cement,mine", cols);
assert.deepEqual(loose.rows, [{ company: "Royal", name: "Cement", sku: "" }]);

const missing = csvToObjects("Company,SKU\nRoyal,RH-1", cols);
assert.match(missing.error ?? "", /Item Name/, "a missing required column is named, not silently skipped");
assert.deepEqual(missing.rows, []);

assert.match(csvToObjects("", cols).error ?? "", /empty/);

assert.equal(objectsToCsv(cols, [{ company: "Royal", name: "Cement", sku: "" }]), "Company *,Item Name *,SKU\r\nRoyal,Cement,");

// --- Templates ---------------------------------------------------------------
// Two rows: the headings and one example. Derived columns are not typed into, so
// they aren't in the template — but they are in the export.
for (const columns of [PRODUCT_CSV_COLUMNS, PURCHASE_CSV_COLUMNS]) {
  const grid = parseCsv(templateCsv(columns));
  assert.equal(grid.length, 2);
  assert.equal(grid[0].length, columns.filter((c) => !c.readOnly).length);
  // Every required column is starred in the file the user opens.
  for (const c of columns.filter((c) => c.required)) assert.ok(grid[0].includes(`${c.label} *`), `${c.label} must be starred`);
  // And a template is importable as-is.
  assert.equal(csvToObjects(templateCsv(columns), columns).error, undefined);
}
assert.ok(PRODUCT_CSV_COLUMNS.some((c) => c.readOnly), "the rate columns are export-only");

// --- Booleans ----------------------------------------------------------------
assert.equal(csvBool("yes", false), true);
assert.equal(csvBool("Y", false), true);
assert.equal(csvBool("1", false), true);
assert.equal(csvBool("no", true), false);
assert.equal(csvBool("", true), true, "blank means the column default");
assert.equal(csvBool("", false), false);

console.log("csv checks passed");
