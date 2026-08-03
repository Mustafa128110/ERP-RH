// How a bank account names itself on screen: bank, branch, account title.
//
// The three were being used one at a time and inconsistently — the dropdowns
// showed "HBL - Clifton", the payments list showed only the account title, and
// the transfers list showed the title too. A shop with two accounts at the same
// bank could not tell which was which from the list, and could not tell the
// picker's "HBL - Clifton" was the same row as the list's "Royal Hardware
// Current". One format, everywhere.
//
// Branch is nullable, so it drops out rather than leaving a dangling separator.

export const ACCOUNT_SEPARATOR = " — ";

export function bankAccountLabel(account: { bankName: string; branchName?: string | null; accountTitle?: string | null }): string {
  return [account.bankName, account.branchName, account.accountTitle].filter(Boolean).join(ACCOUNT_SEPARATOR);
}

// The same rule as SQL, for the queries that build the label in the database
// rather than in JS. concat_ws skips NULLs, which is exactly the branch case —
// so the two cannot drift apart into "HBL —  — Current".
//
// nullif(…, '') matters: these labels come from a LEFT JOIN, and concat_ws over
// three NULLs returns an empty string rather than NULL. The transfers list picks
// its label with `bankAccount ?? cashAccount ?? "—"`, and `??` only falls
// through on null — so without this, a transfer out of a cash drawer would show
// a blank where the drawer's name belongs.
//
// Kept as a string rather than a drizzle `sql` fragment so this module stays
// importable from anywhere; the callers wrap it in sql.raw().
export const BANK_ACCOUNT_LABEL_SQL = (alias = "bank_accounts") =>
  `nullif(concat_ws('${ACCOUNT_SEPARATOR}', ${alias}.bank_name, ${alias}.branch_name, ${alias}.account_title), '')`;
