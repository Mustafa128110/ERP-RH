import assert from "node:assert/strict";
import { bestMatches, rankedMatches } from "./match";

const items = ["Steel Shovel Heavy", "Shovel Wooden Handle", "Garden Spade", "Coal Shovels Small", "Brush Wire"];
assert.deepEqual(rankedMatches("shovels", items, String), ["Shovel Wooden Handle", "Steel Shovel Heavy", "Coal Shovels Small"]);
assert.deepEqual(rankedMatches("list of shovel items", items, String), ["Shovel Wooden Handle", "Steel Shovel Heavy", "Coal Shovels Small"]);
assert.deepEqual(rankedMatches("steel shovl", items, String), ["Steel Shovel Heavy"]);
assert.deepEqual(bestMatches("garden spade", items, String), ["Garden Spade"]);
assert.deepEqual(rankedMatches("wire", items, String), ["Brush Wire"]);

console.log("WhatsApp agent matching checks passed");
