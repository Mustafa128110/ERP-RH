import assert from "node:assert/strict";
import { parseTaxRate } from "./tax-rate";

assert.deepEqual(parseTaxRate("15"), { value: "15" });
assert.deepEqual(parseTaxRate(" 18.5000 "), { value: "18.5000" });
assert.equal(parseTaxRate(0).value, "0");
assert.equal(parseTaxRate(100).value, "100");

for (const invalid of ["", " ", "not-a-number", "Infinity", Infinity, NaN, -0.0001, 100.0001]) {
  assert.ok(parseTaxRate(invalid).error, `${String(invalid)} must be rejected`);
}

console.log("tax-rate checks passed");
