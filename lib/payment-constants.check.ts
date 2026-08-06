import assert from "node:assert/strict";
import { paymentLedgerSide, settlingCompanyId, type ContactBalanceHint } from "./payment-constants";

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

// --- Which company a payment settles in --------------------------------------
// The case this exists for: a customer of one company, invoiced there, paying.
// The receipt has to land where the receivable is, or "Owes Us" never moves.
const abbas: ContactBalanceHint[] = [
  { contactId: "abbas", companyId: "m52", balance: -202000 }, // owes us in M52
  { contactId: "abbas", companyId: "rh", balance: 388585 }, // we owe him in Royal Hardware
];
assert.equal(settlingCompanyId(abbas, "abbas", "received"), "m52", "money in settles the receivable");
assert.equal(settlingCompanyId(abbas, "abbas", "made"), "rh", "money out settles the payable");

// Owing us in both: which set of books is a real choice, so it isn't made here.
const bothSides: ContactBalanceHint[] = [
  { contactId: "c", companyId: "m52", balance: -500 },
  { contactId: "c", companyId: "rh", balance: -900 },
];
assert.equal(settlingCompanyId(bothSides, "c", "received"), null);

// Nothing outstanding, an unknown contact, and a settled row: no opinion.
assert.equal(settlingCompanyId(abbas, "someone-else", "received"), null);
assert.equal(settlingCompanyId([{ contactId: "c", companyId: "rh", balance: 0 }], "c", "received"), null);
assert.equal(settlingCompanyId([], "c", "made"), null);

console.log("payment-constants checks passed");
