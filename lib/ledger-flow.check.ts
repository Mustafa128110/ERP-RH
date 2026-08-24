import assert from "node:assert/strict";
import {
  allocationImpact,
  openingQueueSide,
  paymentQueueSide,
  runningBalances,
  settleFifo,
  settlementState,
  type FifoAllocation,
  type SettleableItem,
  type SettlingPayment,
} from "@/lib/ledger-constants";

// Terse builders — these tests are about queue order and split arithmetic, and
// every field spelled out in full made that impossible to read.
const inv = (id: string, amount: number, date: string, side: SettleableItem["side"] = "receivable"): SettleableItem =>
  ({ id, side, amount, date, createdAt: `${date}T00:00:00Z` });

const opening = (id: string, amount: number, side: SettleableItem["side"]): SettleableItem =>
  ({ id, side, amount, date: "2099-12-31", createdAt: "2099-12-31T00:00:00Z", isOpening: true });

const pay = (id: string, amount: number, date: string, side: SettlingPayment["side"] = "receivable"): SettlingPayment =>
  ({ id, side, amount, date, createdAt: `${date}T00:00:00Z` });

const allocOf = (out: { allocations: FifoAllocation[] }) =>
  out.allocations.map((a) => `${a.paymentId}->${a.itemId}:${a.amount}`);

function sides() {
  assert.equal(paymentQueueSide("received"), "receivable", "a receipt settles what the party owes us");
  assert.equal(paymentQueueSide("made"), "payable", "a payment out settles what we owe them");
  assert.equal(openingQueueSide(5000), "receivable", "positive opening balance is a receivable");
  assert.equal(openingQueueSide(-5000), "payable", "negative opening balance is a payable");
  assert.equal(openingQueueSide(0), null, "a zero opening balance joins no queue");
}

function oldestFirst() {
  const out = settleFifo([inv("A", 1000, "2026-03-01"), inv("B", 1000, "2026-01-01")], [pay("P", 1000, "2026-04-01")]);
  assert.deepEqual(allocOf(out), ["P->B:1000"], "the older invoice settles first regardless of listed order");
  assert.equal(out.settledByItem.get("A"), undefined, "the newer invoice is untouched");
}

// One receipt across three invoices — the "installments" case read the other way
// round: a single payment splitting, not a single invoice receiving.
function oneReceiptSplitsAcrossInvoices() {
  const out = settleFifo(
    [inv("A", 400, "2026-01-01"), inv("B", 400, "2026-01-02"), inv("C", 400, "2026-01-03")],
    [pay("P", 1000, "2026-02-01")],
  );
  assert.deepEqual(allocOf(out), ["P->A:400", "P->B:400", "P->C:200"], "one receipt fills invoices oldest-first and part-fills the last");
  assert.equal(settlementState(400, out.settledByItem.get("C") ?? 0), "partial", "the part-filled invoice reads as partial");
  assert.equal(settlementState(400, out.settledByItem.get("A") ?? 0), "settled");
  assert.equal(out.advance.receivable, 0, "nothing is left over");
}

// Three receipts against one invoice — installments proper.
function oneInvoiceTakesManyPayments() {
  const out = settleFifo(
    [inv("A", 900, "2026-01-01")],
    [pay("P1", 300, "2026-02-01"), pay("P2", 300, "2026-03-01"), pay("P3", 300, "2026-04-01")],
  );
  assert.deepEqual(allocOf(out), ["P1->A:300", "P2->A:300", "P3->A:300"]);
  assert.equal(settlementState(900, out.settledByItem.get("A") ?? 0), "settled", "an invoice settles across as many installments as it takes");
}

// The float trap this engine exists to avoid: three thirds of 100,000 must close
// the invoice, not leave it a hundredth short.
function thirdsCloseExactly() {
  const out = settleFifo([inv("A", 100000, "2026-01-01")], [pay("P1", 33333.34, "2026-02-01"), pay("P2", 33333.33, "2026-02-02"), pay("P3", 33333.33, "2026-02-03")]);
  assert.equal(out.settledByItem.get("A"), 100000, "paisa arithmetic closes the invoice exactly");
  assert.equal(settlementState(100000, out.settledByItem.get("A") ?? 0), "settled");
}

// The opening balance is the oldest item in its queue even though its own date
// is later than every invoice on the account.
function openingBalanceLeadsItsQueue() {
  const out = settleFifo(
    [inv("INV", 1000, "2026-01-01"), opening("OB", 500, "receivable")],
    [pay("P", 1200, "2026-02-01")],
  );
  assert.deepEqual(allocOf(out), ["P->OB:500", "P->INV:700"], "the opening balance settles before any actual invoice");
}

// A negative opening balance belongs to the other queue, and a receipt must not
// reach it.
function queuesDoNotCross() {
  const out = settleFifo(
    [opening("OB", 500, "payable"), inv("PUR", 800, "2026-01-01", "payable"), inv("SAL", 300, "2026-01-01")],
    [pay("RCV", 1000, "2026-02-01"), pay("MADE", 600, "2026-02-01", "payable")],
  );
  assert.deepEqual(allocOf(out), ["RCV->SAL:300", "MADE->OB:500", "MADE->PUR:100"], "receipts settle sales only, payments out settle purchases only");
  assert.equal(out.advance.receivable, 700, "the receipt's excess stays on the receivable side");
  assert.equal(out.advance.payable, 0);
}

// Overpayment is kept, not rejected — and the moment an invoice lands on that
// side, the advance is absorbed by it with no further user action.
function advanceAbsorbedByTheNextInvoice() {
  const before = settleFifo([inv("A", 400, "2026-01-01")], [pay("P", 1000, "2026-02-01")]);
  assert.equal(before.advance.receivable, 600, "the excess is held as an advance rather than refused");
  assert.equal(before.appliedByPayment.get("P"), 400);

  // Same party, same payment, one new invoice — dated *after* the payment, which
  // is the case that matters: FIFO by date must not stop the advance reaching it.
  const after = settleFifo([inv("A", 400, "2026-01-01"), inv("B", 500, "2026-03-01")], [pay("P", 1000, "2026-02-01")]);
  assert.deepEqual(allocOf(after), ["P->A:400", "P->B:500"], "a new invoice absorbs the standing advance automatically");
  assert.equal(after.advance.receivable, 100, "and what still does not fit stays an advance");
}

// Reducing an invoice under what is already allocated to it: the excess is
// released and the next outstanding item in the same queue takes it.
function reducingAnInvoiceReleasesToTheNextItem() {
  const payments = [pay("P1", 50000, "2026-02-01"), pay("P2", 40000, "2026-03-01")];
  const before = settleFifo([inv("BIG", 100000, "2026-01-01"), inv("NEXT", 70000, "2026-01-15")], payments);
  assert.equal(before.settledByItem.get("BIG"), 90000, "two installments have taken 90,000 of the 100,000 invoice");
  assert.equal(before.settledByItem.get("NEXT"), undefined);

  // Edited down to 50,000 — below the 90,000 already allocated.
  const after = settleFifo([inv("BIG", 50000, "2026-01-01"), inv("NEXT", 70000, "2026-01-15")], payments);
  assert.equal(after.settledByItem.get("BIG"), 50000, "the invoice cannot hold more than it is now worth");
  assert.equal(after.settledByItem.get("NEXT"), 40000, "the released 40,000 moves to the next outstanding invoice");

  // What the confirmation dialog reads off: the first installment is undisturbed
  // and so must not be listed, the second is released, and the amount reappears
  // against the next invoice.
  const described = allocationImpact(before.allocations, after.allocations)
    .map((i) => `${i.paymentId}->${i.itemId} ${i.before}=>${i.after} ${i.effect}`)
    .sort();
  assert.deepEqual(
    described,
    ["P2->BIG 40000=>0 released", "P2->NEXT 0=>40000 added"],
    "the confirmation names the freed allocation and where it goes, and nothing else",
  );
}

// Deleting an invoice that has payments against it frees them onto whatever is
// still outstanding.
function deletingAnInvoiceFreesItsPayments() {
  const payments = [pay("P", 1000, "2026-02-01")];
  const before = settleFifo([inv("A", 600, "2026-01-01"), inv("B", 600, "2026-01-02")], payments);
  assert.deepEqual(allocOf(before), ["P->A:600", "P->B:400"]);

  const after = settleFifo([inv("B", 600, "2026-01-02")], payments);
  assert.deepEqual(allocOf(after), ["P->B:600"], "B takes what A was holding");
  const impact = allocationImpact(before.allocations, after.allocations);
  assert.ok(impact.some((i) => i.itemId === "A" && i.effect === "released"), "A's allocation is reported as released");
  assert.ok(impact.some((i) => i.itemId === "B" && i.effect === "increased"), "B's allocation is reported as growing");
}

// Editing a date moves the entry in the queue, which can hand an allocation to a
// different invoice entirely. The recompute is what makes that safe.
function editingADateChangesMatching() {
  const payments = [pay("P", 500, "2026-06-01")];
  const before = settleFifo([inv("A", 500, "2026-01-01"), inv("B", 500, "2026-02-01")], payments);
  assert.deepEqual(allocOf(before), ["P->A:500"]);

  // B backdated ahead of A: the same receipt now settles B instead.
  const after = settleFifo([inv("A", 500, "2026-01-01"), inv("B", 500, "2025-12-01")], payments);
  assert.deepEqual(allocOf(after), ["P->B:500"], "backdating an invoice moves it to the front of the queue");
}

// Nothing above should imply a journal entry can settle anything: the engine is
// only ever handed invoices and payments, and the running balance is where a
// journal entry has its effect.
function journalEntriesOnlyMoveTheRunningBalance() {
  const rows = [
    { debit: 1000, credit: 0 }, // sales invoice
    { debit: 0, credit: 250 },  // journal entry, credit side
    { debit: 0, credit: 400 },  // payment received
    { debit: 150, credit: 0 },  // journal entry, debit side
  ];
  const withBalances = runningBalances(500, rows);
  assert.deepEqual(withBalances.map((r) => r.balance), [1500, 1250, 850, 1000], "balance is opening + debit - credit, row by row");
  assert.equal(runningBalances(0, []).length, 0, "a party with no movements has no rows");
  assert.deepEqual(runningBalances(-750, []).length, 0);
}

// A negative opening balance seeds the running balance below zero, which is the
// "we owe them" direction.
function openingBalanceSeedsTheRunningBalance() {
  const withBalances = runningBalances(-1000, [{ debit: 0, credit: 500 }, { debit: 2000, credit: 0 }]);
  assert.deepEqual(withBalances.map((r) => r.balance), [-1500, 500], "the account crosses from payable to receivable");
}

function impactOfNoChangeIsEmpty() {
  const allocations = [{ paymentId: "P", itemId: "A", amount: 100 }];
  assert.deepEqual(allocationImpact(allocations, allocations), [], "an edit that moves no allocation has nothing to confirm");
  assert.deepEqual(allocationImpact([], []), []);
}

function main() {
  sides();
  oldestFirst();
  oneReceiptSplitsAcrossInvoices();
  oneInvoiceTakesManyPayments();
  thirdsCloseExactly();
  openingBalanceLeadsItsQueue();
  queuesDoNotCross();
  advanceAbsorbedByTheNextInvoice();
  reducingAnInvoiceReleasesToTheNextItem();
  deletingAnInvoiceFreesItsPayments();
  editingADateChangesMatching();
  journalEntriesOnlyMoveTheRunningBalance();
  openingBalanceSeedsTheRunningBalance();
  impactOfNoChangeIsEmpty();
  console.log("ledger-flow.check.ts OK");
}

main();
