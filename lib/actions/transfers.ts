"use server";

import { and, desc, eq, inArray, like, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { bankAccounts, cashAccounts, chequeRegister, companies, documentNumberLedger, documentTypes, documents } from "@/lib/db/schema";
import { getLiveSession, getSession } from "@/lib/auth/session";
import { requirePermission } from "@/lib/auth/permissions";
import { companyInPermissionScope, companyInScope } from "@/lib/auth/scope";
import { CACHE, invalidateLookups } from "@/lib/queries/lookups";
import { ensureDocumentType, nextDocumentNumberRange } from "@/lib/actions/document-numbering";
import { adjustSettlementBalancesBatch } from "@/lib/actions/settlement";
import { BANK_ACCOUNT_LABEL_SQL } from "@/lib/account-label";
import { guard, DUPLICATE, type ActionResult } from "@/lib/actions/guard";
import { recordAudit } from "@/lib/actions/audit";
import { claimOperation, readOperationId, DuplicateOperationError } from "@/lib/actions/operation-id";
import { linkCheque } from "@/lib/actions/cheque-link";
import { UNSPENT_CHEQUE_STATUS } from "@/lib/cheque-constants";

// Moving money between the company's own accounts — cash drawer to bank, bank to
// cash, one drawer to another. No contact, nothing owed either way, so it writes
// no ledger entry: it's the same money in a different place.
//
// A document holds one settlement account (documents.bank_account_id /
// cash_account_id, exactly one set), and a transfer has two. So it's two
// JOURNAL_ENTRY documents — the side the money left and the side it arrived —
// tied together through documents.reason, the same way an inter-company sale
// pairs its invoice with its purchase.
//
// ponytail: reason as the join key, matching lib/actions/inter-company.ts. A real
// linked_document_id column would serve both, if a third thing ever needs it.
const TRANSFER_REASON = "Cash Transfer";
const outReason = (key: string) => `${TRANSFER_REASON} out ${key}`;
const inReason = (key: string) => `${TRANSFER_REASON} in ${key}`;

// The form posts an account as "cash:<id>" or "bank:<id>" — one dropdown listing
// both kinds beats two dropdowns and a radio for picking one account.
// "cheque:<id>" is a third kind, and only ever on the side the money leaves:
// handing over a cheque is how the money goes, and the cheque is spent doing it.
// It carries no account of its own — where the money actually comes from is the
// account the cheque is drawn on, which settlement.ts resolves.
function parseAccount(value: string): { bankAccountId: string | null; cashAccountId: string | null; chequeId: string | null } | null {
  const [kind, id] = value.split(":");
  if (!id) return null;
  if (kind === "cash") return { bankAccountId: null, cashAccountId: id, chequeId: null };
  if (kind === "bank") return { bankAccountId: id, cashAccountId: null, chequeId: null };
  if (kind === "cheque") return { bankAccountId: null, cashAccountId: null, chequeId: id };
  return null;
}

export interface CashTransferRow {
  id: string;
  number: string;
  documentDate: string;
  company: string;
  from: string;
  to: string;
  amount: string;
}

export async function listCashTransfers(): Promise<CashTransferRow[]> {
  const session = await getSession();
  requirePermission(session, "accounts", "view");

  const rows = await db
    .select({
      id: documents.id,
      number: documents.number,
      reason: documents.reason,
      documentDate: documents.documentDate,
      amount: documents.grandTotal,
      company: companies.name,
      // Bank, branch and account title, as everywhere else an account is named.
      bankAccount: sql<string>`${sql.raw(BANK_ACCOUNT_LABEL_SQL())}`,
      cashAccount: cashAccounts.name,
    })
    .from(documents)
    .innerJoin(documentTypes, eq(documentTypes.id, documents.documentTypeId))
    .innerJoin(companies, eq(companies.id, documents.companyId))
    .leftJoin(bankAccounts, eq(bankAccounts.id, documents.bankAccountId))
    .leftJoin(cashAccounts, eq(cashAccounts.id, documents.cashAccountId))
    .where(and(like(documents.reason, `${TRANSFER_REASON} %`), eq(documents.status, "posted"), await companyInPermissionScope(documents.companyId, session, "accounts")))
    .orderBy(desc(documents.documentDate), desc(documents.createdAt));

  // "Cash Transfer <side> <key>" — the key pairs the two halves, the side says
  // which is which.
  const pairs = new Map<string, { out?: (typeof rows)[number]; in?: (typeof rows)[number] }>();
  for (const r of rows) {
    const [, , side, key] = r.reason!.split(" ");
    if (!key) continue;
    const pair = pairs.get(key) ?? {};
    if (side === "out") pair.out = r;
    else pair.in = r;
    pairs.set(key, pair);
  }

  const label = (r: (typeof rows)[number] | undefined) => r?.bankAccount ?? r?.cashAccount ?? "—";

  return [...pairs.values()]
    .filter((p) => p.out)
    .map((p) => ({
      // The list is addressed by the outgoing half — that's the row a delete
      // starts from, and it finds its partner through the shared key.
      id: p.out!.id,
      number: p.out!.number,
      documentDate: p.out!.documentDate,
      company: p.out!.company,
      from: label(p.out),
      to: label(p.in),
      amount: p.out!.amount,
    }));
}

export async function createCashTransfer(_prevState: ActionResult | undefined, formData: FormData): Promise<ActionResult> {
  return guard(
    "Couldn't record the transfer.",
    async () => {
      const session = await getLiveSession();

      const companyId = String(formData.get("companyId") ?? "");
      const documentDate = String(formData.get("documentDate") ?? "");
      const fromValue = String(formData.get("fromAccount") ?? "");
      const toValue = String(formData.get("toAccount") ?? "");
      const amount = Number(String(formData.get("amount") ?? "").trim());
      // Minted by the transfer dialog when it opened; a replayed submit of a
      // committed transfer is refused rather than moving the money twice.
      const operationId = readOperationId(formData);

      if (!companyId) return { error: "Company is required." };
      if (!documentDate) return { error: "Date is required." };
      // Moves money between accounts, so it needs the permission that edits
      // them — scoped to the submitted company (membership + per-company
      // permission).
      requirePermission(session, "accounts", "edit", { companyId });
      if (!fromValue || !toValue) return { error: "Pick the account the money leaves and the one it lands in." };
      if (fromValue === toValue) return { error: "Pick two different accounts." };
      if (!Number.isFinite(amount) || amount <= 0) return { error: "Enter an amount greater than zero." };

      const from = parseAccount(fromValue);
      const to = parseAccount(toValue);
      if (!from || !to) return { error: "Account not recognised." };
      // A cheque is a way of paying out, not a place money lands in.
      if (to.chequeId) return { error: "Money can't be transferred into a cheque — pick the account it lands in." };

      const documentType = await ensureDocumentType({
        companyId,
        code: "JOURNAL_ENTRY",
        name: "Journal Entry",
        series: "JE",
        affectsAccounting: true,
        active: true,
      });

      const key = crypto.randomUUID();
      const total = amount.toFixed(2);

      await db.transaction(async (tx) => {
        // First statement: claim the operation id, or abort as a duplicate.
        if (!(await claimOperation(tx, operationId))) throw new DuplicateOperationError();
        const numbers = await nextDocumentNumberRange(documentType.series, 2, tx);
        const sides = [
          { reason: outReason(key), account: from, direction: "out" as const },
          { reason: inReason(key), account: to, direction: "in" as const },
        ].map((side, index) => ({ ...side, number: numbers[index]!, documentId: crypto.randomUUID() }));

        await tx.insert(documents).values(
          sides.map((side) => ({
            id: side.documentId,
            companyId,
            documentTypeId: documentType.id,
            number: side.number,
            status: "posted" as const,
            documentDate,
            subtotal: total,
            grandTotal: total,
            reason: side.reason,
            bankAccountId: side.account.bankAccountId,
            cashAccountId: side.account.cashAccountId,
            createdBy: session.userId,
          })),
        );
        await tx.insert(documentNumberLedger).values(
          sides.map((side) => ({ companyId, documentTypeId: documentType.id, number: side.number, documentId: side.documentId })),
        );
        await adjustSettlementBalancesBatch(
          tx,
          sides.map((side) => ({
            direction: side.direction,
            amount: total,
            bankAccountId: side.account.bankAccountId,
            cashAccountId: side.account.cashAccountId,
            chequeId: side.account.chequeId,
            sign: 1,
            companyId,
          })),
        );

        // Only the outgoing side can be a cheque. The guarded link consumes it
        // after both documents and balance movements have been prepared.
        const chequeSide = sides.find((side) => side.account.chequeId);
        if (chequeSide?.account.chequeId) {
          await linkCheque(tx, chequeSide.account.chequeId, chequeSide.documentId, chequeSide.direction, companyId);
        }
      });

      invalidateLookups(CACHE.documentTypes, CACHE.bankAccounts, CACHE.cashAccounts, CACHE.cheques);
      revalidatePath("/accounts");
      revalidatePath("/dashboard");
      await recordAudit({ action: "create", entity: "cash transfer", summary: `${fromValue} to ${toValue}`, companyId, detail: `Amount ${total}` });
      return { success: true };
    },
    { [DUPLICATE]: "Can't transfer — a journal entry number is already in use for this company." },
  );
}

export async function deleteCashTransfer(_prevState: ActionResult | undefined, formData: FormData): Promise<ActionResult> {
  return guard("Couldn't cancel this transfer.", async () => {
    const session = await getLiveSession();
    requirePermission(session, "accounts", "delete");

    const documentId = String(formData.get("documentId") ?? "");
    // Read scoped: a guessed id from an unauthorized company is "not found".
    const [outDoc] = await db
      .select()
      .from(documents)
      .where(and(eq(documents.id, documentId), eq(documents.status, "posted"), await companyInScope(documents.companyId)))
      .limit(1);
    if (!outDoc?.reason?.startsWith(`${TRANSFER_REASON} `)) return { error: "Transfer not found." };
    requirePermission(session, "accounts", "delete", { companyId: outDoc.companyId });

    const key = outDoc.reason.split(" ")[3];
    const [inDoc] = await db
      .select()
      .from(documents)
      .where(and(eq(documents.reason, inReason(key)), eq(documents.status, "posted"), await companyInScope(documents.companyId)))
      .limit(1);
    if (!inDoc) return { error: "The other half of this transfer is missing — delete each document on its own." };

    let changed = false;
    await db.transaction(async (tx) => {
      const ids = [outDoc.id, inDoc.id];
      const locked = await tx.select({ id: documents.id }).from(documents).where(and(inArray(documents.id, ids), eq(documents.status, "posted"))).for("update");
      if (locked.length !== 2) return;
      const [linkedCheque] = await tx.select({ id: chequeRegister.id }).from(chequeRegister).where(inArray(chequeRegister.documentId, ids)).limit(1).for("update");
      // Put both sides back in one set-based settlement statement.
      await adjustSettlementBalancesBatch(tx, [
        { direction: "out", amount: outDoc.grandTotal, bankAccountId: outDoc.bankAccountId, cashAccountId: outDoc.cashAccountId, chequeId: linkedCheque?.id ?? null, sign: -1, companyId: outDoc.companyId },
        { direction: "in", amount: inDoc.grandTotal, bankAccountId: inDoc.bankAccountId, cashAccountId: inDoc.cashAccountId, chequeId: null, sign: -1, companyId: inDoc.companyId },
      ]);
      if (linkedCheque) await tx.update(chequeRegister).set({ documentId: null, status: UNSPENT_CHEQUE_STATUS }).where(eq(chequeRegister.id, linkedCheque.id));
      await tx.update(documents).set({ status: "cancelled", cancelledBy: session.userId, cancelledAt: new Date(), updatedAt: new Date() }).where(inArray(documents.id, ids));
      changed = true;
    });
    if (!changed) return { error: "Transfer not found — it may already be cancelled." };

    invalidateLookups(CACHE.documentTypes, CACHE.bankAccounts, CACHE.cashAccounts, CACHE.cheques);
    revalidatePath("/accounts");
    revalidatePath("/dashboard");
    await recordAudit({ action: "cancel", entity: "cash transfer", entityId: outDoc.id, summary: outDoc.number, companyId: outDoc.companyId });
    return { success: true };
  });
}
