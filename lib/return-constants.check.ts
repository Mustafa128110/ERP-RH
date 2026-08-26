import assert from "node:assert/strict";
import { salesReturnHeaderTotals } from "./return-constants";

const round = (value: number) => Math.round(value * 10) / 10;

const source = { sourceSubtotal: 100, sourceDiscount: 10, sourceTax: 18, sourceShipping: 5, sourceGrandTotal: 113, round };

assert.deepEqual(salesReturnHeaderTotals({ ...source, selectedSubtotal: 100, selectedTax: 18, hasPriorReturns: false, returnsEverySourceLineNow: true }), { discount: 10, shipping: 5, tax: 18, grandTotal: 113, exact: true });
assert.deepEqual(salesReturnHeaderTotals({ ...source, selectedSubtotal: 50, selectedTax: 9, hasPriorReturns: true, returnsEverySourceLineNow: true }), { discount: 5, shipping: 2.5, tax: 9, grandTotal: 56.5, exact: false });

console.log("sales-return header calculations passed");
