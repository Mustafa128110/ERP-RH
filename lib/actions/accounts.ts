"use server";

import { and, desc, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { bankAccounts, cashAccounts, chequeRegister, documentNumberLedger, documents, generalLedgerAccounts, generalLedgerEntries, settings } from "@/lib/db/schema";
import { getLiveSession, getSession } from "@/lib/auth/session";
import { requirePermission } from "@/lib/auth/permissions";
import { companyInPermissionScope, companyInScope, getScopeCompanyIds } from "@/lib/auth/scope";
import { CACHE, invalidateLookups, invalidateReads, READ_DOMAIN } from "@/lib/queries/lookups";
import { CHEQUE_TYPES, CHEQUE_STATUSES } from "@/lib/cheque-constants";
import { guard, DUPLICATE, type ActionResult, type CreateResult } from "@/lib/actions/guard";
import { bankAccountLabel } from "@/lib/account-label";
import { recordAudit } from "@/lib/actions/audit";
import { resolveContactIds } from "@/lib/actions/resolve-refs";
import { claimOperation, DuplicateOperationError, readOperationId } from "@/lib/actions/operation-id";
import { cachedPageRead } from "@/lib/read-cache";
import { isOnOrAfterGlCutover, SYSTEM_GENERAL_LEDGER_ACCOUNTS } from "@/lib/general-ledger-constants";
import { ensureDocumentType, nextDocumentNumber } from "@/lib/actions/document-numbering";
import { postGeneralLedgerIfCutover, reverseGeneralLedger } from "@/lib/actions/general-ledger";
import { isValidIsoDate } from "@/lib/setting-constants";

const GL_ACCOUNT_TYPES = ["asset", "liability", "equity", "income", "expense"] as const;

export async function listGeneralLedgerAccounts(companyId: string) {
  const session = await getSession();
  requirePermission(session, "accounts", "view", { companyId });
  return db
    .select({ id: generalLedgerAccounts.id, code: generalLedgerAccounts.code, name: generalLedgerAccounts.name, accountType: generalLedgerAccounts.accountType, isSystem: generalLedgerAccounts.isSystem, isActive: generalLedgerAccounts.isActive })
    .from(generalLedgerAccounts)
    .where(and(eq(generalLedgerAccounts.companyId, companyId), eq(generalLedgerAccounts.isActive, true)))
    .orderBy(generalLedgerAccounts.code);
}

export async function listGeneralLedgerOpeningBalances(companyId: string) {
  const session = await getSession();
  requirePermission(session, "accounts", "view", { companyId });
  return db
    .select({ id: documents.id, number: documents.number, documentDate: documents.documentDate, amount: documents.grandTotal })
    .from(documents)
    .where(and(eq(documents.companyId, companyId), eq(documents.reason, "GL Opening Balance"), eq(documents.status, "posted")))
    .orderBy(desc(documents.documentDate), desc(documents.createdAt));
}

export async function createGeneralLedgerAccount(
  companyId: string,
  _prevState: ActionResult | undefined,
  formData: FormData,
): Promise<ActionResult> {
  return guard("Couldn't create the general-ledger account.", async () => {
    const session = await getLiveSession();
    requirePermission(session, "accounts", "create", { companyId });
    const code = String(formData.get("code") ?? "").trim();
    const name = String(formData.get("name") ?? "").trim();
    const accountType = String(formData.get("accountType") ?? "");
    if (!code || !name) return { error: "Account code and name are required." };
    if (!GL_ACCOUNT_TYPES.includes(accountType as (typeof GL_ACCOUNT_TYPES)[number])) return { error: "Pick an account type." };
    const [created] = await db.insert(generalLedgerAccounts).values({ companyId, code, name, accountType: accountType as (typeof GL_ACCOUNT_TYPES)[number] }).returning({ id: generalLedgerAccounts.id });
    await invalidateAccounts();
    revalidatePath("/accounts");
    await recordAudit({ action: "create", entity: "general-ledger account", entityId: created.id, summary: `${code} — ${name}`, companyId });
    return { success: true };
  }, { [DUPLICATE]: "That GL account code already exists for this company." });
}

// Accounts with any accounting evidence or settlement routing stay immutable.
// A custom account that was created by mistake but has never been used can be
// deactivated; this keeps it out of new selections without erasing anything.
export async function deactivateGeneralLedgerAccount(accountId: string): Promise<ActionResult> {
  return guard("Couldn't deactivate the general-ledger account.", async () => {
    const session = await getLiveSession();
    const [account] = await db
      .select({ id: generalLedgerAccounts.id, code: generalLedgerAccounts.code, companyId: generalLedgerAccounts.companyId, isSystem: generalLedgerAccounts.isSystem })
      .from(generalLedgerAccounts)
      .where(and(eq(generalLedgerAccounts.id, accountId), await companyInScope(generalLedgerAccounts.companyId)))
      .limit(1);
    if (!account) return { error: "GL account not found." };
    requirePermission(session, "accounts", "edit", { companyId: account.companyId });
    if (account.isSystem) return { error: "System control accounts cannot be deactivated." };
    const [[entry], [bankMapping], [cashMapping]] = await Promise.all([
      db.select({ id: generalLedgerEntries.id }).from(generalLedgerEntries).where(eq(generalLedgerEntries.accountId, accountId)).limit(1),
      db.select({ id: bankAccounts.id }).from(bankAccounts).where(eq(bankAccounts.generalLedgerAccountId, accountId)).limit(1),
      db.select({ id: cashAccounts.id }).from(cashAccounts).where(eq(cashAccounts.generalLedgerAccountId, accountId)).limit(1),
    ]);
    if (entry) return { error: "This GL account has posted entries and cannot be deactivated." };
    if (bankMapping || cashMapping) return { error: "Clear every cash/bank mapping to this GL account before deactivating it." };
    await db.update(generalLedgerAccounts).set({ isActive: false, updatedAt: new Date() }).where(eq(generalLedgerAccounts.id, accountId));
    await invalidateAccounts();
    revalidatePath("/accounts");
    revalidatePath("/accounts/gl");
    await recordAudit({ action: "update", entity: "general-ledger account", entityId: accountId, summary: `Deactivated ${account.code}`, companyId: account.companyId });
    return { success: true };
  });
}

// Cutover is a deliberate, reviewable operation. Initializing the control
// chart here means an accountant can map real settlement accounts and inspect
// opening balances before the date setting enables any posting.
export async function initializeGeneralLedgerAccounts(companyId: string): Promise<ActionResult> {
  return guard("Couldn't initialize the general-ledger control accounts.", async () => {
    const session = await getLiveSession();
    requirePermission(session, "accounts", "create", { companyId });
    const existing = await db
      .select({ code: generalLedgerAccounts.code, accountType: generalLedgerAccounts.accountType, isSystem: generalLedgerAccounts.isSystem })
      .from(generalLedgerAccounts)
      .where(and(eq(generalLedgerAccounts.companyId, companyId), inArray(generalLedgerAccounts.code, SYSTEM_GENERAL_LEDGER_ACCOUNTS.map((account) => account.code))));
    const requiredByCode = new Map<string, (typeof SYSTEM_GENERAL_LEDGER_ACCOUNTS)[number]>(SYSTEM_GENERAL_LEDGER_ACCOUNTS.map((account) => [account.code, account]));
    const collision = existing.find((account) => {
      const required = requiredByCode.get(account.code)!;
      return !account.isSystem || account.accountType !== required.accountType;
    });
    if (collision) return { error: `GL code ${collision.code} is already used by a non-control account. Rename or reclassify it before initializing the control chart.` };
    await db.insert(generalLedgerAccounts)
      .values(SYSTEM_GENERAL_LEDGER_ACCOUNTS.map((account) => ({ companyId, ...account, isSystem: true })))
      .onConflictDoNothing();
    await invalidateAccounts();
    revalidatePath("/accounts");
    revalidatePath("/accounts/gl");
    await recordAudit({ action: "create", entity: "general-ledger control accounts", summary: "Initialized GL control chart", companyId });
    return { success: true };
  });
}

// Opening balances are actual, dated evidence in the new book — never a view
// assembled from mutable current balances. Each entry pairs the selected asset,
// liability or equity account against the opening-balances equity control.
export async function createGeneralLedgerOpeningBalance(
  companyId: string,
  _prevState: ActionResult | undefined,
  formData: FormData,
): Promise<ActionResult> {
  return guard("Couldn't record the GL opening balance.", async () => {
    const session = await getLiveSession();
    requirePermission(session, "accounts", "create", { companyId });
    const accountId = String(formData.get("accountId") ?? "");
    const documentDate = String(formData.get("documentDate") ?? "");
    const signedAmount = Number(String(formData.get("amount") ?? "").trim());
    const memo = String(formData.get("memo") ?? "").trim();
    if (!accountId || !documentDate) return { error: "Choose an account and opening-balance date." };
    if (!isValidIsoDate(documentDate)) return { error: "Enter a valid opening-balance date." };
    if (!Number.isFinite(signedAmount) || signedAmount === 0) return { error: "Opening balance must be a non-zero amount. Use positive for debit and negative for credit." };

    const [[cutover], [account]] = await Promise.all([
      db.select({ value: settings.value }).from(settings).where(and(eq(settings.companyId, companyId), eq(settings.key, "gl_cutover_date"))).limit(1),
      db.select({ id: generalLedgerAccounts.id, code: generalLedgerAccounts.code }).from(generalLedgerAccounts).where(and(eq(generalLedgerAccounts.id, accountId), eq(generalLedgerAccounts.companyId, companyId), eq(generalLedgerAccounts.isActive, true))).limit(1),
    ]);
    if (!isOnOrAfterGlCutover(documentDate, cutover?.value)) return { error: "Set the GL cutover date first, then use that date or a later one for the opening balance." };
    if (!account || account.code === "3000") return { error: "Choose an active GL account other than Opening Balances Equity." };

    const documentType = await ensureDocumentType({ companyId, code: "JOURNAL_ENTRY", name: "Journal Entry", series: "JE", affectsAccounting: true, active: true });
    const operationId = readOperationId(formData);
    let createdId = "";
    let number = "";
    await db.transaction(async (tx) => {
      if (!(await claimOperation(tx, operationId))) throw new DuplicateOperationError();
      number = await nextDocumentNumber(documentType.series, tx);
      const magnitude = Math.abs(signedAmount).toFixed(2);
      const [document] = await tx.insert(documents).values({
        companyId,
        documentTypeId: documentType.id,
        number,
        status: "posted",
        documentDate,
        subtotal: magnitude,
        grandTotal: magnitude,
        reason: "GL Opening Balance",
        createdBy: session.userId,
      }).returning({ id: documents.id });
      createdId = document.id;
      await tx.insert(documentNumberLedger).values({ companyId, documentTypeId: documentType.id, number, documentId: document.id });
      const lines = signedAmount > 0
        ? [{ accountId, debit: Math.abs(signedAmount), memo: memo || "Opening balance" }, { accountCode: "3000", credit: Math.abs(signedAmount), memo: "Opening balances equity" }]
        : [{ accountCode: "3000", debit: Math.abs(signedAmount), memo: "Opening balances equity" }, { accountId, credit: Math.abs(signedAmount), memo: memo || "Opening balance" }];
      await postGeneralLedgerIfCutover(tx, { companyId, documentId: document.id, documentDate, lines });
    });
    await invalidateLookups(CACHE.documentTypes);
    await invalidateReads(READ_DOMAIN.accounts, READ_DOMAIN.ledger);
    revalidatePath("/accounts");
    revalidatePath("/accounts/gl");
    revalidatePath("/reports");
    await recordAudit({ action: "create", entity: "general-ledger opening balance", entityId: createdId, summary: number, companyId, detail: `${account.code} ${signedAmount.toFixed(2)}${memo ? ` — ${memo}` : ""}` });
    return { success: true };
  }, { [DUPLICATE]: "That opening-balance journal was already recorded." });
}

// A general-ledger opening entry is never deleted. Its cancellation appends the
// exact opposing GL lines and marks the numbered source document cancelled,
// leaving the original balance and the correction both available to an audit.
export async function cancelGeneralLedgerOpeningBalance(documentId: string): Promise<ActionResult> {
  return guard("Couldn't cancel the GL opening balance.", async () => {
    const session = await getLiveSession();
    const [existing] = await db
      .select({ id: documents.id, companyId: documents.companyId, number: documents.number })
      .from(documents)
      .where(and(eq(documents.id, documentId), eq(documents.reason, "GL Opening Balance"), eq(documents.status, "posted"), await companyInScope(documents.companyId)))
      .limit(1);
    if (!existing) return { error: "GL opening balance not found — it may already be cancelled." };
    requirePermission(session, "accounts", "delete", { companyId: existing.companyId });
    await db.transaction(async (tx) => {
      const [locked] = await tx
        .select({ id: documents.id })
        .from(documents)
        .where(and(eq(documents.id, documentId), eq(documents.reason, "GL Opening Balance"), eq(documents.status, "posted")))
        .limit(1)
        .for("update");
      if (!locked) throw new Error("GL opening balance was already cancelled.");
      await reverseGeneralLedger(tx, existing.companyId, documentId, "GL opening balance cancelled");
      await tx.update(documents).set({ status: "cancelled", cancelledBy: session.userId, cancelledAt: new Date(), updatedAt: new Date() }).where(eq(documents.id, documentId));
    });
    await invalidateReads(READ_DOMAIN.accounts, READ_DOMAIN.ledger);
    revalidatePath("/accounts");
    revalidatePath("/accounts/gl");
    revalidatePath("/reports");
    await recordAudit({ action: "cancel", entity: "general-ledger opening balance", entityId: documentId, summary: existing.number, companyId: existing.companyId });
    return { success: true };
  });
}

export async function mapSettlementAccountToGeneralLedger(
  kind: "bank" | "cash",
  accountId: string,
  generalLedgerAccountId: string | null,
): Promise<ActionResult> {
  return guard("Couldn't update the GL account mapping.", async () => {
    const session = await getLiveSession();
    const [account] = kind === "bank"
      ? await db.select({ companyId: bankAccounts.companyId }).from(bankAccounts).where(and(eq(bankAccounts.id, accountId), await companyInScope(bankAccounts.companyId))).limit(1)
      : await db.select({ companyId: cashAccounts.companyId }).from(cashAccounts).where(and(eq(cashAccounts.id, accountId), await companyInScope(cashAccounts.companyId))).limit(1);
    if (!account?.companyId) return { error: "Only company-specific cash or bank accounts can have a GL mapping." };
    requirePermission(session, "accounts", "edit", { companyId: account.companyId });
    if (generalLedgerAccountId) {
      const [gl] = await db.select({ id: generalLedgerAccounts.id, accountType: generalLedgerAccounts.accountType }).from(generalLedgerAccounts).where(and(eq(generalLedgerAccounts.id, generalLedgerAccountId), eq(generalLedgerAccounts.companyId, account.companyId), eq(generalLedgerAccounts.isActive, true))).limit(1);
      if (!gl || gl.accountType !== "asset") return { error: "Select an active asset GL account from the same company." };
    }
    if (kind === "bank") {
      await db.update(bankAccounts).set({ generalLedgerAccountId }).where(eq(bankAccounts.id, accountId));
    } else {
      await db.update(cashAccounts).set({ generalLedgerAccountId }).where(eq(cashAccounts.id, accountId));
    }
    await invalidateAccounts();
    revalidatePath("/accounts");
    await recordAudit({ action: "update", entity: `${kind} account GL mapping`, entityId: accountId, summary: generalLedgerAccountId ? "Mapped settlement account" : "Cleared settlement-account mapping", companyId: account.companyId });
    return { success: true };
  });
}

// Every account and cheque write goes through guard(): the hand-written messages
// below are what a duplicate key should say, and guard adds the cases nobody can
// write by hand — a dropped connection, a lock timeout, two people saving the
// same row — each of which promises nothing was written, because nothing was.

// Accounts and cheques all read from the same three cached lookups, and any
// write to any of them can change what the others offer.
//
// The page reads go with them. Beyond the accounts screen itself: payments and
// expenses both name the account or cheque that settled them, and the ledger
// joins the settlement accounts to drop payments booked against another
// company's account — so renaming a bank account changes four lists, and the
// coverage rule in lib/cache.check.ts is what says so.
const invalidateAccounts = async () => {
  await invalidateLookups(CACHE.bankAccounts, CACHE.cashAccounts, CACHE.cheques);
  await invalidateReads(READ_DOMAIN.accounts, READ_DOMAIN.payments, READ_DOMAIN.expenses, READ_DOMAIN.ledger);
};

export async function listBankAccounts() {
  const session = await getSession();
  requirePermission(session, "accounts", "view");
  const scope = (await getScopeCompanyIds()).sort().join(",");
  return cachedPageRead(READ_DOMAIN.accounts, `${session.userId}:accounts:bank:${scope}`, async () =>
    db.select().from(bankAccounts).where(await companyInPermissionScope(bankAccounts.companyId, session, "accounts")),
  );
}

export async function listCashAccounts() {
  const session = await getSession();
  requirePermission(session, "accounts", "view");
  const scope = (await getScopeCompanyIds()).sort().join(",");
  return cachedPageRead(READ_DOMAIN.accounts, `${session.userId}:accounts:cash:${scope}`, async () =>
    db.select().from(cashAccounts).where(await companyInPermissionScope(cashAccounts.companyId, session, "accounts")),
  );
}

export async function listCheques() {
  const session = await getSession();
  requirePermission(session, "cheques", "view");
  const scope = (await getScopeCompanyIds()).sort().join(",");
  return cachedPageRead(READ_DOMAIN.accounts, `${session.userId}:accounts:cheques:${scope}`, async () =>
    db.select().from(chequeRegister).where(await companyInPermissionScope(chequeRegister.companyId, session, "cheques")),
  );
}

// --- Bank accounts ---

function readBankAccountForm(formData: FormData) {
  return {
    companyId: String(formData.get("companyId") ?? "") || null,
    bankName: String(formData.get("bankName") ?? "").trim(),
    branchName: String(formData.get("branchName") ?? "").trim() || null,
    accountTitle: String(formData.get("accountTitle") ?? "").trim(),
    accountNumber: String(formData.get("accountNumber") ?? "").trim(),
    iban: String(formData.get("iban") ?? "").trim() || null,
    openingBalance: String(formData.get("openingBalance") ?? "0"),
    // Normally moved by payments and expenses (adjustSettlementBalance); editable
    // here so a balance that has drifted from the real account can be corrected
    // without inventing a fake transaction.
    currentBalance: String(formData.get("currentBalance") ?? "0"),
    isDefault: formData.get("isDefault") === "on",
    isActive: formData.get("isActive") === "on",
  };
}

export async function updateBankAccount(accountId: string, _prevState: ActionResult | undefined, formData: FormData): Promise<ActionResult> {
  return guard(
    "Couldn't save the bank account.",
    async () => {
      const session = await getLiveSession();

      const values = readBankAccountForm(formData);
      if (!values.bankName) return { error: "Bank name is required." };
      // A global account (no company) needs only the module permission; a
      // company account is scoped — membership + per-company permission — and
      // the row itself is updated scoped below.
      if (values.companyId) requirePermission(session, "accounts", "edit", { companyId: values.companyId });
      else requirePermission(session, "accounts", "edit");
      if (!values.accountTitle) return { error: "Account title is required." };
      if (!values.accountNumber) return { error: "Account number is required." };

      await db
        .update(bankAccounts)
        .set(values)
        .where(and(eq(bankAccounts.id, accountId), await companyInScope(bankAccounts.companyId)));

      await invalidateAccounts();
      revalidatePath("/accounts");
      await recordAudit({ action: "update", entity: "bank account", entityId: accountId, summary: values.bankName, companyId: values.companyId, detail: `Balance ${values.currentBalance}` });
      return { success: true };
    },
    { [DUPLICATE]: "Can't save — this account number already exists for this company." },
  );
}

export async function deleteBankAccount(_prevState: ActionResult | undefined, formData: FormData): Promise<ActionResult> {
  return guard("Can't delete — this account is still referenced by cheques or documents.", async () => {
    const session = await getLiveSession();
    requirePermission(session, "accounts", "delete");

    const accountId = String(formData.get("accountId") ?? "");
    // Read scoped: a guessed id from an unauthorized company is "not found".
    const [existing] = await db
      .select({ companyId: bankAccounts.companyId })
      .from(bankAccounts)
      .where(and(eq(bankAccounts.id, accountId), await companyInScope(bankAccounts.companyId)))
      .limit(1);
    if (!existing) return { error: "Account not found." };
    requirePermission(session, "accounts", "delete", { companyId: existing.companyId ?? undefined });
    await db.delete(bankAccounts).where(eq(bankAccounts.id, accountId));

    await invalidateAccounts();
    revalidatePath("/accounts");
    await recordAudit({ action: "delete", entity: "bank account", entityId: accountId, summary: accountId });
    return { success: true };
  });
}

export interface BankAccountBatchRow {
  companyId: string | null;
  bankName: string;
  branchName: string | null;
  accountTitle: string;
  accountNumber: string;
  iban: string | null;
  openingBalance: string;
  isDefault: boolean;
  isActive: boolean;
}

// Returns each created account labelled the way the cheque form's bank-account
// dropdown shows them, so a quick-add from there can select the new one.
export async function createBankAccountsBatch(
  rows: BankAccountBatchRow[],
): Promise<CreateResult<{ id: string; name: string; companyId: string | null }>> {
  return guard(
    "Couldn't save the bank accounts.",
    async () => {
      const session = await getLiveSession();
      requirePermission(session, "accounts", "create");

      const valid = rows.filter((r) => r.bankName.trim() && r.accountTitle.trim() && r.accountNumber.trim());
      if (valid.length === 0) return { error: "Add at least one bank account with a bank name, account title, and account number." };
      // Every company the batch files under must be one the user belongs to and
      // can create accounts in.
      for (const companyId of new Set(valid.map((r) => r.companyId).filter((c): c is string => !!c))) {
        requirePermission(session, "accounts", "create", { companyId });
      }

      const inserted = await db
        .insert(bankAccounts)
        .values(valid.map((r) => ({ ...r, currentBalance: r.openingBalance })))
        .returning({
          id: bankAccounts.id,
          bankName: bankAccounts.bankName,
          branchName: bankAccounts.branchName,
          accountTitle: bankAccounts.accountTitle,
          // Carried back so a picker that narrows accounts to one company can
          // show the account that was just created from inside it.
          companyId: bankAccounts.companyId,
        });

      await invalidateAccounts();
      revalidatePath("/accounts");
      await recordAudit({ action: "create", entity: "bank account", summary: inserted.map((r) => r.bankName).join(", ") });
      // Labelled the way every picker labels an account, so one created from
      // inside a cheque form drops into the dropdown reading identically to the
      // rest of the list.
      return { created: inserted.map((r) => ({ id: r.id, name: bankAccountLabel(r), companyId: r.companyId })) };
    },
    { [DUPLICATE]: "Can't create — one or more account numbers already exist for their company." },
  );
}

// --- Cash accounts ---

function readCashAccountForm(formData: FormData) {
  return {
    companyId: String(formData.get("companyId") ?? ""),
    name: String(formData.get("name") ?? "").trim(),
    openingBalance: String(formData.get("openingBalance") ?? "0"),
    currentBalance: String(formData.get("currentBalance") ?? "0"),
    isDefault: formData.get("isDefault") === "on",
    isActive: formData.get("isActive") === "on",
  };
}

export async function updateCashAccount(accountId: string, _prevState: ActionResult | undefined, formData: FormData): Promise<ActionResult> {
  return guard(
    "Couldn't save the cash account.",
    async () => {
      const session = await getLiveSession();

      const values = readCashAccountForm(formData);
      if (!values.name) return { error: "Name is required." };
      if (values.companyId) requirePermission(session, "accounts", "edit", { companyId: values.companyId });
      else requirePermission(session, "accounts", "edit");

      await db
        .update(cashAccounts)
        .set(values)
        .where(and(eq(cashAccounts.id, accountId), await companyInScope(cashAccounts.companyId)));

      await invalidateAccounts();
      revalidatePath("/accounts");
      await recordAudit({ action: "update", entity: "cash account", entityId: accountId, summary: values.name, companyId: values.companyId, detail: `Balance ${values.currentBalance}` });
      return { success: true };
    },
    { [DUPLICATE]: "Can't save — this name already exists for this company." },
  );
}

export async function deleteCashAccount(_prevState: ActionResult | undefined, formData: FormData): Promise<ActionResult> {
  return guard("Can't delete — this account is still referenced by documents.", async () => {
    const session = await getLiveSession();
    requirePermission(session, "accounts", "delete");

    const accountId = String(formData.get("accountId") ?? "");
    // Read scoped: a guessed id from an unauthorized company is "not found".
    const [existing] = await db
      .select({ companyId: cashAccounts.companyId })
      .from(cashAccounts)
      .where(and(eq(cashAccounts.id, accountId), await companyInScope(cashAccounts.companyId)))
      .limit(1);
    if (!existing) return { error: "Account not found." };
    requirePermission(session, "accounts", "delete", { companyId: existing.companyId ?? undefined });
    await db.delete(cashAccounts).where(eq(cashAccounts.id, accountId));

    await invalidateAccounts();
    revalidatePath("/accounts");
    await recordAudit({ action: "delete", entity: "cash account", entityId: accountId, summary: accountId });
    return { success: true };
  });
}

export interface CashAccountBatchRow {
  companyId: string;
  name: string;
  openingBalance: string;
  isDefault: boolean;
  isActive: boolean;
}

export async function createCashAccountsBatch(rows: CashAccountBatchRow[]): Promise<ActionResult> {
  return guard(
    "Couldn't save the cash accounts.",
    async () => {
      const session = await getLiveSession();
      requirePermission(session, "accounts", "create");

      const valid = rows.filter((r) => r.companyId && r.name.trim());
      if (valid.length === 0) return { error: "Add at least one cash account with a company and name." };
      // Every company the batch files under must be one the user belongs to and
      // can create accounts in.
      for (const companyId of new Set(valid.map((r) => r.companyId).filter((c): c is string => !!c))) {
        requirePermission(session, "accounts", "create", { companyId });
      }

      await db.insert(cashAccounts).values(valid.map((r) => ({ ...r, currentBalance: r.openingBalance })));

      await invalidateAccounts();
      revalidatePath("/accounts");
      await recordAudit({ action: "create", entity: "cash account", summary: valid.map((r) => r.name).join(", "), companyId: valid[0]?.companyId });
      return { success: true };
    },
    { [DUPLICATE]: "Can't create — one or more names already exist for their company." },
  );
}

// --- Cheques ---

function readChequeForm(formData: FormData) {
  return {
    companyId: String(formData.get("companyId") ?? ""),
    bankAccountId: String(formData.get("bankAccountId") ?? "") || null,
    contactId: String(formData.get("contactId") ?? "") || null,
    chequeNumber: String(formData.get("chequeNumber") ?? "").trim(),
    chequeDate: String(formData.get("chequeDate") ?? ""),
    amount: String(formData.get("amount") ?? "0"),
    chequeType: String(formData.get("chequeType") ?? "") as (typeof CHEQUE_TYPES)[number],
    status: String(formData.get("status") ?? "IN_HAND") as (typeof CHEQUE_STATUSES)[number],
    issuedByCompany: formData.get("issuedByCompany") === "on",
    remarks: String(formData.get("remarks") ?? "").trim() || null,
  };
}

export async function createCheque(_prevState: ActionResult | undefined, formData: FormData): Promise<ActionResult> {
  return guard(
    "Couldn't save the cheque.",
    async () => {
      const session = await getLiveSession();

      const values = readChequeForm(formData);
      if (!values.companyId) return { error: "Company is required." };
      // Scoped to the submitted company: membership + per-company permission.
      requirePermission(session, "cheques", "create", { companyId: values.companyId });
      if (!values.chequeNumber) return { error: "Cheque number is required." };
      if (!values.chequeDate) return { error: "Cheque date is required." };
      if (!values.chequeType) return { error: "Cheque type is required." };
      if (Number.isNaN(Number(values.amount)) || Number(values.amount) <= 0) return { error: "Amount must be greater than zero." };

      await db.insert(chequeRegister).values(values);

      await invalidateAccounts();
      revalidatePath("/accounts");
      await recordAudit({ action: "create", entity: "cheque", summary: values.chequeNumber, companyId: values.companyId, detail: `Amount ${values.amount}` });
      return { success: true };
    },
    { [DUPLICATE]: "Can't create — this cheque number already exists for this bank account." },
  );
}

export interface ChequeBatchRow {
  companyId: string;
  bankAccountId: string | null;
  contactId: string | null;
  // A name typed into the contact cell that matched nothing — created on save,
  // the same way a sale line creates the item somebody typed into it.
  contactName: string | null;
  chequeNumber: string;
  chequeDate: string;
  amount: string;
  chequeType: (typeof CHEQUE_TYPES)[number];
  status: (typeof CHEQUE_STATUSES)[number];
  issuedByCompany: boolean;
}

export async function createChequesBatch(rows: ChequeBatchRow[], operationId?: string): Promise<CreateResult<{ id: string; name: string; companyId: string }>> {
  return guard(
    "Couldn't save the cheques.",
    async () => {
      const session = await getLiveSession();
      requirePermission(session, "cheques", "create");

      // Minted by the cheque dialog when it opened; a replayed submit of a
      // committed batch is refused rather than registering every cheque twice.
      const opId = operationId || crypto.randomUUID();

      const valid = rows.filter((r) => r.companyId && r.chequeNumber.trim() && r.chequeDate && r.chequeType && Number(r.amount) > 0);
      if (valid.length === 0) {
        return { error: "Add at least one cheque with a company, number, date, type, and positive amount." };
      }
      // Every company the batch files under must be one the user belongs to and
      // can create cheques in.
      for (const companyId of new Set(valid.map((r) => r.companyId).filter((c): c is string => !!c))) {
        requirePermission(session, "cheques", "create", { companyId });
      }

      // One transaction, three statements: contacts typed into the grid are
      // looked up and created as a set, then every cheque goes in as one
      // multi-row INSERT. A cheque that fails on its number rolls back the
      // contacts its batch would have minted.
      const inserted = await db.transaction(async (tx) => {
        // First statement: claim the operation id, or abort as a duplicate.
        if (!(await claimOperation(tx, opId))) throw new DuplicateOperationError();
        const contactIds = await resolveContactIds(tx, valid);
        return tx
          .insert(chequeRegister)
          .values(
            valid.map((r, i) => ({
              companyId: r.companyId,
              bankAccountId: r.bankAccountId,
              contactId: contactIds[i],
              chequeNumber: r.chequeNumber,
              chequeDate: r.chequeDate,
              amount: r.amount,
              chequeType: r.chequeType,
              status: r.status,
              issuedByCompany: r.issuedByCompany,
              remarks: null,
            })),
          )
          .returning({ id: chequeRegister.id, chequeNumber: chequeRegister.chequeNumber, amount: chequeRegister.amount, companyId: chequeRegister.companyId });
      });

      await invalidateAccounts();
      await invalidateLookups(CACHE.contacts);
      revalidatePath("/accounts");
      await recordAudit({ action: "create", entity: "cheque", summary: valid.map((r) => r.chequeNumber).join(", "), companyId: valid[0]?.companyId });
      // Labelled the way getAvailableCheques labels them, so one created from
      // inside a payment or an expense drops into the picker reading identically
      // to the rest of the list.
      return { created: inserted.map((c) => ({ id: c.id, name: `${c.chequeNumber} (${c.amount})`, companyId: c.companyId })) };
    },
    { [DUPLICATE]: "Can't create — a cheque number is duplicated for its bank account." },
  );
}

export async function updateCheque(chequeId: string, _prevState: ActionResult | undefined, formData: FormData): Promise<ActionResult> {
  return guard(
    "Couldn't save the cheque.",
    async () => {
      const session = await getLiveSession();

      const values = readChequeForm(formData);
      if (!values.chequeNumber) return { error: "Cheque number is required." };
      if (values.companyId) requirePermission(session, "cheques", "edit", { companyId: values.companyId });
      else requirePermission(session, "cheques", "edit");
      if (!values.chequeDate) return { error: "Cheque date is required." };
      if (Number.isNaN(Number(values.amount)) || Number(values.amount) <= 0) return { error: "Amount must be greater than zero." };

      await db
        .update(chequeRegister)
        .set(values)
        .where(and(eq(chequeRegister.id, chequeId), await companyInScope(chequeRegister.companyId)));

      await invalidateAccounts();
      revalidatePath("/accounts");
      await recordAudit({ action: "update", entity: "cheque", entityId: chequeId, summary: values.chequeNumber, companyId: values.companyId, detail: `${values.status}, amount ${values.amount}` });
      return { success: true };
    },
    { [DUPLICATE]: "Can't save — this cheque number already exists for this bank account." },
  );
}

export async function deleteCheque(_prevState: ActionResult | undefined, formData: FormData): Promise<ActionResult> {
  return guard("Can't delete — this cheque is still referenced by a document.", async () => {
    const session = await getLiveSession();
    requirePermission(session, "cheques", "delete");

    const chequeId = String(formData.get("chequeId") ?? "");
    // Read scoped: a guessed id from an unauthorized company is "not found".
    const [existing] = await db
      .select({ companyId: chequeRegister.companyId })
      .from(chequeRegister)
      .where(and(eq(chequeRegister.id, chequeId), await companyInScope(chequeRegister.companyId)))
      .limit(1);
    if (!existing) return { error: "Cheque not found." };
    requirePermission(session, "cheques", "delete", { companyId: existing.companyId ?? undefined });
    await db.delete(chequeRegister).where(eq(chequeRegister.id, chequeId));

    await invalidateAccounts();
    revalidatePath("/accounts");
    await recordAudit({ action: "delete", entity: "cheque", entityId: chequeId, summary: chequeId });
    return { success: true };
  });
}
