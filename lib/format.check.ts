import assert from "node:assert/strict";
import { formatDate, money, qty, resolveAdjustment, round1, toISODate } from "./format";

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

// --- Money: one decimal place, South-Asian grouping (##,##,###) --------------
assert.equal(money(1234.56), "1,234.6");
assert.equal(money(1234567), "12,34,567.0", "lakh grouping, not thousands");
assert.equal(money("100"), "100.0");
assert.equal(money(0), "0.0");
assert.equal(money(-1500.25), "-1,500.3");

// --- Quantity: two decimals, counted in thousands ----------------------------
assert.equal(qty(12), "12.00");
assert.equal(qty(1234.5), "1,234.50");
assert.equal(qty("0.125"), "0.13");

// --- Stored values are rounded, not just displayed ones ----------------------
assert.equal(round1(10.04), 10);
assert.equal(round1(10.05), 10.1);
assert.equal(round1(10.449), 10.4);

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
