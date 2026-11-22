import assert from "node:assert/strict";
import { parseTableSorts, promoteTableSort, compareSortedRows, compareTableValues, tableColumnSortKey } from "@/lib/table-sort";

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

const ordered = promoteTableSort(promoteTableSort(promoteTableSort([], "date"), "name"), "amount");
assert.deepEqual(ordered.map(sort => sort.key), ["amount", "name", "date"]);
assert.deepEqual(parseTableSorts("name,date,name,illegal;sql", "asc,desc,asc", ["name", "date"]), [{key:"name",direction:"asc"},{key:"date",direction:"desc"}]);
assert.equal(compareSortedRows({name:"Same",date:"01-01-2026"}, {name:"Same",date:"02-01-2026"}, [{key:"name",direction:"asc"},{key:"date",direction:"desc"}]) > 0, true);
assert.equal(compareTableValues("SI-9", "SI-10", "asc") < 0, true);
assert.equal(compareTableValues("1,200.00", "300.00", "asc") > 0, true);
