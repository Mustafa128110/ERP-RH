"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { bankAccounts, cashAccounts, chequeRegister } from "@/lib/db/schema";
import { getLiveSession, getSession } from "@/lib/auth/session";
import { requirePermission } from "@/lib/auth/permissions";
import { companyInPermissionScope, companyInScope, getScopeCompanyIds } from "@/lib/auth/scope";
import { CACHE, invalidateLookups } from "@/lib/queries/lookups";
import { CHEQUE_TYPES, CHEQUE_STATUSES } from "@/lib/cheque-constants";
import { guard, DUPLICATE, type ActionResult, type CreateResult } from "@/lib/actions/guard";
import { bankAccountLabel } from "@/lib/account-label";
import { recordAudit } from "@/lib/actions/audit";
import { resolveContactIds } from "@/lib/actions/resolve-refs";
import { claimOperation, DuplicateOperationError } from "@/lib/actions/operation-id";
import { cachedPageRead } from "@/lib/read-cache";

// Every account and cheque write goes through guard(): the hand-written messages
// below are what a duplicate key should say, and guard adds the cases nobody can
// write by hand — a dropped connection, a lock timeout, two people saving the
// same row — each of which promises nothing was written, because nothing was.

// Accounts and cheques all read from the same three cached lookups, and any
// write to any of them can change what the others offer.
const invalidateAccounts = () => invalidateLookups(CACHE.bankAccounts, CACHE.cashAccounts, CACHE.cheques);

export async function listBankAccounts() {
  const session = await getSession();
  requirePermission(session, "accounts", "view");
  const scope = (await getScopeCompanyIds()).sort().join(",");
  return cachedPageRead(`${session.userId}:accounts:bank:${scope}`, async () =>
    db.select().from(bankAccounts).where(await companyInPermissionScope(bankAccounts.companyId, session, "accounts")),
  );
}

export async function listCashAccounts() {
  const session = await getSession();
  requirePermission(session, "accounts", "view");
  const scope = (await getScopeCompanyIds()).sort().join(",");
  return cachedPageRead(`${session.userId}:accounts:cash:${scope}`, async () =>
    db.select().from(cashAccounts).where(await companyInPermissionScope(cashAccounts.companyId, session, "accounts")),
  );
}

export async function listCheques() {
  const session = await getSession();
  requirePermission(session, "cheques", "view");
  const scope = (await getScopeCompanyIds()).sort().join(",");
  return cachedPageRead(`${session.userId}:accounts:cheques:${scope}`, async () =>
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

      invalidateAccounts();
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

    invalidateAccounts();
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

      invalidateAccounts();
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

      invalidateAccounts();
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

    invalidateAccounts();
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

      invalidateAccounts();
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

      invalidateAccounts();
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

export async function createChequesBatch(rows: ChequeBatchRow[], operationId?: string): Promise<CreateResult<{ id: string; name: string }>> {
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
          .returning({ id: chequeRegister.id, chequeNumber: chequeRegister.chequeNumber, amount: chequeRegister.amount });
      });

      invalidateAccounts();
      invalidateLookups(CACHE.contacts);
      revalidatePath("/accounts");
      await recordAudit({ action: "create", entity: "cheque", summary: valid.map((r) => r.chequeNumber).join(", "), companyId: valid[0]?.companyId });
      // Labelled the way getAvailableCheques labels them, so one created from
      // inside a payment or an expense drops into the picker reading identically
      // to the rest of the list.
      return { created: inserted.map((c) => ({ id: c.id, name: `${c.chequeNumber} (${c.amount})` })) };
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

      invalidateAccounts();
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

    invalidateAccounts();
    revalidatePath("/accounts");
    await recordAudit({ action: "delete", entity: "cheque", entityId: chequeId, summary: chequeId });
    return { success: true };
  });
}
