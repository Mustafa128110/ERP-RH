"use server";

import { and, desc, eq, gte, ilike, inArray, lte, or, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import {
  documents,
  documentTypes,
  documentNumberLedger,
  companies,
  contacts,
  ledgerEntries,
  bankAccounts,
  cashAccounts,
  chequeRegister,
} from "@/lib/db/schema";
import { getLiveSession, getSession } from "@/lib/auth/session";
import { requirePermission, PermissionError } from "@/lib/auth/permissions";
import { companyInScope } from "@/lib/auth/scope";
import { ensureDocumentType, nextDocumentNumber } from "@/lib/actions/document-numbering";
import { adjustSettlementBalance, type SettlementType } from "@/lib/actions/settlement";
import { resolveContactId } from "@/lib/actions/resolve-refs";
import { CACHE, getAvailableCheques, invalidateLookups } from "@/lib/queries/lookups";
import { guard, describeDbError, type ActionResult } from "@/lib/actions/guard";
import { BANK_ACCOUNT_LABEL_SQL } from "@/lib/account-label";
import { paymentLedgerSide } from "@/lib/payment-constants";
import { UNSPENT_CHEQUE_STATUS } from "@/lib/cheque-constants";
import { recordAudit } from "@/lib/actions/audit";
import { claimOperation, readOperationId, DuplicateOperationError } from "@/lib/actions/operation-id";

export type PaymentDirection = "made" | "received";
export type PaymentType = SettlementType;

const DIRECTION_CODE = {
  made: "PAYMENT_MADE",
  received: "PAYMENT_RECEIVED",
} as const;
const DIRECTION_SERIES = { made: "PM", received: "RC" } as const;
const DIRECTION_NAME = { made: "Payment Made", received: "Payment Received" } as const;
const SETTLE_DIRECTION = { made: "out", received: "in" } as const;

// Settling with a cheque is the one settlement that consumes a shared,
// exhaustible resource. The guarded link lives in lib/actions/cheque-link.ts
// so sales, purchases and cash transfers settle through the same refusal — a
// cheque already attached to another document aborts the whole payment (the
// WHERE re-checks against the committed row, so exactly one of two racers
// wins), and the operation id makes the retry safe — nothing was written.
import { ChequeUnavailableError, linkCheque } from "@/lib/actions/cheque-link";

// A cheque settles for its own registered amount — the form doesn't show an
// Amount field when Cheque is picked, so the value comes from the cheque
// itself rather than the submission.
async function resolveSettlementAmount(amount: string, chequeId: string | null) {
  if (chequeId) {
    const [cheque] = await db.select({ amount: chequeRegister.amount }).from(chequeRegister).where(eq(chequeRegister.id, chequeId)).limit(1);
    if (!cheque) return { error: "Selected cheque not found." } as const;
    return { amount: cheque.amount } as const;
  }
  if (Number.isNaN(Number(amount)) || Number(amount) <= 0) return { error: "Amount must be greater than zero." } as const;
  return { amount } as const;
}

export interface PaymentFilters {
  contact?: string;
  // "made" | "received" — anything else is treated as no direction filter.
  direction?: string;
  company?: string;
  from?: string;
  to?: string;
}

// Filtered in SQL rather than over the returned array: the list is unbounded and
// grows with every payment ever recorded, so a JS filter would drag all of it
// back before throwing most away.
export async function listPayments(filters: PaymentFilters = {}) {
  const session = await getSession();
  requirePermission(session, "payments", "view");

  const codes =
    filters.direction === "made" ? (["PAYMENT_MADE"] as const) : filters.direction === "received" ? (["PAYMENT_RECEIVED"] as const) : (["PAYMENT_MADE", "PAYMENT_RECEIVED"] as const);

  const rows = await db
    .select({
      id: documents.id,
      number: documents.number,
      documentDate: documents.documentDate,
      grandTotal: documents.grandTotal,
      companyId: documents.companyId,
      company: companies.name,
      contactId: documents.contactId,
      contact: contacts.displayName,
      // Bank, branch and account title — the same label the picker shows, so a
      // payment in the list and the account it names read as the same thing.
      bankAccountName: sql<string>`${sql.raw(BANK_ACCOUNT_LABEL_SQL())}`,
      cashAccountName: cashAccounts.name,
      chequeNumber: chequeRegister.chequeNumber,
      code: documentTypes.code,
    })
    .from(documents)
    .innerJoin(documentTypes, eq(documentTypes.id, documents.documentTypeId))
    .innerJoin(companies, eq(companies.id, documents.companyId))
    .leftJoin(contacts, eq(contacts.id, documents.contactId))
    .leftJoin(bankAccounts, eq(bankAccounts.id, documents.bankAccountId))
    .leftJoin(cashAccounts, eq(cashAccounts.id, documents.cashAccountId))
    .leftJoin(chequeRegister, eq(chequeRegister.documentId, documents.id))
    .where(
      and(
        // Payments proper, plus purchases that were settled on the spot. Paying
        // a supplier at the counter is money out whether it was entered here or
        // ticked "paid" on the delivery, and a payments page that omits half of
        // it can't be reconciled against the drawer. A purchase raises no
        // payment document of its own — it carries the settlement account on
        // itself — so it's picked up here rather than duplicated as one.
        or(
          inArray(documentTypes.code, [...codes]),
          filters.direction === "received" ? undefined : and(eq(documentTypes.code, "PURCHASE_INVOICE"), eq(documents.isPaid, true)),
        ),
        await companyInScope(documents.companyId),
        // Narrows within the scope, never widens it — companyInScope still gates
        // every row.
        filters.company ? eq(documents.companyId, filters.company) : undefined,
        filters.contact ? ilike(contacts.displayName, `%${filters.contact}%`) : undefined,
        filters.from ? gte(documents.documentDate, filters.from) : undefined,
        filters.to ? lte(documents.documentDate, filters.to) : undefined,
      ),
    )
    // createdAt breaks the tie because a day's payments all carry the same
    // document_date — without it the order within today is whatever the planner
    // returns, so one just entered could land mid-list.
    .orderBy(desc(documents.documentDate), desc(documents.createdAt));

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
}

// Cheques available to settle a payment: unlinked, plus (when editing) the
// one already linked to this payment so it doesn't vanish from the dropdown.
// Kept as an action because PaymentManager re-fetches it from the browser.
export async function listChequesForPayments(currentPaymentId?: string) {
  return getAvailableCheques(currentPaymentId);
}

// Payment document types are fixed (Made/Received) and never user-configured,
// so find-or-create happens here rather than exposing type management like
// stock purchases do.
function getOrCreatePaymentDocumentType(companyId: string, direction: PaymentDirection) {
  return ensureDocumentType({
    companyId,
    code: DIRECTION_CODE[direction],
    name: DIRECTION_NAME[direction],
    series: DIRECTION_SERIES[direction],
    affectsAccounting: true,
    affectsPayable: direction === "made",
    affectsReceivable: direction === "received",
    active: true,
  });
}

function readPaymentForm(formData: FormData) {
  const paymentType = String(formData.get("paymentType") ?? "") as PaymentType;
  return {
    companyId: String(formData.get("companyId") ?? ""),
    // Picked contact, or free-typed text that becomes a contact on save — same
    // as a customer on a sale line.
    contactId: String(formData.get("contactId") ?? "") || null,
    contactName: String(formData.get("contactName") ?? "").trim() || null,
    amount: String(formData.get("amount") ?? "0"),
    paymentDate: String(formData.get("paymentDate") ?? ""),
    paymentType,
    bankAccountId: paymentType === "account" ? String(formData.get("bankAccountId") ?? "") || null : null,
    cashAccountId: paymentType === "cash" ? String(formData.get("cashAccountId") ?? "") || null : null,
    chequeId: paymentType === "cheque" ? String(formData.get("chequeId") ?? "") || null : null,
  };
}

export async function createPayment(
  direction: PaymentDirection,
  _prevState: ActionResult | undefined,
  formData: FormData,
) {
  const session = await getLiveSession();

  const values = readPaymentForm(formData);
  if (!values.companyId) return { error: "Company is required." };
  // Scoped to the submitted company: membership and per-company permission, so
  // a queued submission filled against a stale cache is refused rather than
  // written into a company the user can no longer create in. This action is
  // not guard-wrapped, so the PermissionError is caught here — a throw would
  // reach the outbox's submit() as a "transient" network error and retry a
  // permanent denial forever instead of marking it FAILED.
  try {
    requirePermission(session, "payments", "create", { companyId: values.companyId });
  } catch (e) {
    if (e instanceof PermissionError) return { error: e.message };
    throw e;
  }
  if (!values.paymentDate) return { error: "Date is required." };
  if (!values.bankAccountId && !values.cashAccountId && !values.chequeId) return { error: "Select an account, cash account, or cheque." };

  const resolvedAmount = await resolveSettlementAmount(values.amount, values.chequeId);
  if ("error" in resolvedAmount) return { error: resolvedAmount.error };
  values.amount = resolvedAmount.amount;

  const documentType = await getOrCreatePaymentDocumentType(values.companyId, direction);
  const operationId = readOperationId(formData);

  let createdNumber = "";
  let createdId = "";
  try {
    await db.transaction(async (tx) => {
      // First statement: claim the operation id, or abort as a duplicate.
      if (!(await claimOperation(tx, operationId))) throw new DuplicateOperationError();
      // Allocated inside the transaction so a failure gives the number back.
      const number = await nextDocumentNumber(documentType.series, tx);
      createdNumber = number;
      const contactId = await resolveContactId(tx, values.companyId, values.contactId, values.contactName);
      const [doc] = await tx
        .insert(documents)
        .values({
          companyId: values.companyId,
          documentTypeId: documentType.id,
          number,
          status: "posted",
          documentDate: values.paymentDate,
          contactId,
          subtotal: values.amount,
          grandTotal: values.amount,
          bankAccountId: values.bankAccountId,
          cashAccountId: values.cashAccountId,
          createdBy: session.userId,
        })
        .returning();
      createdId = doc.id;

      await tx.insert(documentNumberLedger).values({
        companyId: values.companyId,
        documentTypeId: documentType.id,
        number,
        documentId: doc.id,
      });

      if (values.chequeId) {
        await linkCheque(tx, values.chequeId, doc.id, SETTLE_DIRECTION[direction]);
      }
      await adjustSettlementBalance(tx, SETTLE_DIRECTION[direction], values.amount, values.bankAccountId, values.cashAccountId, values.chequeId, 1);

      // A payment settles part of a balance, so it books the opposite side of
      // whatever raised it: made offsets a purchase's credit with a debit,
      // received offsets a sale's debit (`sales.ts`, the "Owes Us" column) with
      // a credit. Without the credit side, taking money off a customer left
      // what they owed us exactly where it was.
      if (contactId) {
        await tx.insert(ledgerEntries).values({ companyId: values.companyId, documentId: doc.id, ...paymentLedgerSide(direction, values.amount) });
      }
    });
  } catch (e) {
    if (e instanceof DuplicateOperationError) return { error: e.message };
    if (e instanceof ChequeUnavailableError) return { error: e.message };
    return { error: describeDbError(e, "Can't create — document number already in use for this company/type.") };
  }

  invalidateLookups(CACHE.documentTypes, CACHE.cheques, CACHE.contacts);
  revalidatePath("/payments");
  revalidatePath("/ledger");
  await recordAudit({
    action: "create",
    entity: `payment ${direction}`,
    entityId: createdId,
    summary: createdNumber,
    companyId: values.companyId,
    detail: `Amount ${values.amount}`,
  });
  return { success: true };
}

export async function getPayment(documentId: string) {
  const session = await getSession();
  requirePermission(session, "payments", "view");

  // Both keyed on documentId, so neither waits on the other. This runs every
  // time a payment row is opened for editing.
  const [[doc], [linkedCheque]] = await Promise.all([
    db
      .select({
        id: documents.id,
        companyId: documents.companyId,
        contactId: documents.contactId,
        amount: documents.grandTotal,
        paymentDate: documents.documentDate,
        bankAccountId: documents.bankAccountId,
        cashAccountId: documents.cashAccountId,
        code: documentTypes.code,
      })
      .from(documents)
      .innerJoin(documentTypes, eq(documentTypes.id, documents.documentTypeId))
      .where(eq(documents.id, documentId))
      .limit(1),
    db.select({ id: chequeRegister.id }).from(chequeRegister).where(eq(chequeRegister.documentId, documentId)).limit(1),
  ]);
  if (!doc) return null;

  const paymentType: PaymentType | null = doc.bankAccountId ? "account" : doc.cashAccountId ? "cash" : linkedCheque ? "cheque" : null;

  return {
    ...doc,
    chequeId: linkedCheque?.id ?? null,
    paymentType,
    direction: (doc.code === "PAYMENT_MADE" ? "made" : "received") as PaymentDirection,
  };
}

export interface PaymentBatchRow {
  direction: PaymentDirection;
  companyId: string;
  contactId: string | null;
  contactName: string | null;
  settlementType: SettlementType;
  bankAccountId: string | null;
  cashAccountId: string | null;
  chequeId: string | null;
  amount: string;
  paymentDate: string;
}

// Every payment is a posted document with a settlement effect (and, for a
// payment made against a contact, a ledger entry) — so a batch can't be a plain
// bulk insert. Each row runs the same steps createPayment does, and the whole
// batch shares one transaction: any bad row rolls all of them back rather than
// leaving numbers issued and balances moved for a half-done batch.
export async function createPaymentsBatch(rows: PaymentBatchRow[], operationId?: string): Promise<ActionResult> {
  const session = await getLiveSession();
  requirePermission(session, "payments", "create");
  // Minted by the batch dialog when it opened; a replayed submit of a committed
  // batch is refused rather than posting every row twice.
  const opId = operationId || crypto.randomUUID();

  // A row counts once someone has typed an amount into it — a cheque row is the
  // exception, it settles for the cheque's own registered amount. Spare rows at
  // the bottom are skipped, not rejected: company, date and cash account are all
  // prefilled now, so every untouched row looked finished and one filled-in
  // payment couldn't be saved past them.
  const valid = rows.filter(
    (r) => r.companyId && r.paymentDate && (r.chequeId || ((r.bankAccountId || r.cashAccountId) && r.amount.trim() !== "")),
  );
  if (valid.length === 0) {
    return { error: "Add at least one row with a company, date, a settlement account, and an amount above zero." };
  }
  // Anything typed is checked rather than quietly dropped — a row entered as
  // -500 used to fail the filter above and vanish without a word.
  if (valid.some((r) => !r.chequeId && !(Number(r.amount) > 0))) {
    return { error: "Amount must be greater than zero." };
  }
  // Rows were filled against cached option lists; a company access or
  // permission may have been revoked since. The cache prepares work, it never
  // grants it — every distinct company in the batch needs the create
  // permission THERE (membership is part of the scoped check), so a batch
  // spanning a company the user can no longer act in is refused wholesale.
  // Caught like createPayment: this action isn't guard-wrapped, and a throw
  // would be misread by the outbox as a transient network error.
  try {
    for (const companyId of new Set(valid.map((r) => r.companyId))) {
      requirePermission(session, "payments", "create", { companyId });
    }
  } catch (e) {
    if (e instanceof PermissionError) return { error: e.message };
    throw e;
  }

  // Document types are per company+direction; resolve each once up front (cached)
  // so the loop doesn't re-hit it per row.
  const typeCache = new Map<string, Awaited<ReturnType<typeof getOrCreatePaymentDocumentType>>>();
  const typeFor = async (companyId: string, direction: PaymentDirection) => {
    const key = `${companyId}:${direction}`;
    let t = typeCache.get(key);
    if (!t) {
      t = await getOrCreatePaymentDocumentType(companyId, direction);
      typeCache.set(key, t);
    }
    return t;
  };

  try {
    await db.transaction(async (tx) => {
      // First statement: claim the operation id, or abort as a duplicate.
      if (!(await claimOperation(tx, opId))) throw new DuplicateOperationError();
      for (const r of valid) {
        // A cheque settles for its own amount; account/cash use the typed value.
        const resolved = await resolveSettlementAmount(r.amount, r.chequeId);
        if ("error" in resolved) throw new Error(resolved.error);
        const amount = resolved.amount;

        const documentType = await typeFor(r.companyId, r.direction);
        const number = await nextDocumentNumber(documentType.series, tx);
        const contactId = await resolveContactId(tx, r.companyId, r.contactId, r.contactName);

        const [doc] = await tx
          .insert(documents)
          .values({
            companyId: r.companyId,
            documentTypeId: documentType.id,
            number,
            status: "posted",
            documentDate: r.paymentDate,
            contactId,
            subtotal: amount,
            grandTotal: amount,
            bankAccountId: r.bankAccountId,
            cashAccountId: r.cashAccountId,
            createdBy: session.userId,
          })
          .returning();

        await tx.insert(documentNumberLedger).values({ companyId: r.companyId, documentTypeId: documentType.id, number, documentId: doc.id });

        if (r.chequeId) {
          await linkCheque(tx, r.chequeId, doc.id, SETTLE_DIRECTION[r.direction]);
        }
        await adjustSettlementBalance(tx, SETTLE_DIRECTION[r.direction], amount, r.bankAccountId, r.cashAccountId, r.chequeId, 1);

        if (contactId) {
          await tx.insert(ledgerEntries).values({ companyId: r.companyId, documentId: doc.id, ...paymentLedgerSide(r.direction, amount) });
        }
      }
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    return { error: msg || "Can't create — check the rows and try again." };
  }

  invalidateLookups(CACHE.documentTypes, CACHE.cheques, CACHE.contacts);
  revalidatePath("/payments");
  revalidatePath("/ledger");
  await recordAudit({
    action: "create",
    entity: "payment",
    summary: `${valid.length} payment(s) entered in batch`,
    companyId: valid[0]?.companyId,
    detail: `Total ${valid.reduce((sum, r) => sum + Number(r.amount || 0), 0)}`,
  });
  return { success: true };
}

export async function updatePayment(paymentId: string, _prevState: ActionResult | undefined, formData: FormData): Promise<ActionResult> {
  return guard("Couldn't save the payment.", async () => {
    const session = await getLiveSession();

    const values = readPaymentForm(formData);
    if (!values.paymentDate) return { error: "Date is required." };
    if (!values.bankAccountId && !values.cashAccountId && !values.chequeId) return { error: "Select an account, cash account, or cheque." };

    const resolvedAmount = await resolveSettlementAmount(values.amount, values.chequeId);
    if ("error" in resolvedAmount) return { error: resolvedAmount.error };
    values.amount = resolvedAmount.amount;

    const [existing] = await db
      .select({
        number: documents.number,
        documentTypeId: documents.documentTypeId,
        code: documentTypes.code,
        companyId: documents.companyId,
        amount: documents.grandTotal,
        bankAccountId: documents.bankAccountId,
        cashAccountId: documents.cashAccountId,
      })
      .from(documents)
      .innerJoin(documentTypes, eq(documentTypes.id, documents.documentTypeId))
      .where(and(eq(documents.id, paymentId), await companyInScope(documents.companyId)))
      .limit(1);
    if (!existing) return { error: "Payment not found." };
    // The edit permission is checked against the row's own company — a guessed
    // id from a company the user can't edit in is refused even when they hold
    // the permission somewhere else.
    requirePermission(session, "payments", "edit", { companyId: existing.companyId });

    const direction: PaymentDirection = existing.code === "PAYMENT_MADE" ? "made" : "received";
    const [existingCheque] = await db.select({ id: chequeRegister.id }).from(chequeRegister).where(eq(chequeRegister.documentId, paymentId)).limit(1);

    try {
      await db.transaction(async (tx) => {
        // Reverse the old settlement before applying the new one — same
        // drop-and-reapply approach as the ledger resync below.
        await adjustSettlementBalance(tx, SETTLE_DIRECTION[direction], existing.amount, existing.bankAccountId, existing.cashAccountId, existingCheque?.id ?? null, -1);
        if (existingCheque) {
          await tx.update(chequeRegister).set({ documentId: null, status: UNSPENT_CHEQUE_STATUS }).where(eq(chequeRegister.id, existingCheque.id));
        }

        const contactId = await resolveContactId(tx, existing.companyId, values.contactId, values.contactName);
        await tx
          .update(documents)
          .set({
            contactId,
            subtotal: values.amount,
            grandTotal: values.amount,
            documentDate: values.paymentDate,
            bankAccountId: values.bankAccountId,
            cashAccountId: values.cashAccountId,
          })
          .where(eq(documents.id, paymentId));

        if (values.chequeId) {
          await linkCheque(tx, values.chequeId, paymentId, SETTLE_DIRECTION[direction]);
        }
        await adjustSettlementBalance(tx, SETTLE_DIRECTION[direction], values.amount, values.bankAccountId, values.cashAccountId, values.chequeId, 1);

        // Re-sync the entry exactly like create — drop and re-add so editing the
        // amount/contact never leaves a stale ledger row behind.
        await tx.delete(ledgerEntries).where(eq(ledgerEntries.documentId, paymentId));
        if (contactId) {
          await tx.insert(ledgerEntries).values({ companyId: existing.companyId, documentId: paymentId, ...paymentLedgerSide(direction, values.amount) });
        }
      });
    } catch (e) {
      if (e instanceof ChequeUnavailableError) return { error: e.message };
      throw e;
    }

    invalidateLookups(CACHE.documentTypes, CACHE.cheques, CACHE.contacts);
    revalidatePath("/payments");
    revalidatePath("/ledger");
    await recordAudit({
      action: "update",
      entity: `payment ${direction}`,
      entityId: paymentId,
      summary: existing.number,
      companyId: existing.companyId,
      detail: `Amount ${values.amount}`,
    });
    return { success: true };
  });
}

export async function deletePayment(_prevState: ActionResult | undefined, formData: FormData) {
  const session = await getLiveSession();
  requirePermission(session, "payments", "delete");

  const paymentId = String(formData.get("paymentId") ?? "");

  const [existing] = await db
    .select({
      number: documents.number,
      companyId: documents.companyId,
      code: documentTypes.code,
      amount: documents.grandTotal,
      bankAccountId: documents.bankAccountId,
      cashAccountId: documents.cashAccountId,
    })
    .from(documents)
    .innerJoin(documentTypes, eq(documentTypes.id, documents.documentTypeId))
    .where(and(eq(documents.id, paymentId), await companyInScope(documents.companyId)))
    .limit(1);
  if (!existing) return { error: "Payment not found." };
  // The delete permission is checked against the row's own company — a guessed
  // id from a company the user can't delete in is refused even when they hold
  // the permission somewhere else. Caught like createPayment: this action
  // isn't guard-wrapped, and a throw would be misread by the form's transport
  // wrapper as a network failure.
  try {
    requirePermission(session, "payments", "delete", { companyId: existing.companyId });
  } catch (e) {
    if (e instanceof PermissionError) return { error: e.message };
    throw e;
  }

  const [existingCheque] = await db.select({ id: chequeRegister.id }).from(chequeRegister).where(eq(chequeRegister.documentId, paymentId)).limit(1);
  const direction: PaymentDirection = existing.code === "PAYMENT_MADE" ? "made" : "received";

  try {
    await db.transaction(async (tx) => {
      await adjustSettlementBalance(tx, SETTLE_DIRECTION[direction], existing.amount, existing.bankAccountId, existing.cashAccountId, existingCheque?.id ?? null, -1);
      if (existingCheque) {
        await tx.update(chequeRegister).set({ documentId: null, status: UNSPENT_CHEQUE_STATUS }).where(eq(chequeRegister.id, existingCheque.id));
      }
      await tx.delete(ledgerEntries).where(eq(ledgerEntries.documentId, paymentId));
      await tx.delete(documents).where(eq(documents.id, paymentId));
    });
  } catch (e) {
    return { error: describeDbError(e, "Can't delete this payment.") };
  }

  invalidateLookups(CACHE.documentTypes, CACHE.cheques);
  revalidatePath("/payments");
  revalidatePath("/ledger");
  await recordAudit({
    action: "delete",
    entity: `payment ${direction}`,
    entityId: paymentId,
    summary: existing.number,
    companyId: existing.companyId,
    detail: `Amount ${existing.amount}`,
  });
  return { success: true };
}
