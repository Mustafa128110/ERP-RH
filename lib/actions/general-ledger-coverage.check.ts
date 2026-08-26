import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// The GL is deliberately separate from the operational ledger, so TypeScript
// cannot prove that every financially material workflow reaches it. This small
// source contract makes the approved coverage explicit: adding a new alternate
// purchase/payment path means consciously extending this list and its posting.
const COVERAGE: { file: string; markers: string[] }[] = [
  { file: "sales.ts", markers: ["postGeneralLedgerIfCutover", "reverseGeneralLedger"] },
  { file: "purchases.ts", markers: ["postGeneralLedgerIfCutover", "reverseGeneralLedger"] },
  { file: "payments.ts", markers: ["postGeneralLedgerIfCutover", "postPaymentGeneralLedgerBatch", "reverseGeneralLedger"] },
  { file: "expenses.ts", markers: ["postExpenseGeneralLedgerBatch", "reverseExpenseGeneralLedger"] },
  { file: "returns.ts", markers: ["postGeneralLedgerIfCutover", "reverseGeneralLedger"] },
  { file: "stock-adjustments.ts", markers: ["postGeneralLedgerIfCutover", "reverseGeneralLedger"] },
  { file: "ledger.ts", markers: ["postGeneralLedgerIfCutover", "reverseGeneralLedger"] },
  { file: "inter-company.ts", markers: ["postGeneralLedgerIfCutover", "reverseGeneralLedger"] },
  { file: "market-purchases.ts", markers: ["postGeneralLedgerIfCutover", "reverseGeneralLedger"] },
  { file: "transfers.ts", markers: ["postGeneralLedgerIfCutover", "reverseGeneralLedger"] },
];

for (const { file, markers } of COVERAGE) {
  const source = readFileSync(join(process.cwd(), "lib", "actions", file), "utf8");
  for (const marker of markers) assert.match(source, new RegExp(`\\b${marker}\\b`), `${file} must retain ${marker}`);
  console.log(`ok   ${file.padEnd(22)} ${markers.join(", ")}`);
}
console.log("general-ledger workflow coverage checks passed");
