import assert from "node:assert/strict";
import { balancedGeneralLedgerLines, isOnOrAfterGlCutover, stockAdjustmentLedgerLines, partyJournalLedgerLines, openingBalanceLedgerLines, SYSTEM_GENERAL_LEDGER_ACCOUNTS, interCompanyBuyerLedgerLines, interCompanySellerLedgerLines } from "./general-ledger-constants";

assert.deepEqual(balancedGeneralLedgerLines([{ accountCode: "1100", debit: 100 }, { accountCode: "4000", credit: 100 }]), { debit: 100, credit: 100, balanced: true });
assert.equal(balancedGeneralLedgerLines([{ accountCode: "1100", debit: 100 }, { accountCode: "4000", credit: 99.99 }]).balanced, false);
assert.equal(isOnOrAfterGlCutover("2026-08-26", "2026-08-26"), true);
assert.equal(isOnOrAfterGlCutover("2026-08-25", "2026-08-26"), false);
assert.equal(isOnOrAfterGlCutover("2026-08-26", ""), false);
assert.deepEqual(stockAdjustmentLedgerLines([{ movement: -1, cost: 50 }, { movement: 1, cost: 20 }]), [
  { accountCode: "6000", debit: 50, memo: "Inventory adjustment loss" },
  { accountCode: "1200", credit: 50, memo: "Inventory adjusted down" },
  { accountCode: "1200", debit: 20, memo: "Inventory adjusted up" },
  { accountCode: "4100", credit: 20, memo: "Inventory adjustment gain" },
]);
assert.deepEqual(stockAdjustmentLedgerLines([{ movement: 1, cost: 0 }]), []);
assert.deepEqual(partyJournalLedgerLines(-75, "6000"), [{ accountCode: "1100", debit: 75, memo: "Party receivable" }, { accountCode: "6000", credit: 75, memo: "Manual journal counterpart" }]);
assert.deepEqual(partyJournalLedgerLines(75, "1000"), [{ accountCode: "1000", debit: 75, memo: "Manual journal counterpart" }, { accountCode: "2000", credit: 75, memo: "Party payable" }]);
assert.deepEqual(openingBalanceLedgerLines(75), [{ accountCode: "1100", debit: 75, memo: "Opening receivable" }, { accountCode: "3000", credit: 75, memo: "Opening balances equity" }]);
assert.deepEqual(openingBalanceLedgerLines(-75), [{ accountCode: "3000", debit: 75, memo: "Opening balances equity" }, { accountCode: "2000", credit: 75, memo: "Opening payable" }]);
assert.deepEqual(SYSTEM_GENERAL_LEDGER_ACCOUNTS.map((account) => account.code), ["1000", "1100", "1200", "2000", "3000", "4000", "4010", "4100", "5000", "6000"]);
assert.equal(new Set(SYSTEM_GENERAL_LEDGER_ACCOUNTS.map((account) => account.code)).size, SYSTEM_GENERAL_LEDGER_ACCOUNTS.length, "control-account codes must be unique");
assert.deepEqual(SYSTEM_GENERAL_LEDGER_ACCOUNTS.map((account) => account.accountType), ["asset", "asset", "asset", "liability", "equity", "income", "income", "income", "expense", "expense"]);
assert.equal(balancedGeneralLedgerLines(interCompanySellerLedgerLines(120, 75)).balanced, true);
assert.equal(balancedGeneralLedgerLines(interCompanyBuyerLedgerLines(120)).balanced, true);
console.log("ok  general-ledger constants");
