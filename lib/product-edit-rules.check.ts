import assert from "node:assert/strict";
import { isBlankPurchaseRow, purchaseRowError, recordsQty, recordsRate, writesDocument } from "./product-edit-rules";

// The rule the product edit grid is built on: a quantity is optional.
//
//   npx tsx lib/product-edit-rules.check.ts

const row = (o: Partial<Parameters<typeof purchaseRowError>[0]> = {}) => ({
  purchaseQty: "",
  purchaseRate: "",
  supplierId: "",
  supplierName: "",
  ...o,
});

const err = (o: Parameters<typeof row>[0]) => purchaseRowError(row(o), "Row 1 (Hinge)");

// --- A rate on its own is the whole point of the change ----------------------
assert.equal(err({ purchaseRate: "250.5" }), null, "a rate with no quantity must be accepted");
assert.equal(writesDocument(row({ purchaseRate: "250.5" })), true, "a rate alone still books a document");
assert.equal(recordsQty(row({ purchaseRate: "250.5" })), false, "a rate alone moves no stock");
// No supplier needed either — a price list isn't a delivery.
assert.equal(err({ purchaseRate: "250.5", supplierId: "" }), null);

// --- An untouched row is skipped, not rejected -------------------------------
assert.equal(err({}), null, "a blank row is fine");
assert.equal(isBlankPurchaseRow(row({})), true);
assert.equal(writesDocument(row({})), false, "a blank row writes nothing");
assert.equal(err({ purchaseQty: "0" }), null, "an explicit zero is still blank");

// --- A quantity means goods arrived, so it needs a supplier and a price ------
assert.match(err({ purchaseQty: "10" }) ?? "", /purchase rate/, "goods with no price can't be filed");
assert.match(err({ purchaseQty: "10", purchaseRate: "250" }) ?? "", /supplier/, "goods must come from someone");
assert.equal(err({ purchaseQty: "10", purchaseRate: "250", supplierId: "abc" }), null);
assert.equal(err({ purchaseQty: "10", purchaseRate: "250", supplierName: "Ahmed Traders" }), null, "a typed supplier name counts");
assert.equal(recordsQty(row({ purchaseQty: "10" })), true);

// --- A supplier alone still needs a price ------------------------------------
assert.match(err({ supplierName: "Ahmed Traders" }) ?? "", /purchase rate/);

// --- Quantities are validated, not trusted -----------------------------------
assert.match(err({ purchaseQty: "-1", purchaseRate: "250" }) ?? "", /zero or more/);
assert.match(err({ purchaseQty: "abc", purchaseRate: "250" }) ?? "", /zero or more/);
// Fractional quantities are legitimate — 2.5 boxes.
assert.equal(err({ purchaseQty: "2.5", purchaseRate: "250", supplierId: "abc" }), null);

// --- Zero and negative rates don't count as a rate ---------------------------
assert.equal(recordsRate(row({ purchaseRate: "0" })), false);
assert.match(err({ purchaseQty: "10", purchaseRate: "0", supplierId: "abc" }) ?? "", /purchase rate/);

// Messages name the row the user is looking at.
assert.match(err({ purchaseQty: "10" }) ?? "", /^Row 1 \(Hinge\)/);

console.log("product-edit-rules checks passed");
