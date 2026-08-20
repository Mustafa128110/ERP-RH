import assert from "node:assert/strict";
import { formatDate, landedUnitCost, money, perUnitShare, qty, resolveAdjustment, round1, toISODate } from "./format";

// The formatting rules the whole app now reads money, quantities and dates
// through. No database needed:
//
//   npx tsx lib/format.check.ts

// --- Dates: DD-MM-YYYY on screen, ISO underneath -----------------------------
assert.equal(formatDate("2026-07-29"), "29-07-2026");
assert.equal(formatDate("2026-01-05"), "05-01-2026");
assert.equal(formatDate(new Date(2026, 11, 25)), "25-12-2026");
assert.equal(toISODate("25-12-2026"), "2026-12-25");
assert.equal(toISODate("5-1-2026"), "2026-01-05", "single digits pad");
// Slashes and dots read as separators — a spreadsheet writes the date column its
// own way. Day-first either way; what's written back out is always DD-MM-YYYY.
assert.equal(toISODate("25/12/2026"), "2026-12-25");
assert.equal(toISODate("5.1.2026"), "2026-01-05");
assert.equal(formatDate(toISODate("25/12/2026")), "25-12-2026", "in with slashes, out with dashes");
// A half-typed date is not a date. Returning "" is what lets a required field
// fail validation instead of saving whatever was there before.
assert.equal(toISODate("25-12"), "");
assert.equal(toISODate(""), "");
// Round trip, which is the property that matters: what's shown re-parses to
// what's stored.
assert.equal(toISODate(formatDate("2026-02-09")), "2026-02-09");

// --- Money: whole number (rounded), two decimal places, lakh grouping ------
assert.equal(money(1234.56), "1,235.00", "rounded to whole");
assert.equal(money(1234567), "12,34,567.00", "lakh grouping, not thousands");
assert.equal(money("100"), "100.00");
assert.equal(money(0), "0.00");
assert.equal(money(-1500.25), "-1,500.00", "rounded to whole");
assert.equal(money(1500.5), "1,501.00", "rounds 0.5 up");

// --- Quantity: two decimals, counted in thousands ----------------------------
assert.equal(qty(12), "12.00");
assert.equal(qty(1234.5), "1,234.50");
assert.equal(qty("0.125"), "0.13");

// --- Stored values are rounded, not just displayed ones ----------------------
assert.equal(round1(10.04), 10);
assert.equal(round1(10.05), 10.1);
assert.equal(round1(10.449), 10.4);

// --- Landed cost: the delivery's adjustments spread over the whole load -------
assert.equal(perUnitShare(500, 40), 12.5);
assert.equal(perUnitShare(500, 0), 0, "no units means no share, not Infinity");
assert.equal(perUnitShare(0, 40), 0);
assert.equal(perUnitShare(-200, 40), -5, "a discount-heavy load lowers the cost");
// Whole rupees, always upward — 700.4 costs 701, never 700.
assert.equal(landedUnitCost(700, 0.4), 701);
assert.equal(landedUnitCost(700, 0.6), 701);
assert.equal(landedUnitCost(700, 0), 700, "an exact figure is left alone");
assert.equal(landedUnitCost(0, 35), 35);

// Priced out line by line the landed costs cover the invoice, and — because
// each one rounds up — cover it with a little to spare, never less.
// 3 x 100 + 7 x 250 = 2050 of goods, +500 shipping, -300 discount, +150 tax.
{
  const lines = [
    { quantity: 3, unitPrice: 100 },
    { quantity: 7, unitPrice: 250 },
  ];
  const subtotal = lines.reduce((sum, l) => sum + l.unitPrice * l.quantity, 0);
  const grandTotal = subtotal + 500 - 300 + 150;
  const perUnit = perUnitShare(500 - 300 + 150, 10);
  const landed = lines.reduce((sum, l) => sum + landedUnitCost(l.unitPrice, perUnit) * l.quantity, 0);
  // 35 a unit exactly here, so this one lands on the total rather than over it.
  assert.equal(round1(landed), grandTotal);

  // A share that doesn't divide evenly is the case worth pinning: 5 units and
  // 12 rupees of freight is 2.4 each, charged as 3.
  const odd = [{ quantity: 5, unitPrice: 100 }];
  const oddPerUnit = perUnitShare(12, 5);
  const oddLanded = odd.reduce((sum, l) => sum + landedUnitCost(l.unitPrice, oddPerUnit) * l.quantity, 0);
  assert.equal(oddLanded, 515);
  assert.ok(oddLanded >= 100 * 5 + 12, "never under what the purchase cost");
  assert.ok(oddLanded - (100 * 5 + 12) < odd[0].quantity, "and over it by less than a rupee a unit");
}

// --- Discount / tax: one box, "%" is what makes it a percentage --------------
assert.equal(resolveAdjustment("500", 10000), 500, "bare number is an amount");
assert.equal(resolveAdjustment("5%", 10000), 500, "trailing % is a percentage");
assert.equal(resolveAdjustment(" 5 % ", 10000), 500, "spaces around either form");
assert.equal(resolveAdjustment("", 10000), 0);
assert.equal(resolveAdjustment("abc", 10000), 0, "nonsense is nothing, not NaN");
assert.equal(resolveAdjustment("%", 10000), 0);
// Percentages resolve to a real amount, so they round like every other one.
assert.equal(resolveAdjustment("7.5%", 999), 74.9);

console.log("format checks passed");
