import assert from "node:assert/strict";
import { calculateTax } from "./tax-calculation";

function main() {
  assert.deepEqual(calculateTax([{ lineTotal: 100, taxable: true }], 0, 0, 18, false), {
    taxTotal: 18,
    grandTotal: 118,
    lineTaxAmounts: [18],
  });
  assert.deepEqual(calculateTax([{ lineTotal: 118, taxable: true }], 0, 0, 18, true), {
    taxTotal: 18,
    grandTotal: 118,
    lineTaxAmounts: [18],
  });
  const mixed = calculateTax(
    [
      { lineTotal: 100, taxable: true },
      { lineTotal: 100, taxable: false },
    ],
    20,
    10,
    10,
    false,
  );
  assert.equal(mixed.taxTotal, 9, "discount is apportioned before taxing only taxable lines");
  assert.equal(mixed.grandTotal, 199);
  assert.deepEqual(mixed.lineTaxAmounts, [9, 0]);
  assert.equal(calculateTax([{ lineTotal: 10, taxable: true }], 99, 0, 18, false).grandTotal, 0, "discount is capped at subtotal");
  console.log("tax-calculation checks passed");
}

main();
