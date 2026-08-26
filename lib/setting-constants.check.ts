import assert from "node:assert/strict";
import { isValidIsoDate } from "./setting-constants";

assert.equal(isValidIsoDate("2026-08-26"), true);
assert.equal(isValidIsoDate("2024-02-29"), true, "a leap day is a real date");
assert.equal(isValidIsoDate("2026-02-29"), false);
assert.equal(isValidIsoDate("2026-13-01"), false);
assert.equal(isValidIsoDate("2026-08-32"), false);
assert.equal(isValidIsoDate("26-08-26"), false);
console.log("setting constants checks passed");
