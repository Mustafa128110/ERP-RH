import assert from "node:assert/strict";
import { isOpeningBalanceDirection, openingLedgerSide, openingStatementAmount } from "./ledger-opening-constants";
import { openingQueueSide } from "./ledger-constants";

function main() {
  assert.equal(isOpeningBalanceDirection("owes_us"), true);
  assert.equal(isOpeningBalanceDirection("we_owe"), true);
  assert.equal(isOpeningBalanceDirection("other"), false);

  const receivable = openingStatementAmount("owes_us", 5000);
  assert.equal(receivable, 5000, "a party owing us is positive on the statement");
  assert.equal(openingLedgerSide(receivable), "debit", "a receivable opening posts to debit");
  assert.equal(openingQueueSide(receivable), "receivable", "a receipt can settle a receivable opening");

  const payable = openingStatementAmount("we_owe", 5000);
  assert.equal(payable, -5000, "we owing the party is negative on the statement");
  assert.equal(openingLedgerSide(payable), "credit", "a payable opening posts to credit");
  assert.equal(openingQueueSide(payable), "payable", "a payment made can settle a payable opening");

  assert.equal(openingLedgerSide(0), null, "a cleared opening balance has no ledger row");
  console.log("ledger-opening-constants checks passed");
}

main();
