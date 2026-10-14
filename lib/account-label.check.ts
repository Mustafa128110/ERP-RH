import assert from "node:assert/strict";
import {
  bankAccountLabel,
  bankAccountKey,
  getDuplicateBankTitleSet,
  formatBankAccountOptions,
  BANK_ACCOUNT_LABEL_SQL,
} from "./account-label";

// 1. Normalized key
assert.equal(bankAccountKey({ bankName: " HBL ", accountTitle: " Main Account " }), "hbl:main account");

// 2. Distinct accounts: branch is NOT shown
const singleAccount = [
  { bankName: "HBL", accountTitle: "Main Account", branchName: "Clifton" },
  { bankName: "Bank Alfalah", accountTitle: "Savings", branchName: "DHA" },
];
assert.equal(bankAccountLabel(singleAccount[0], singleAccount), "HBL:Main Account");
assert.equal(bankAccountLabel(singleAccount[1], singleAccount), "Bank Alfalah:Savings");

// 3. Duplicate bank:account title: branch IS shown for both
const duplicateAccounts = [
  { id: "1", bankName: "HBL", accountTitle: "Main Account", branchName: "Clifton" },
  { id: "2", bankName: "HBL", accountTitle: "Main Account", branchName: "DHA" },
  { id: "3", bankName: "Bank Alfalah", accountTitle: "Main Account", branchName: "Gulberg" },
];
const dupes = getDuplicateBankTitleSet(duplicateAccounts);
assert.ok(dupes.has("hbl:main account"));
assert.ok(!dupes.has("bank alfalah:main account"));

assert.equal(bankAccountLabel(duplicateAccounts[0], dupes), "HBL:Main Account (Clifton)");
assert.equal(bankAccountLabel(duplicateAccounts[1], dupes), "HBL:Main Account (DHA)");
assert.equal(bankAccountLabel(duplicateAccounts[2], dupes), "Bank Alfalah:Main Account");

// 4. Duplicate bank:account title where one has no branch
const missingBranch = [
  { bankName: "MCB", accountTitle: "Operating", branchName: "Main Branch" },
  { bankName: "MCB", accountTitle: "Operating", branchName: null },
];
assert.equal(bankAccountLabel(missingBranch[0], missingBranch), "MCB:Operating (Main Branch)");
assert.equal(bankAccountLabel(missingBranch[1], missingBranch), "MCB:Operating");

// 5. formatBankAccountOptions helper
const formatted = formatBankAccountOptions(duplicateAccounts);
assert.equal(formatted[0].name, "HBL:Main Account (Clifton)");
assert.equal(formatted[1].name, "HBL:Main Account (DHA)");
assert.equal(formatted[2].name, "Bank Alfalah:Main Account");

// 6. SQL definition has no em dash and uses duplicate checking
const sqlStr = BANK_ACCOUNT_LABEL_SQL();
assert.ok(!sqlStr.includes("—"), "SQL must not contain em dash");
assert.ok(sqlStr.includes("exists"), "SQL must check for duplicate account title");
assert.ok(sqlStr.includes("branch_name"), "SQL must include branch when duplicate");

console.log("account-label checks passed");
