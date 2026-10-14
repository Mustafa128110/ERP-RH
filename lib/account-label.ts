// How a bank account names itself on screen: bank:account title (branch).
// Branch is only shown if 2 or more accounts have the same bank:account title.
// No em dash separator is used anywhere.

export type BankAccountLike = {
  bankName: string;
  accountTitle?: string | null;
  branchName?: string | null;
  id?: string;
};

// Normalized key for duplicate detection: lower(bankName):lower(accountTitle)
export function bankAccountKey(account: BankAccountLike): string {
  const bank = (account.bankName ?? "").trim().toLowerCase();
  const title = (account.accountTitle ?? "").trim().toLowerCase();
  return `${bank}:${title}`;
}

// Finds which bank:title combinations appear 2 or more times across the given accounts.
export function getDuplicateBankTitleSet(accounts: BankAccountLike[]): Set<string> {
  const counts = new Map<string, number>();
  for (const a of accounts) {
    const key = bankAccountKey(a);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const duplicates = new Set<string>();
  for (const [key, count] of counts.entries()) {
    if (count >= 2) {
      duplicates.add(key);
    }
  }
  return duplicates;
}

// Formats a bank account label:
// "bank:account title (branch)" if 2 or more accounts have the same bank:account title,
// otherwise "bank:account title".
export function bankAccountLabel(
  account: BankAccountLike,
  duplicatesOrAll?: Set<string> | BankAccountLike[],
): string {
  const bank = (account.bankName ?? "").trim();
  const title = (account.accountTitle ?? "").trim();
  const branch = (account.branchName ?? "").trim();

  const base = title ? `${bank}:${title}` : bank;
  if (!branch) return base;

  const key = bankAccountKey(account);
  const isDuplicate =
    duplicatesOrAll instanceof Set
      ? duplicatesOrAll.has(key)
      : Array.isArray(duplicatesOrAll)
        ? duplicatesOrAll.filter((a) => bankAccountKey(a) === key).length >= 2
        : false;

  return isDuplicate ? `${base} (${branch})` : base;
}

// Helper to format a whole list of bank accounts at once with duplicate-aware labels.
export function formatBankAccountOptions<T extends BankAccountLike>(
  accounts: T[],
): (T & { name: string })[] {
  const dupes = getDuplicateBankTitleSet(accounts);
  return accounts.map((a) => ({
    ...a,
    name: bankAccountLabel(a, dupes),
  }));
}

// SQL equivalent using correlated EXISTS to check for duplicate (bank_name, account_title) in bank_accounts.
// Branch is only included when 2 or more accounts share the same bank and account title.
export const BANK_ACCOUNT_LABEL_SQL = (alias = "bank_accounts") =>
  `case
    when ${alias}.id is null then null
    when exists (
      select 1 from bank_accounts _other
      where _other.id <> ${alias}.id
        and lower(trim(_other.bank_name)) = lower(trim(${alias}.bank_name))
        and lower(trim(_other.account_title)) = lower(trim(${alias}.account_title))
    ) and nullif(trim(${alias}.branch_name), '') is not null
    then concat(trim(${alias}.bank_name), ':', trim(${alias}.account_title), ' (', trim(${alias}.branch_name), ')')
    else concat(trim(${alias}.bank_name), ':', trim(${alias}.account_title))
  end`;
