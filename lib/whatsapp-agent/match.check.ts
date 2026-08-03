import assert from "node:assert/strict";
import { bestMatches, chooseFrom, chosenIndex } from "./match";

// The property that matters most is the negative one: a query that fits several
// products must return several, so the agent asks instead of inventing a sale
// for the wrong item.
//
//   npx tsx lib/whatsapp-agent/match.check.ts

const CATALOG = [
  "Cement",
  "Cement OPC 50kg Bag",
  "Cement Paint White",
  "PVC Pipe 2 inch",
  "PVC Pipe 4 inch",
  "Steel Bar 12mm",
];
const find = (q: string, limit?: number) => bestMatches(q, CATALOG, (n) => n, limit);

// A name that is exactly a product ends the question, even though two other
// products start with the same word.
assert.deepEqual(find("cement"), ["Cement"]);
assert.deepEqual(find("CEMENT"), ["Cement"], "case-insensitive");
assert.deepEqual(find(" cement "), ["Cement"], "surrounding space ignored");

// No exact hit: everything plausible comes back, and the caller disambiguates.
assert.deepEqual(find("cement p"), ["Cement Paint White"]);
assert.deepEqual(find("pvc"), ["PVC Pipe 2 inch", "PVC Pipe 4 inch"]);
assert.equal(find("pipe").length, 2, "a mid-name word still matches");

// Word order is not something a person on a phone respects.
assert.deepEqual(find("50kg cement"), ["Cement OPC 50kg Bag"]);
assert.deepEqual(find("bag opc"), ["Cement OPC 50kg Bag"]);

// Punctuation and glued digits are noise.
assert.deepEqual(find("cement-opc-50kg"), ["Cement OPC 50kg Bag"]);
assert.deepEqual(find("2 inch pvc"), ["PVC Pipe 2 inch"]);

// Abbreviations work as word prefixes, which is how people actually type.
assert.deepEqual(find("cem opc"), ["Cement OPC 50kg Bag"]);
assert.deepEqual(find("st bar"), ["Steel Bar 12mm"]);

// Nothing matched is its own answer — not "here is the closest thing".
assert.deepEqual(find("tiles"), []);
assert.deepEqual(find("cement steel"), [], "tokens must all be present");
assert.deepEqual(find(""), []);
assert.deepEqual(find("!!!"), []);

// Exact beats prefix beats tokens, in that order.
assert.equal(find("cement", 10)[0], "Cement");
assert.equal(bestMatches("pvc pipe 4", CATALOG, (n) => n)[0], "PVC Pipe 4 inch");

// The cap is honoured — a two-letter query must not dump the catalogue.
assert.equal(find("c", 2).length, 2);

// --- Picking from a shortlist ------------------------------------------------
assert.equal(chosenIndex("2", 3), 1);
assert.equal(chosenIndex(" 1 ", 3), 0);
assert.equal(chosenIndex("3", 3), 2);
// Out of range is not a choice — it is ordinary text (a quantity, a rate).
assert.equal(chosenIndex("7", 3), null);
assert.equal(chosenIndex("0", 3), null);
assert.equal(chosenIndex("2 bags", 3), null);
assert.equal(chosenIndex("cement", 3), null);

assert.match(chooseFrom("item", ["Cement", "Cement Paint White"]), /1\. Cement\n2\. Cement Paint White/);

console.log("whatsapp agent match checks passed");
