import assert from "node:assert/strict";
import { unitPickerLabel } from "./unit-picker-label";

assert.equal(unitPickerLabel({ name: "Pieces", symbol: "pcs" }), "pcs");
assert.equal(unitPickerLabel({ name: "Dozen", symbol: " doz " }), "doz");
assert.equal(unitPickerLabel({ name: "Legacy Unit", symbol: null }), "Legacy Unit");

console.log("unit picker label checks passed");
