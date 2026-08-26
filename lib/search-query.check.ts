import assert from "node:assert/strict";
import { matchesTableSearch, parseGlobalSearch, parseTableSearch } from "@/lib/search-query";

const item = { name: "Garden Shovel", sku: "SH-1", _searchItem: "Garden Shovel SH-1", _searchUnit: "Piece", _searchContact: "Ali Hardware", status: "Paid" };
const unit = { name: "Dozen", symbol: "dz", _searchUnit: "Dozen dz" };
const contact = { displayName: "Dozen Traders", _searchContact: "Dozen Traders" };
const all = (row: Record<string, unknown>) => Object.values(row).filter((value) => typeof value === "string").join(" ").toLowerCase();

assert.equal(matchesTableSearch(item, all(item), parseTableSearch("item:shovel")), true);
assert.equal(matchesTableSearch(item, all(item), parseTableSearch("unit:dozen")), false);
assert.equal(matchesTableSearch(unit, all(unit), parseTableSearch("unit:dozen")), true);
assert.equal(matchesTableSearch(unit, all(unit), parseTableSearch("contact:dozen")), false, "contact prefix must not match a unit");
assert.equal(matchesTableSearch(contact, all(contact), parseTableSearch("contact:dozen")), true);
assert.equal(matchesTableSearch(item, all(item), parseTableSearch('contact:"Ali Hardware" status:paid')), true);
assert.equal(matchesTableSearch(item, all(item), parseTableSearch("shovel piece")), true, "plain multi-term search must remain available");
assert.deepEqual(parseGlobalSearch("item:shovel"), { term: "shovel", kind: "product" });
assert.deepEqual(parseGlobalSearch("unit:dozen"), { term: "dozen", kind: "unit" });
assert.deepEqual(parseGlobalSearch("contact:dozen"), { term: "dozen", kind: "contact" });
assert.deepEqual(parseGlobalSearch('contact:"Ali Hardware"'), { term: "Ali Hardware", kind: "contact" });

console.log("field-prefixed search checks passed");
