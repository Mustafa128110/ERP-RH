import "server-only";

import { and, eq, inArray, or } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { bankAccounts, cashAccounts, chequeRegister, generalLedgerAccounts, generalLedgerEntries, settings } from "@/lib/db/schema";
import { balancedGeneralLedgerLines, isOnOrAfterGlCutover, SYSTEM_GENERAL_LEDGER_ACCOUNTS, type GeneralLedgerLine } from "@/lib/general-ledger-constants";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const SYSTEM_ACCOUNTS = SYSTEM_GENERAL_LEDGER_ACCOUNTS;

async function ensureSystemAccounts(tx: Tx, companyIds: string[]) {
  const uniqueCompanyIds = [...new Set(companyIds)];
  if (uniqueCompanyIds.length === 0) return;
  await tx
    .insert(generalLedgerAccounts)
    .values(uniqueCompanyIds.flatMap((companyId) => SYSTEM_ACCOUNTS.map((account) => ({ companyId, ...account, isSystem: true }))))
    .onConflictDoNothing();
}

export async function postGeneralLedgerIfCutover(
  tx: Tx,
  input: { companyId: string; documentId: string; documentDate: string; lines: GeneralLedgerLine[] },
): Promise<boolean> {
  const [cutover] = await tx
    .select({ value: settings.value })
    .from(settings)
    .where(and(eq(settings.companyId, input.companyId), eq(settings.key, "gl_cutover_date")))
    .limit(1);
  if (!isOnOrAfterGlCutover(input.documentDate, cutover?.value)) return false;

  const balance = balancedGeneralLedgerLines(input.lines);
  if (!balance.balanced) throw new Error(`General-ledger posting is unbalanced (debit ${balance.debit}, credit ${balance.credit}).`);
  if (input.lines.some((line) => (line.debit ?? 0) < 0 || (line.credit ?? 0) < 0 || Boolean(line.debit) === Boolean(line.credit))) {
    throw new Error("Each general-ledger line must have exactly one positive side.");
  }

  await ensureSystemAccounts(tx, [input.companyId]);
  const requestedAccountIds = input.lines.flatMap((line) => line.accountId ? [line.accountId] : []);
  const accounts = await tx
    .select({ id: generalLedgerAccounts.id, code: generalLedgerAccounts.code, isActive: generalLedgerAccounts.isActive })
    .from(generalLedgerAccounts)
    .where(and(
      eq(generalLedgerAccounts.companyId, input.companyId),
      or(
        inArray(generalLedgerAccounts.code, SYSTEM_ACCOUNTS.map((account) => account.code)),
        requestedAccountIds.length ? inArray(generalLedgerAccounts.id, requestedAccountIds) : undefined,
      ),
    ));
  const accountIdByCode = new Map(accounts.map((account) => [account.code, account.id]));
  const activeAccountIds = new Set(accounts.filter((account) => account.isActive).map((account) => account.id));

  const values = input.lines.map((line) => {
    const accountId = line.accountId ?? (line.accountCode ? accountIdByCode.get(line.accountCode) : undefined);
    if (!accountId) throw new Error(`General-ledger account ${line.accountCode} is unavailable.`);
    if (!activeAccountIds.has(accountId)) throw new Error("The selected general-ledger account is inactive or does not belong to this company.");
    return {
      companyId: input.companyId,
      documentId: input.documentId,
      expenseId: null,
      accountId,
      debit: String(line.debit ?? 0),
      credit: String(line.credit ?? 0),
      memo: line.memo ?? null,
    };
  });
  await tx.insert(generalLedgerEntries).values(values);
  return true;
}

// A source that already has GL evidence cannot be backdated into the
// pre-cutover period. Otherwise an edit would append a reversal but skip the
// replacement posting, making an historic document appear to have been part
// of the new books. Post-cutover corrections may still change their date, and
// remain traceable through the appended reversal/replacement rows.
export async function assertGeneralLedgerDateStaysPostCutover(
  tx: Tx,
  input: { companyId: string; documentDate: string; documentId?: string; expenseId?: string },
): Promise<void> {
  if (Boolean(input.documentId) === Boolean(input.expenseId)) throw new Error("A GL source must be either a document or an expense.");
  const sourceWhere = input.documentId
    ? eq(generalLedgerEntries.documentId, input.documentId)
    : eq(generalLedgerEntries.expenseId, input.expenseId!);
  const [existing] = await tx
    .select({ id: generalLedgerEntries.id })
    .from(generalLedgerEntries)
    .where(and(eq(generalLedgerEntries.companyId, input.companyId), sourceWhere))
    .limit(1);
  if (!existing) return;
  const [cutover] = await tx
    .select({ value: settings.value })
    .from(settings)
    .where(and(eq(settings.companyId, input.companyId), eq(settings.key, "gl_cutover_date")))
    .limit(1);
  if (!isOnOrAfterGlCutover(input.documentDate, cutover?.value)) {
    throw new Error("A record with GL postings cannot be dated before the GL cutover date.");
  }
}

// Resolves a settlement's mapped GL account. The map is optional until a
// company completes its account-by-account cutover, so legacy rows retain the
// explicit 1000 Cash and Bank control-account fallback.
async function verifiedSettlementGeneralLedgerAccount(tx: Tx, companyId: string, generalLedgerAccountId: string | null): Promise<{ accountCode: "1000" } | { accountId: string }> {
  if (!generalLedgerAccountId) return { accountCode: "1000" };
  const [account] = await tx
    .select({ id: generalLedgerAccounts.id, accountType: generalLedgerAccounts.accountType })
    .from(generalLedgerAccounts)
    .where(and(eq(generalLedgerAccounts.id, generalLedgerAccountId), eq(generalLedgerAccounts.companyId, companyId), eq(generalLedgerAccounts.isActive, true)))
    .limit(1);
  if (!account || account.accountType !== "asset") throw new Error("The settlement account's GL mapping is inactive, invalid, or belongs to another company.");
  return { accountId: account.id };
}

export async function settlementGeneralLedgerAccount(
  tx: Tx,
  companyId: string,
  bankAccountId: string | null,
  cashAccountId: string | null,
  chequeId: string | null,
): Promise<{ accountCode: "1000" } | { accountId: string }> {
  if (bankAccountId) {
    const [account] = await tx
      .select({ companyId: bankAccounts.companyId, generalLedgerAccountId: bankAccounts.generalLedgerAccountId })
      .from(bankAccounts)
      .where(eq(bankAccounts.id, bankAccountId))
      .limit(1);
    if (!account || (account.companyId && account.companyId !== companyId)) throw new Error("The selected bank account does not belong to this company.");
    return verifiedSettlementGeneralLedgerAccount(tx, companyId, account.generalLedgerAccountId);
  }
  if (cashAccountId) {
    const [account] = await tx
      .select({ companyId: cashAccounts.companyId, generalLedgerAccountId: cashAccounts.generalLedgerAccountId })
      .from(cashAccounts)
      .where(eq(cashAccounts.id, cashAccountId))
      .limit(1);
    if (!account || account.companyId !== companyId) throw new Error("The selected cash account does not belong to this company.");
    return verifiedSettlementGeneralLedgerAccount(tx, companyId, account.generalLedgerAccountId);
  }
  if (chequeId) {
    const [cheque] = await tx
      .select({ companyId: chequeRegister.companyId, generalLedgerAccountId: bankAccounts.generalLedgerAccountId })
      .from(chequeRegister)
      .leftJoin(bankAccounts, eq(bankAccounts.id, chequeRegister.bankAccountId))
      .where(eq(chequeRegister.id, chequeId))
      .limit(1);
    if (!cheque || cheque.companyId !== companyId) throw new Error("The selected cheque does not belong to this company.");
    return verifiedSettlementGeneralLedgerAccount(tx, companyId, cheque.generalLedgerAccountId);
  }
  throw new Error("A settlement account is required for this posting.");
}

// General-ledger rows are immutable evidence. Corrections and cancellations add
// the exact opposite of every prior posting instead of deleting or rewriting
// it, leaving the document's net balance at zero while retaining the trail.
export async function reverseGeneralLedger(tx: Tx, companyId: string, documentId: string, memo: string): Promise<void> {
  await tx.execute(sql`
    INSERT INTO general_ledger_entries (company_id, document_id, expense_id, account_id, debit, credit, memo)
    SELECT company_id, document_id, expense_id, account_id, credit, debit, ${memo}
    FROM general_ledger_entries
    WHERE company_id = ${companyId}::uuid AND document_id = ${documentId}::uuid
  `);
}

type ExpensePosting = {
  expenseId: string;
  companyId: string;
  expenseDate: string;
  amount: string;
  memo: string | null;
  bankAccountId: string | null;
  cashAccountId: string | null;
  chequeId: string | null;
};

type PaymentPosting = {
  documentId: string;
  companyId: string;
  paymentDate: string;
  amount: string;
  direction: "received" | "made";
  bankAccountId: string | null;
  cashAccountId: string | null;
  chequeId: string | null;
};

// Batch payment entry follows the same single-INSERT pattern as batch
// expenses. A cashier's pasted sheet must not turn into two GL round trips for
// every row; each qualifying payment contributes exactly two balanced lines.
export async function postPaymentGeneralLedgerBatch(tx: Tx, postings: PaymentPosting[]): Promise<void> {
  if (postings.length === 0) return;
  await ensureSystemAccounts(tx, postings.map((posting) => posting.companyId));
  const values = sql.join(
    postings.map((posting) => sql`(${posting.documentId}::uuid, ${posting.companyId}::uuid, ${posting.paymentDate}::date, ${posting.amount}::numeric, ${posting.direction}::text, ${posting.bankAccountId}::uuid, ${posting.cashAccountId}::uuid, ${posting.chequeId}::uuid)`),
    sql`, `,
  );
  await tx.execute(sql`
    WITH input(document_id, company_id, payment_date, amount, direction, bank_account_id, cash_account_id, cheque_id) AS (VALUES ${values}),
    enabled AS (
      SELECT i.*
      FROM input i
      JOIN settings s ON s.company_id = i.company_id
                   AND s.key = 'gl_cutover_date'
                   AND nullif(s.value, '') IS NOT NULL
                   AND i.payment_date >= nullif(s.value, '')::date
    ),
    settlement AS (
      SELECT e.*, coalesce(mapped.id, control.id) AS settlement_account_id
      FROM enabled e
      LEFT JOIN cash_accounts ca ON ca.id = e.cash_account_id AND ca.company_id = e.company_id
      LEFT JOIN bank_accounts ba ON ba.id = e.bank_account_id AND (ba.company_id IS NULL OR ba.company_id = e.company_id)
      LEFT JOIN cheque_register q ON q.id = e.cheque_id AND q.company_id = e.company_id
      LEFT JOIN bank_accounts qb ON qb.id = q.bank_account_id AND (qb.company_id IS NULL OR qb.company_id = e.company_id)
      LEFT JOIN general_ledger_accounts mapped
        ON mapped.id = coalesce(ca.general_ledger_account_id, ba.general_ledger_account_id, qb.general_ledger_account_id)
       AND mapped.company_id = e.company_id
       AND mapped.is_active
       AND mapped.account_type = 'asset'
      JOIN general_ledger_accounts control ON control.company_id = e.company_id AND control.code = '1000'
    )
    INSERT INTO general_ledger_entries (company_id, document_id, expense_id, account_id, debit, credit, memo)
    SELECT s.company_id, s.document_id, NULL, s.settlement_account_id, s.amount, 0, 'Customer payment received'
    FROM settlement s WHERE s.direction = 'received'
    UNION ALL
    SELECT s.company_id, s.document_id, NULL, ar.id, 0, s.amount, 'Accounts receivable settled'
    FROM settlement s JOIN general_ledger_accounts ar ON ar.company_id = s.company_id AND ar.code = '1100'
    WHERE s.direction = 'received'
    UNION ALL
    SELECT s.company_id, s.document_id, NULL, ap.id, s.amount, 0, 'Supplier payable settled'
    FROM settlement s JOIN general_ledger_accounts ap ON ap.company_id = s.company_id AND ap.code = '2000'
    WHERE s.direction = 'made'
    UNION ALL
    SELECT s.company_id, s.document_id, NULL, s.settlement_account_id, 0, s.amount, 'Supplier payment made'
    FROM settlement s WHERE s.direction = 'made'
  `);
}

// A batch expense entry must remain a batch write: resolving/posting it one row
// at a time would turn a twenty-row petty-cash sheet into dozens of remote DB
// round trips. One INSERT SELECT posts each qualifying row's debit and credit.
export async function postExpenseGeneralLedgerBatch(tx: Tx, postings: ExpensePosting[]): Promise<void> {
  if (postings.length === 0) return;
  await ensureSystemAccounts(tx, postings.map((posting) => posting.companyId));
  const values = sql.join(
    postings.map((posting) => sql`(${posting.expenseId}::uuid, ${posting.companyId}::uuid, ${posting.expenseDate}::date, ${posting.amount}::numeric, ${posting.memo}::text, ${posting.bankAccountId}::uuid, ${posting.cashAccountId}::uuid, ${posting.chequeId}::uuid)`),
    sql`, `,
  );
  await tx.execute(sql`
    WITH input(expense_id, company_id, expense_date, amount, memo, bank_account_id, cash_account_id, cheque_id) AS (VALUES ${values}),
    enabled AS (
      SELECT i.*
      FROM input i
      JOIN settings s ON s.company_id = i.company_id
                   AND s.key = 'gl_cutover_date'
                   AND nullif(s.value, '') IS NOT NULL
                   AND i.expense_date >= nullif(s.value, '')::date
    )
    INSERT INTO general_ledger_entries (company_id, document_id, expense_id, account_id, debit, credit, memo)
    SELECT e.company_id, NULL, e.expense_id, a.id, e.amount, 0, coalesce(e.memo, 'Expense')
    FROM enabled e
    JOIN general_ledger_accounts a ON a.company_id = e.company_id AND a.code = '6000'
    UNION ALL
    SELECT e.company_id, NULL, e.expense_id,
           coalesce(mapped.id, control.id), 0, e.amount, 'Expense settlement'
    FROM enabled e
    LEFT JOIN cash_accounts ca ON ca.id = e.cash_account_id AND ca.company_id = e.company_id
    LEFT JOIN bank_accounts ba ON ba.id = e.bank_account_id AND (ba.company_id IS NULL OR ba.company_id = e.company_id)
    LEFT JOIN cheque_register q ON q.id = e.cheque_id AND q.company_id = e.company_id
    LEFT JOIN bank_accounts qb ON qb.id = q.bank_account_id AND (qb.company_id IS NULL OR qb.company_id = e.company_id)
    LEFT JOIN general_ledger_accounts mapped
      ON mapped.id = coalesce(ca.general_ledger_account_id, ba.general_ledger_account_id, qb.general_ledger_account_id)
     AND mapped.company_id = e.company_id
     AND mapped.is_active
     AND mapped.account_type = 'asset'
    JOIN general_ledger_accounts control ON control.company_id = e.company_id AND control.code = '1000'
  `);
}

export async function reverseExpenseGeneralLedger(tx: Tx, companyId: string, expenseId: string, memo: string): Promise<void> {
  await tx.execute(sql`
    INSERT INTO general_ledger_entries (company_id, document_id, expense_id, account_id, debit, credit, memo)
    SELECT company_id, document_id, expense_id, account_id, credit, debit, ${memo}
    FROM general_ledger_entries
    WHERE company_id = ${companyId}::uuid AND expense_id = ${expenseId}::uuid
  `);
}
