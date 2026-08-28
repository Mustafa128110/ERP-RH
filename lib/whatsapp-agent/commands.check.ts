import assert from "node:assert/strict";
import { parseCommand } from "./commands";
import { normalizeWhatsAppNumber } from "./phone";

assert.deepEqual(parseCommand("YES"), { kind: "confirm" });
assert.deepEqual(parseCommand("no"), { kind: "cancel" });
assert.deepEqual(parseCommand("stock cement"), { kind: "stock", query: "cement" });
assert.deepEqual(parseCommand("give me a list of shovels items"), { kind: "items", query: "shovels items" });
assert.deepEqual(parseCommand("shovel products"), { kind: "items", query: "shovel" });
assert.deepEqual(parseCommand("sales yesterday"), { kind: "sales", when: "yesterday" });
assert.deepEqual(parseCommand("invoice SI-0042"), { kind: "invoice", number: "SI-0042" });
assert.equal(parseCommand("yes please").kind, "agent", "Only an exact confirmation can post a draft.");
assert.equal(normalizeWhatsAppNumber("0300 123 4567"), "923001234567");
assert.equal(normalizeWhatsAppNumber("+92 (300) 123-4567"), "923001234567");
assert.equal(normalizeWhatsAppNumber("not a number"), null);

console.log("WhatsApp agent command checks passed");
