import assert from "node:assert/strict";
import { paymentLedgerSide } from "./payment-constants";

// The ledger reads balance = credit - debit, and shows a positive balance under
// "We Owe" and a negative one under "Owes Us". So a payment received has to land
// on credit: booked as a debit it would add to what the customer owes us instead
// of clearing it, and the row would read double after paying in full.
//
//   npx tsx lib/payment-constants.check.ts

const balance = (sides: ReturnType<typeof paymentLedgerSide>[]) =>
  sides.reduce((sum, s) => sum + Number("credit" in s ? s.credit : 0) - Number("debit" in s ? s.debit : 0), 0);

assert.deepEqual(paymentLedgerSide("made", "100.00"), { debit: "100.00" });
assert.deepEqual(paymentLedgerSide("received", "100.00"), { credit: "100.00" });

// A 500 sale leaves the customer owing 500 (a debit, balance -500). Paying it
// clears the row rather than doubling it.
assert.equal(balance([{ debit: "500.00" }, paymentLedgerSide("received", "500.00")]), 0);
assert.equal(balance([{ debit: "500.00" }, paymentLedgerSide("received", "200.00")]), -300);

// The payable side, unchanged: a 500 purchase we owe, settled.
assert.equal(balance([{ credit: "500.00" }, paymentLedgerSide("made", "500.00")]), 0);

console.log("payment-constants checks passed");
