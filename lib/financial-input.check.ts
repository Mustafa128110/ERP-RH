import assert from "node:assert/strict";
import { financialDocumentError } from "./financial-input";

function validate(lines: Parameters<typeof financialDocumentError>[0], values: Array<[string, unknown]> = []) {
  return financialDocumentError(
    lines,
    values.map(([label, value]) => ({ label, value })),
  );
}

async function main() {
  assert.equal(validate([{ quantity: "2", unitPrice: "3.5" }], [["Discount", "1"]]), null);
  assert.match(validate([{ quantity: "1", unitPrice: "-1" }]) ?? "", /unit price/);
  assert.match(validate([{ quantity: "Infinity", unitPrice: "1" }]) ?? "", /quantity/);
  assert.match(validate([{ quantity: "1", unitPrice: "1" }], [["Tax", "NaN"]]) ?? "", /Tax/);
  assert.match(validate([{ quantity: "1", unitPrice: "10" }], [["Discount", "11"]]) ?? "", /Discount/);
  assert.equal(financialDocumentError([{ quantity: "0", unitPrice: "10" }], [], { allowZeroQuantity: true }), null);
  console.log("financial input checks passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
