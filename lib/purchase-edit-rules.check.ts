import assert from "node:assert/strict";
import {
  hasRecordedPurchaseSettlement,
  legacyPurchasePairKeys,
  purchaseLineKey,
  purchasePaidMode,
  remainingPurchasePayable,
  purchaseSettlementAmount,
  requestedPurchaseSettlement,
} from "./purchase-edit-rules";

const legacy = legacyPurchasePairKeys([
  { itemId: "item-a", unitId: "unit-box" },
  { itemId: "item-b", unitId: null },
]);

assert.equal(legacy.has(purchaseLineKey("item-a", "unit-box")), true, "the unchanged legacy pair remains editable");
assert.equal(legacy.has(purchaseLineKey("item-a", "unit-piece")), false, "a newly selected disconnected unit is not grandfathered");
assert.equal(legacy.has(purchaseLineKey("item-c", "unit-box")), false, "another item cannot borrow the legacy exception");

assert.equal(
  hasRecordedPurchaseSettlement({ bankAccountId: null, cashAccountId: null, chequeId: null }),
  false,
  "a legacy paid purchase with no target has no balance to reverse",
);
assert.equal(
  hasRecordedPurchaseSettlement({ bankAccountId: "bank", cashAccountId: null, chequeId: null }),
  true,
  "a bank-backed purchase has a recorded settlement",
);
assert.equal(
  hasRecordedPurchaseSettlement({ bankAccountId: null, cashAccountId: "cash", chequeId: null }),
  true,
  "a cash-backed purchase has a recorded settlement",
);
assert.equal(
  hasRecordedPurchaseSettlement({ bankAccountId: null, cashAccountId: null, chequeId: "cheque" }),
  true,
  "a cheque-backed purchase has a recorded settlement",
);

assert.equal(purchaseSettlementAmount(1_000, 0, 0), 1_000, "a purchase-paid bill owns the full settlement");
assert.equal(purchaseSettlementAmount(1_000, 0, 1_000), 0, "a later Payment is not purchase-owned");
assert.equal(purchaseSettlementAmount(1_000, 100, 600), 300, "shipping and allocations are excluded from the purchase settlement");
assert.equal(purchasePaidMode(0, 1_000), "no");
assert.equal(purchasePaidMode(400, 1_000), "partial");
assert.equal(purchasePaidMode(1_000, 1_000), "yes");
assert.equal(requestedPurchaseSettlement("no", 500, 1_000), 0);
assert.equal(requestedPurchaseSettlement("partial", 500, 1_000), 500);
assert.equal(requestedPurchaseSettlement("yes", 0, 1_000), 1_000);
assert.equal(remainingPurchasePayable(1_100, 100, 0), 1_000, "shipping is an expense, not supplier ledger payable");
assert.equal(remainingPurchasePayable(1_100, 100, 400), 600, "only the unpaid goods amount remains in the supplier ledger");

console.log("purchase edit rules checks passed");
