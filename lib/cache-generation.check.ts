import assert from "node:assert/strict";
import { cacheGeneration } from "./cache-generation";

const before = { documents: "1", document_lines: "2", brands: "3", companies: "4", contacts: "5", items: "6", units: "7", document_types: "1" };
assert.notEqual(cacheGeneration("page_reads:sales:user", before), cacheGeneration("page_reads:sales:user", { ...before, documents: "2" }), "a DB commit changes the key even when every Redis invalidation fails");
assert.equal(cacheGeneration("brands", before), cacheGeneration("brands", { ...before, documents: "2" }), "unrelated writes do not evict plain lookups");
assert.notEqual(cacheGeneration("unknown", before), cacheGeneration("unknown", { ...before, new_table: "1" }), "unknown families fail towards freshness");
assert.equal(cacheGeneration("brands", before), cacheGeneration("brands", Object.fromEntries(Object.entries(before).reverse())));
console.log("Database cache-generation checks passed");
