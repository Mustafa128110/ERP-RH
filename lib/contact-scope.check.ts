import assert from "node:assert/strict";
import { inCompany } from "./contact-scope";

// The rule every contact picker is built on: global contacts belong to every
// company.
//
//   npx tsx lib/contact-scope.check.ts

const royal = "royal-id";
const m52 = "m52-id";
const pick = inCompany(royal);

assert.equal(pick({ companyId: royal }), true, "the company's own contact");
assert.equal(pick({ companyId: m52 }), false, "another company's contact stays out");
// Both spellings of "global": null straight off the row, "" once a page has
// mapped it for the option list.
assert.equal(pick({ companyId: null }), true, "a global contact belongs to every company");
assert.equal(pick({ companyId: "" }), true, "…including after the option lists map null to \"\"");

// Filtering a mixed list keeps this company's and the global ones, in order.
const options = [
  { id: "1", companyId: royal },
  { id: "2", companyId: m52 },
  { id: "3", companyId: null },
];
assert.deepEqual(options.filter(pick).map((o) => o.id), ["1", "3"]);

console.log("contact-scope checks passed");
