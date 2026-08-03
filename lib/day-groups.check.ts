import assert from "node:assert/strict";
import { groupSameDay } from "./day-groups";

// What the payments and expenses lists depend on: the right rows land together,
// the ones that must stay apart do, the order the query returned survives, and
// the total is the total.
//
//   npx tsx lib/day-groups.check.ts

type Payment = {
  id: string;
  companyId: string;
  contactId: string | null;
  documentDate: string;
  code: string;
  grandTotal: string;
};

const royal = "royal-id";
const m52 = "m52-id";
const acme = "acme-id";
const widgets = "widgets-id";
const MADE = "PAYMENT_MADE";
const RECEIVED = "PAYMENT_RECEIVED";

const p = (over: Partial<Payment> & { id: string }): Payment => ({
  companyId: royal,
  contactId: acme,
  documentDate: "2026-08-01",
  code: MADE,
  grandTotal: "100",
  ...over,
});

// The payments list's key, verbatim.
const paymentKey = (r: Payment) => (r.contactId ? `${r.companyId}|${r.contactId}|${r.documentDate}|${r.code}` : null);
const groupPayments = (rows: Payment[]) => groupSameDay(rows, paymentKey, (r) => r.grandTotal);

// --- Same party, same day, same company, same direction: one group ---

{
  const groups = groupPayments([p({ id: "a", grandTotal: "1234.10" }), p({ id: "b", grandTotal: "2345.20" })]);
  assert.equal(groups.length, 1);
  assert.deepEqual(
    groups[0].members.map((m) => m.id),
    ["a", "b"],
  );
  // The float sum of these two is 3579.2999999999997.
  assert.equal(groups[0].total, 3579.3, "the total is summed in cents");
}

// --- Everything the key holds apart stays apart ---

{
  const groups = groupPayments([
    p({ id: "a" }),
    p({ id: "b", documentDate: "2026-08-02" }),
    p({ id: "c", contactId: widgets }),
    p({ id: "d", companyId: m52 }),
    p({ id: "e", code: RECEIVED }),
  ]);
  assert.equal(groups.length, 5, "a different day, party, company or direction is a different group");
  assert.ok(
    groups.every((g) => g.members.length === 1),
    "nothing merged that shouldn't have",
  );
}

// --- A null key never groups, not even with another null key ---

{
  const groups = groupPayments([p({ id: "a", contactId: null }), p({ id: "b", contactId: null })]);
  assert.equal(groups.length, 2, "no party means nothing to group under");
  assert.deepEqual(
    groups.map((g) => g.members[0].id),
    ["a", "b"],
  );
}

// --- Grouping doesn't reorder: a group sits where its first member sat ---

{
  const groups = groupPayments([
    p({ id: "a", contactId: widgets }),
    p({ id: "b", contactId: acme }),
    p({ id: "c", contactId: widgets }),
  ]);
  assert.deepEqual(
    groups.map((g) => g.members.map((m) => m.id)),
    [["a", "c"], ["b"]],
    "widgets keeps the first position it arrived in, acme the second",
  );
}

// --- A single row is still a group, so the caller has one shape ---

{
  const groups = groupPayments([p({ id: "a", grandTotal: "500.50" })]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].members.length, 1);
  assert.equal(groups[0].total, 500.5);
}

// --- An empty list is an empty list, not a group of nothing ---

assert.deepEqual(groupSameDay([], () => null, () => "0"), []);

// --- The expenses list's key: same shape, no nullable side ---

{
  type Expense = { id: string; companyId: string; expenseCategoryId: string; expenseDate: string; amount: string };
  const fuel = "fuel-id";
  const rent = "rent-id";
  const e = (over: Partial<Expense> & { id: string }): Expense => ({
    companyId: royal,
    expenseCategoryId: fuel,
    expenseDate: "2026-08-01",
    amount: "50",
    ...over,
  });
  const groups = groupSameDay(
    [e({ id: "a" }), e({ id: "b", amount: "75.25" }), e({ id: "c", expenseCategoryId: rent }), e({ id: "d", expenseDate: "2026-08-02" })],
    (r) => `${r.companyId}|${r.expenseCategoryId}|${r.expenseDate}`,
    (r) => r.amount,
  );
  assert.deepEqual(
    groups.map((g) => g.members.map((m) => m.id)),
    [["a", "b"], ["c"], ["d"]],
    "one day's fuel groups; a different category or day doesn't",
  );
  assert.equal(groups[0].total, 125.25);
}

console.log("day-groups checks passed");
