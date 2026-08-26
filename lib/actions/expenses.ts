"use server";

import { and, eq, desc, gte, lte, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import {
  expenses,
  expenseCategories,
  companies,
  users,
  bankAccounts,
  cashAccounts,
  chequeRegister,
} from "@/lib/db/schema";
import { getLiveSession, getSession } from "@/lib/auth/session";
import { requirePermission } from "@/lib/auth/permissions";
import { companyInPermissionScope, companyInScope, getScopeCompanyIds } from "@/lib/auth/scope";
import { adjustSettlementBalance, adjustSettlementBalancesBatch, type SettlementType } from "@/lib/actions/settlement";
import { resolveExpenseCategoryId, resolveExpenseCategoryIds } from "@/lib/actions/resolve-refs";
import { CACHE, getAvailableCheques, invalidateLookups, invalidateReads, READ_DOMAIN } from "@/lib/queries/lookups";
import { BANK_ACCOUNT_LABEL_SQL } from "@/lib/account-label";
import { guard, type ActionResult } from "@/lib/actions/guard";
import { recordAudit } from "@/lib/actions/audit";
import { claimOperation, readOperationId, DuplicateOperationError } from "@/lib/actions/operation-id";
import { cachedPageRead, stableReadKey } from "@/lib/read-cache";
import { assertGeneralLedgerDateStaysPostCutover, postExpenseGeneralLedgerBatch, reverseExpenseGeneralLedger } from "@/lib/actions/general-ledger";

export interface ExpenseFilters {
  company?: string;
  from?: string;
  to?: string;
}

// Filtered in SQL rather than over the returned array: the list is unbounded and
// grows with every expense ever recorded, so a JS filter would drag all of it
// across the wire to throw most of it away.
export async function listExpenses(filters: ExpenseFilters = {}) {
  const session = await getSession();
  requirePermission(session, "expenses", "view");
  const cacheScope = (await getScopeCompanyIds()).sort().join(",");

  return cachedPageRead(READ_DOMAIN.expenses, `${session.userId}:expenses:${cacheScope}:${stableReadKey(filters)}`, async () => {

  const rows = await db
    .select({
      id: expenses.id,
      companyId: expenses.companyId,
      company: sql<string>`coalesce(${companies.shortName}, ${companies.name})`,
      expenseCategoryId: expenses.expenseCategoryId,
      category: expenseCategories.name,
      bankAccountId: expenses.bankAccountId,
      cashAccountId: expenses.cashAccountId,
      chequeId: expenses.chequeId,
      // Same label as payments and transfers — an expense settled from an
      // account has to name it the way every other screen names it.
      bankAccountName: sql<string>`${sql.raw(BANK_ACCOUNT_LABEL_SQL())}`,
      cashAccountName: cashAccounts.name,
      chequeNumber: chequeRegister.chequeNumber,
      amount: expenses.amount,
      expenseDate: expenses.expenseDate,
      notes: expenses.notes,
      attachmentUrl: expenses.attachmentUrl,
      documentId: expenses.documentId,
      status: expenses.status,
      createdByName: users.name,
    })
    .from(expenses)
    .innerJoin(companies, eq(companies.id, expenses.companyId))
    .innerJoin(expenseCategories, eq(expenseCategories.id, expenses.expenseCategoryId))
    .leftJoin(bankAccounts, eq(bankAccounts.id, expenses.bankAccountId))
    .leftJoin(cashAccounts, eq(cashAccounts.id, expenses.cashAccountId))
    .leftJoin(chequeRegister, eq(chequeRegister.id, expenses.chequeId))
    .leftJoin(users, eq(users.id, expenses.createdBy))
    .where(
      and(
        await companyInPermissionScope(expenses.companyId, session, "expenses"),
        // Narrows within the scope, never widens it — companyInScope still gates
        // every row.
        filters.company ? eq(expenses.companyId, filters.company) : undefined,
        filters.from ? gte(expenses.expenseDate, filters.from) : undefined,
        filters.to ? lte(expenses.expenseDate, filters.to) : undefined,
      ),
    )
    // createdAt breaks the tie because a day's expenses all carry the same
    // expense_date — without it the order within today is whatever the planner
    // returns, so one just entered could land mid-list.
    .orderBy(desc(expenses.expenseDate), desc(expenses.createdAt));

  return rows.map(({ bankAccountName, cashAccountName, chequeNumber, ...rest }) => ({
    ...rest,
    paymentMethod: bankAccountName
      ? `Account: ${bankAccountName}`
      : cashAccountName
        ? `Cash: ${cashAccountName}`
        : chequeNumber
          ? `Cheque: ${chequeNumber}`
          : null,
  }));
  });
}

// Cheques available to settle an expense: unlinked everywhere, plus (when
// editing) the one already linked to this expense. Kept as an action because
// ExpenseManager re-fetches it from the browser when a row is opened for edit;
// the rest of this page's option lists come straight from lib/queries/lookups.
export async function listChequesForExpenses(currentExpenseId?: string) {
  return getAvailableCheques(undefined, currentExpenseId);
}

export interface ExpenseBatchRow {
  companyId: string;
  // Either a picked category or free-typed text, same as an item on a sale line:
  // an unrecognised name becomes a new category for that company on save.
  expenseCategoryId: string;
  expenseCategoryName: string;
  settlementType: SettlementType;
  bankAccountId: string | null;
  cashAccountId: string | null;
  chequeId: string | null;
  amount: string;
  expenseDate: string;
  notes: string | null;
}

export async function createExpensesBatch(rows: ExpenseBatchRow[], operationId?: string): Promise<ActionResult> {
  return guard("Couldn't save the expenses.", async () => {
    const session = await getLiveSession();
    requirePermission(session, "expenses", "create");
    // Minted by the batch dialog when it opened; a replayed submit of a
    // committed batch is refused rather than posting every row twice.
    const opId = operationId || crypto.randomUUID();

    // A row counts only if it's complete: category, date, positive amount, and
    // exactly one settlement target. Half-filled rows are skipped, not rejected.
    const valid = rows.filter(
      (r) =>
        r.companyId &&
        (r.expenseCategoryId || r.expenseCategoryName.trim()) &&
        r.expenseDate &&
        Number(r.amount) > 0 &&
        (r.bankAccountId || r.cashAccountId || r.chequeId),
    );
    if (valid.length === 0) {
      return { error: "Add at least one row with a company, category, date, amount, and a settlement account." };
    }
    // Rows were filled against cached option lists; a company access or
    // permission may have been revoked since. The cache prepares work, it never
    // grants it — every distinct company in the batch needs the create
    // permission THERE (membership is part of the scoped check), so a batch
    // spanning a company the user can no longer act in is refused wholesale.
    for (const companyId of new Set(valid.map((r) => r.companyId))) {
      requirePermission(session, "expenses", "create", { companyId });
    }

    // One transaction for the whole batch: each expense inserts and moves its
    // settlement balance, and if any row fails the lot rolls back rather than
    // leaving balances half-adjusted.
    //
    // Inside it, the work is grouped rather than looped. This used to run three
    // statements per row — resolve the category, insert, move the balance — and
    // every statement in a transaction is its own round trip to a database
    // ~170ms away, so a twenty-row batch of petty cash cost ten seconds. Twenty
    // rows are usually two or three distinct categories drawn on one account, so
    // grouping collapses sixty trips into about five.
    await db.transaction(async (tx) => {
      // First statement: claim the operation id, or abort as a duplicate.
      if (!(await claimOperation(tx, opId))) throw new DuplicateOperationError();
      const categoryIds = await resolveExpenseCategoryIds(
        tx,
        valid.map((row) => ({
          companyId: row.companyId,
          expenseCategoryId: row.expenseCategoryId || null,
          expenseCategoryName: row.expenseCategoryName,
        })),
      );

      const inserted = await tx.insert(expenses).values(
        valid.map((r, index) => ({
          companyId: r.companyId,
          expenseCategoryId: categoryIds[index]!,
          bankAccountId: r.bankAccountId,
          cashAccountId: r.cashAccountId,
          chequeId: r.chequeId,
          amount: r.amount,
          expenseDate: r.expenseDate,
          notes: r.notes,
          createdBy: session.userId,
        })),
      ).returning({ id: expenses.id });

      await adjustSettlementBalancesBatch(
        tx,
        valid.map((r) => ({
          direction: "out",
          amount: r.amount,
          bankAccountId: r.bankAccountId,
          cashAccountId: r.cashAccountId,
          chequeId: r.chequeId,
          sign: 1,
          companyId: r.companyId,
        })),
      );
      await postExpenseGeneralLedgerBatch(
        tx,
        valid.map((row, index) => ({
          expenseId: inserted[index]!.id,
          companyId: row.companyId,
          expenseDate: row.expenseDate,
          amount: row.amount,
          memo: row.notes,
          bankAccountId: row.bankAccountId,
          cashAccountId: row.cashAccountId,
          chequeId: row.chequeId,
        })),
      );
    });

    await invalidateLookups(CACHE.expenseCategories, CACHE.cheques);
    // The accounts screen shows the balance this expense moved, and the cheque
    // that paid it stops being available.
    await invalidateReads(READ_DOMAIN.expenses, READ_DOMAIN.accounts);
    revalidatePath("/expenses");
    revalidatePath("/dashboard");
    await recordAudit({
      action: "create",
      entity: "expense",
      summary: `${valid.length} expense(s) entered in batch`,
      companyId: valid[0]?.companyId,
      detail: `Total ${valid.reduce((sum, r) => sum + Number(r.amount || 0), 0)}`,
    });
    return { success: true };
  });
}

function readExpenseForm(formData: FormData) {
  const settlementType = String(formData.get("settlementType") ?? "") as SettlementType;
  return {
    companyId: String(formData.get("companyId") ?? ""),
    // Picked id when there is one, otherwise whatever was typed — resolved (and
    // created) inside the transaction below.
    expenseCategoryId: String(formData.get("expenseCategoryId") ?? ""),
    expenseCategoryName: String(formData.get("expenseCategoryName") ?? "").trim(),
    bankAccountId: settlementType === "account" ? String(formData.get("bankAccountId") ?? "") || null : null,
    cashAccountId: settlementType === "cash" ? String(formData.get("cashAccountId") ?? "") || null : null,
    chequeId: settlementType === "cheque" ? String(formData.get("chequeId") ?? "") || null : null,
    amount: String(formData.get("amount") ?? "0"),
    expenseDate: String(formData.get("expenseDate") ?? ""),
    notes: String(formData.get("notes") ?? "").trim() || null,
    attachmentUrl: String(formData.get("attachmentUrl") ?? "").trim() || null,
  };
}

export async function createExpense(_prevState: ActionResult | undefined, formData: FormData): Promise<ActionResult> {
  return guard("Couldn't save the expense.", async () => {
    const session = await getLiveSession();

    const { expenseCategoryId, expenseCategoryName, ...values } = readExpenseForm(formData);
    if (!values.companyId) return { error: "Company is required." };
    // Scoped to the submitted company: membership and per-company permission,
    // so a queued submission filled against a stale cache is refused rather
    // than written into a company the user can no longer create in.
    requirePermission(session, "expenses", "create", { companyId: values.companyId });
    if (!expenseCategoryId && !expenseCategoryName) return { error: "Category is required." };
    if (!values.expenseDate) return { error: "Date is required." };
    if (Number.isNaN(Number(values.amount)) || Number(values.amount) <= 0) return { error: "Amount must be greater than zero." };
    if (!values.bankAccountId && !values.cashAccountId && !values.chequeId) return { error: "Select an account, cash account, or cheque." };
    const operationId = readOperationId(formData);

    await db.transaction(async (tx) => {
      // First statement: claim the operation id, or abort as a duplicate.
      if (!(await claimOperation(tx, operationId))) throw new DuplicateOperationError();
      const categoryId = (await resolveExpenseCategoryId(tx, values.companyId, expenseCategoryId || null, expenseCategoryName))!;
      const [expense] = await tx.insert(expenses).values({ ...values, expenseCategoryId: categoryId, createdBy: session.userId }).returning({ id: expenses.id });
      await adjustSettlementBalance(tx, "out", values.amount, values.bankAccountId, values.cashAccountId, values.chequeId, 1, values.companyId);
      await postExpenseGeneralLedgerBatch(tx, [{ expenseId: expense.id, companyId: values.companyId, expenseDate: values.expenseDate, amount: values.amount, memo: values.notes, bankAccountId: values.bankAccountId, cashAccountId: values.cashAccountId, chequeId: values.chequeId }]);
    });

    await invalidateLookups(CACHE.expenseCategories, CACHE.cheques);
    // The accounts screen shows the balance this expense moved, and the cheque
    // that paid it stops being available.
    await invalidateReads(READ_DOMAIN.expenses, READ_DOMAIN.accounts);
    revalidatePath("/expenses");
    revalidatePath("/dashboard");
    await recordAudit({ action: "create", entity: "expense", summary: expenseCategoryName || "Expense", companyId: values.companyId, detail: `Amount ${values.amount}` });
    return { success: true };
  });
}

export async function updateExpense(expenseId: string, _prevState: ActionResult | undefined, formData: FormData): Promise<ActionResult> {
  return guard("Couldn't save the expense.", async () => {
    const session = await getLiveSession();

    const { expenseCategoryId, expenseCategoryName, ...values } = readExpenseForm(formData);
    // Scoped to the submitted company — the update below rewrites the row's
    // company_id from the form, so a forged or stale companyId must not steer
    // it into a company the user can't edit in.
    requirePermission(session, "expenses", "edit", { companyId: values.companyId });
    if (!expenseCategoryId && !expenseCategoryName) return { error: "Category is required." };
    if (!values.expenseDate) return { error: "Date is required." };
    if (Number.isNaN(Number(values.amount)) || Number(values.amount) <= 0) return { error: "Amount must be greater than zero." };
    if (!values.bankAccountId && !values.cashAccountId && !values.chequeId) return { error: "Select an account, cash account, or cheque." };

    let missing = false;
    let companyChanged = false;

    await db.transaction(async (tx) => {
      // Read the old settlement inside the transaction, not before it. Read
      // outside, two people editing the same expense both saw the same "before"
      // and each reversed it, so the account balance ended up short by one
      // expense. `FOR UPDATE` makes the second wait for the first to commit and
      // then read what it actually wrote.
      const [existing] = await tx
        .select({ id: expenses.id, companyId: expenses.companyId, amount: expenses.amount, bankAccountId: expenses.bankAccountId, cashAccountId: expenses.cashAccountId, chequeId: expenses.chequeId })
        .from(expenses)
        // Scoped to the session's current companies: an edit form opened
        // before access was revoked must not be able to write into a company
        // the user can no longer reach.
        .where(and(eq(expenses.id, expenseId), eq(expenses.status, "posted"), sql`${expenses.documentId} IS NULL`, await companyInScope(expenses.companyId)))
        .limit(1)
        .for("update");
      // Nothing has been written yet, so returning here commits an empty
      // transaction rather than needing a rollback.
      if (!existing) {
        missing = true;
        return;
      }
      if (existing.companyId !== values.companyId) {
        companyChanged = true;
        return;
      }

      await assertGeneralLedgerDateStaysPostCutover(tx, { companyId: existing.companyId, expenseId: existing.id, documentDate: values.expenseDate });
      // Reverse the old settlement before applying the new one, same as Payments.
      await adjustSettlementBalance(tx, "out", existing.amount, existing.bankAccountId, existing.cashAccountId, existing.chequeId, -1, existing.companyId);
      await reverseExpenseGeneralLedger(tx, existing.companyId, existing.id, "Reversed before expense correction");
      const categoryId = (await resolveExpenseCategoryId(tx, values.companyId, expenseCategoryId || null, expenseCategoryName))!;
      await tx.update(expenses).set({ ...values, expenseCategoryId: categoryId }).where(eq(expenses.id, expenseId));
      await adjustSettlementBalance(tx, "out", values.amount, values.bankAccountId, values.cashAccountId, values.chequeId, 1, values.companyId);
      await postExpenseGeneralLedgerBatch(tx, [{ expenseId: existing.id, companyId: values.companyId, expenseDate: values.expenseDate, amount: values.amount, memo: values.notes, bankAccountId: values.bankAccountId, cashAccountId: values.cashAccountId, chequeId: values.chequeId }]);
    });

    if (missing) return { error: "Expense not found — it may already be cancelled." };
    if (companyChanged) return { error: "An expense can't be moved to another company. Delete it and enter it in the correct company." };

    await invalidateLookups(CACHE.expenseCategories, CACHE.cheques);
    // The accounts screen shows the balance this expense moved, and the cheque
    // that paid it stops being available.
    await invalidateReads(READ_DOMAIN.expenses, READ_DOMAIN.accounts);
    revalidatePath("/expenses");
    revalidatePath("/dashboard");
    await recordAudit({ action: "update", entity: "expense", entityId: expenseId, summary: expenseCategoryName || "Expense", companyId: values.companyId, detail: `Amount ${values.amount}` });
    return { success: true };
  });
}

export async function deleteExpense(_prevState: ActionResult | undefined, formData: FormData): Promise<ActionResult> {
  return guard("Can't cancel this expense.", async () => {
    const session = await getLiveSession();
    requirePermission(session, "expenses", "delete");

    const expenseId = String(formData.get("expenseId") ?? "");
    let missing = false;

    await db.transaction(async (tx) => {
      const [existing] = await tx
        .select({ id: expenses.id, companyId: expenses.companyId, amount: expenses.amount, bankAccountId: expenses.bankAccountId, cashAccountId: expenses.cashAccountId, chequeId: expenses.chequeId })
        .from(expenses)
        // Same scope rule as updateExpense: a delete is a write, and a write
        // into a company the user no longer has access to is refused.
        .where(and(eq(expenses.id, expenseId), eq(expenses.status, "posted"), sql`${expenses.documentId} IS NULL`, await companyInScope(expenses.companyId)))
        .limit(1)
        .for("update");
      if (!existing) {
        missing = true;
        return;
      }
      // The delete permission is checked against the row's own company — a
      // guessed id from a company the user can't delete in is refused even
      // when they hold the permission somewhere else.
      requirePermission(session, "expenses", "delete", { companyId: existing.companyId });
      await adjustSettlementBalance(tx, "out", existing.amount, existing.bankAccountId, existing.cashAccountId, existing.chequeId, -1, existing.companyId);
      await reverseExpenseGeneralLedger(tx, existing.companyId, existing.id, "Expense cancelled");
      await tx.update(expenses).set({ status: "cancelled", cancelledBy: session.userId, cancelledAt: new Date() }).where(eq(expenses.id, expenseId));
    });

    if (missing) return { error: "Expense not found — it may already be cancelled." };

    await invalidateLookups(CACHE.expenseCategories, CACHE.cheques);
    // The accounts screen shows the balance this expense moved, and the cheque
    // that paid it stops being available.
    await invalidateReads(READ_DOMAIN.expenses, READ_DOMAIN.accounts);
    revalidatePath("/expenses");
    revalidatePath("/dashboard");
    await recordAudit({ action: "cancel", entity: "expense", entityId: expenseId, summary: expenseId });
    return { success: true };
  });
}
