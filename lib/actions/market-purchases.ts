"use server";

import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import {
  chequeRegister,
  companies,
  contacts,
  documentLines,
  documentNumberLedger,
  documents,
  documentTypes,
  expenses,
  inventoryTransactions,
  items,
  marketPurchaseRequests,
  units,
} from "@/lib/db/schema";
import { getLiveSession, getSession } from "@/lib/auth/session";
import { requirePermission } from "@/lib/auth/permissions";
import { companyInPermissionScope, companyInScope } from "@/lib/auth/scope";
import { ensureDocumentType, nextDocumentNumber } from "@/lib/actions/document-numbering";
import { adjustSettlementBalance, SettlementScopeError, type SettlementType } from "@/lib/actions/settlement";
import { resolveExpenseCategoryId } from "@/lib/actions/resolve-refs";
import { claimOperation, readOperationId, DuplicateOperationError } from "@/lib/actions/operation-id";
import { recordAudit } from "@/lib/actions/audit";
import { CACHE, invalidateLookups, invalidateReads, READ_DOMAIN } from "@/lib/queries/lookups";
import { guard, describeDbError, type ActionResult } from "@/lib/actions/guard";
import { linkCheque } from "@/lib/actions/cheque-link";
import { UNSPENT_CHEQUE_STATUS } from "@/lib/cheque-constants";
import { round1 } from "@/lib/format";

const REVALIDATION_PATHS = ["/purchases/market", "/inventory/stock", "/inventory/products", "/expenses", "/dashboard"];
// The same five screens, as cached reads. A market purchase is a MARKET_PURCHASE
// document, which no cached list shows — it reaches stock and products through the
// movements it books, and expenses/payments/accounts through the expense row and
// the cheque or account that paid for it.
const READS = [
  READ_DOMAIN.stock,
  READ_DOMAIN.products,
  READ_DOMAIN.expenses,
  READ_DOMAIN.payments,
  READ_DOMAIN.accounts,
] as const;
const confirmationDocuments = alias(documents, "confirmation_documents");

export async function listMarketPurchaseRequests() {
  const session = await getSession();
  requirePermission(session, "purchases", "view");
  return db
    .select({
      id: marketPurchaseRequests.id,
      companyId: marketPurchaseRequests.companyId,
      company: sql<string>`coalesce(${companies.shortName}, ${companies.name})`,
      saleDocumentId: marketPurchaseRequests.saleDocumentId,
      saleNumber: documents.number,
      saleDate: documents.documentDate,
      customer: contacts.displayName,
      item: items.name,
      unit: units.name,
      quantity: marketPurchaseRequests.quantity,
      purchaseCost: marketPurchaseRequests.purchaseCost,
      status: marketPurchaseRequests.status,
      confirmationDocumentId: marketPurchaseRequests.confirmationDocumentId,
      confirmationNumber: confirmationDocuments.number,
    })
    .from(marketPurchaseRequests)
    .innerJoin(documents, eq(documents.id, marketPurchaseRequests.saleDocumentId))
    .innerJoin(companies, eq(companies.id, marketPurchaseRequests.companyId))
    .innerJoin(items, eq(items.id, marketPurchaseRequests.itemId))
    .leftJoin(units, eq(units.id, marketPurchaseRequests.unitId))
    .leftJoin(contacts, eq(contacts.id, documents.contactId))
    .leftJoin(confirmationDocuments, eq(confirmationDocuments.id, marketPurchaseRequests.confirmationDocumentId))
    .where(await companyInPermissionScope(marketPurchaseRequests.companyId, session, "purchases"))
    // Enum order is pending, confirmed, cancelled, so this is the same pending-
    // first presentation as the former boolean expression and can use the
    // company/status/created_at index directly.
    .orderBy(marketPurchaseRequests.status, desc(marketPurchaseRequests.createdAt));
}

function marketPurchaseDocumentType(companyId: string) {
  return ensureDocumentType({
    companyId,
    code: "MARKET_PURCHASE",
    name: "Market Purchase",
    series: "MP",
    affectsInventory: true,
    affectsAccounting: true,
    active: true,
  });
}

type ConfirmationInput = { id: string; unitCost: string };

function readConfirmation(formData: FormData) {
  let selected: ConfirmationInput[] = [];
  try {
    selected = JSON.parse(String(formData.get("requestsJson") ?? "[]"));
  } catch {
    selected = [];
  }
  const settlementType = String(formData.get("settlementType") ?? "") as SettlementType;
  return {
    selected: selected.filter((row) => row.id && Number(row.unitCost) > 0),
    documentDate: String(formData.get("documentDate") ?? ""),
    settlementType,
    bankAccountId: settlementType === "account" ? String(formData.get("bankAccountId") ?? "") || null : null,
    cashAccountId: settlementType === "cash" ? String(formData.get("cashAccountId") ?? "") || null : null,
    chequeId: settlementType === "cheque" ? String(formData.get("chequeId") ?? "") || null : null,
  };
}

export async function confirmMarketPurchases(
  _prevState: (ActionResult & { id?: string }) | undefined,
  formData: FormData,
): Promise<ActionResult & { id?: string }> {
  return guard("Couldn't confirm the market purchase.", async () => {
    const session = await getLiveSession();
    const input = readConfirmation(formData);
    if (input.selected.length === 0) return { error: "Select at least one pending item and enter its actual market unit cost." };
    if (!input.documentDate) return { error: "Purchase date is required." };
    if (!input.bankAccountId && !input.cashAccountId && !input.chequeId) return { error: "Select the account that paid for this market purchase." };

    const ids = [...new Set(input.selected.map((row) => row.id))];
    if (ids.length !== input.selected.length) return { error: "The same request was selected more than once." };
    const preflight = await db
      .select({ id: marketPurchaseRequests.id, companyId: marketPurchaseRequests.companyId })
      .from(marketPurchaseRequests)
      .where(and(inArray(marketPurchaseRequests.id, ids), eq(marketPurchaseRequests.status, "pending"), await companyInScope(marketPurchaseRequests.companyId)));
    if (preflight.length !== ids.length) return { error: "One of these requests is no longer pending or accessible." };
    const companyIds = [...new Set(preflight.map((row) => row.companyId))];
    if (companyIds.length !== 1) return { error: "Confirm one company at a time so the purchase and payment stay in the correct books." };
    const companyId = companyIds[0];
    requirePermission(session, "purchases", "create", { companyId });
    requirePermission(session, "expenses", "create", { companyId });

    const documentType = await marketPurchaseDocumentType(companyId);
    const operationId = readOperationId(formData);
    const costById = new Map(input.selected.map((row) => [row.id, Number(row.unitCost)]));
    let number = "";
    let createdId = "";

    try {
      await db.transaction(async (tx) => {
        if (!(await claimOperation(tx, operationId))) throw new DuplicateOperationError();
        const locked = await tx
          .select({
            id: marketPurchaseRequests.id,
            itemId: marketPurchaseRequests.itemId,
            unitId: marketPurchaseRequests.unitId,
            quantity: marketPurchaseRequests.quantity,
            baseQuantity: marketPurchaseRequests.baseQuantity,
            locationId: documentLines.locationId,
          })
          .from(marketPurchaseRequests)
          .innerJoin(documentLines, eq(documentLines.id, marketPurchaseRequests.saleLineId))
          .where(and(inArray(marketPurchaseRequests.id, ids), eq(marketPurchaseRequests.companyId, companyId), eq(marketPurchaseRequests.status, "pending")))
          .for("update", { of: marketPurchaseRequests });
        if (locked.length !== ids.length) throw new Error("One of these market requests was already confirmed.");

        number = await nextDocumentNumber(documentType.series, tx);
        const total = round1(locked.reduce((sum, row) => sum + Number(row.quantity) * (costById.get(row.id) ?? 0), 0));
        const [doc] = await tx
          .insert(documents)
          .values({
            companyId,
            documentTypeId: documentType.id,
            number,
            status: "posted",
            documentDate: input.documentDate,
            subtotal: String(total),
            grandTotal: String(total),
            paidAmount: String(total),
            isPaid: true,
            bankAccountId: input.bankAccountId,
            cashAccountId: input.cashAccountId,
            createdBy: session.userId,
          })
          .returning({ id: documents.id });
        createdId = doc.id;

        const lineRows = locked.map((row, index) => {
          const unitCost = costById.get(row.id) ?? 0;
          return {
            companyId,
            documentId: doc.id,
            lineNo: index + 1,
            sortOrder: index,
            itemId: row.itemId,
            locationId: row.locationId,
            unitId: row.unitId,
            quantity: row.quantity,
            baseQuantity: row.baseQuantity,
            unitPrice: String(unitCost),
            unitCost: String(unitCost),
            lineTotal: String(round1(unitCost * Number(row.quantity))),
            stockMovement: 1 as const,
          };
        });
        const insertedLines = await tx.insert(documentLines).values(lineRows).returning({ id: documentLines.id });
        await tx.insert(inventoryTransactions).values(
          lineRows.map((line, index) => ({
            companyId,
            documentLineId: insertedLines[index].id,
            movement: 1,
            quantity: line.quantity,
            baseQuantity: line.baseQuantity,
            unitCost: String(Number(line.unitCost) * Number(line.quantity) / Number(line.baseQuantity)),
            totalCost: line.lineTotal,
          })),
        );

        const categoryId = (await resolveExpenseCategoryId(tx, companyId, null, "Item Purchase"))!;
        const [expense] = await tx
          .insert(expenses)
          .values({
            companyId,
            expenseCategoryId: categoryId,
            bankAccountId: input.bankAccountId,
            cashAccountId: input.cashAccountId,
            chequeId: input.chequeId,
            amount: String(total),
            expenseDate: input.documentDate,
            documentId: doc.id,
            notes: `Market purchase ${number} for ${locked.length} sales line(s)`,
            createdBy: session.userId,
          })
          .returning({ id: expenses.id });
        if (input.chequeId) await linkCheque(tx, input.chequeId, doc.id, "out", companyId);
        await adjustSettlementBalance(tx, "out", String(total), input.bankAccountId, input.cashAccountId, input.chequeId, 1, companyId);

        const values = sql.join(input.selected.map((row) => sql`(${row.id}::uuid, ${row.unitCost}::numeric)`), sql`, `);
        await tx.execute(sql`
          UPDATE market_purchase_requests r
          SET status = 'confirmed', confirmation_document_id = ${doc.id}::uuid,
              expense_id = ${expense.id}::uuid, purchase_cost = v.unit_cost,
              confirmed_by = ${session.userId}::uuid, confirmed_at = now()
          FROM (VALUES ${values}) AS v(id, unit_cost)
          WHERE r.id = v.id AND r.status = 'pending'
        `);
        await tx.insert(documentNumberLedger).values({ companyId, documentTypeId: documentType.id, number, documentId: doc.id });
      });
    } catch (error) {
      if (error instanceof DuplicateOperationError) return { error: error.message };
      if (error instanceof SettlementScopeError) return { error: error.message };
      return { error: describeDbError(error, "Couldn't post this market purchase.") };
    }

    invalidateLookups(CACHE.documentTypes, CACHE.items, CACHE.expenseCategories, CACHE.cheques);
    invalidateReads(...READS);
    for (const path of REVALIDATION_PATHS) revalidatePath(path);
    await recordAudit({ action: "create", entity: "market purchase", entityId: createdId, summary: number, companyId, detail: `${input.selected.length} item(s)` });
    return { success: true, id: createdId };
  });
}

export async function cancelMarketPurchase(_prevState: ActionResult | undefined, formData: FormData): Promise<ActionResult> {
  return guard("Couldn't cancel the market purchase.", async () => {
    const session = await getLiveSession();
    const documentId = String(formData.get("documentId") ?? "");
    const [existing] = await db
      .select({ id: documents.id, number: documents.number, companyId: documents.companyId })
      .from(documents)
      .innerJoin(documentTypes, eq(documentTypes.id, documents.documentTypeId))
      .where(and(eq(documents.id, documentId), eq(documents.status, "posted"), eq(documentTypes.code, "MARKET_PURCHASE"), await companyInScope(documents.companyId)))
      .limit(1);
    if (!existing) return { error: "Market purchase not found." };
    requirePermission(session, "purchases", "delete", { companyId: existing.companyId });
    requirePermission(session, "expenses", "delete", { companyId: existing.companyId });

    await db.transaction(async (tx) => {
      const [expense] = await tx
        .select({ id: expenses.id, amount: expenses.amount, bankAccountId: expenses.bankAccountId, cashAccountId: expenses.cashAccountId, chequeId: expenses.chequeId })
        .from(expenses)
        .where(and(eq(expenses.documentId, documentId), eq(expenses.status, "posted")))
        .limit(1)
        .for("update");
      if (!expense) throw new Error("The linked Item Purchase expense is missing or already cancelled.");
      await adjustSettlementBalance(tx, "out", expense.amount, expense.bankAccountId, expense.cashAccountId, expense.chequeId, -1, existing.companyId);
      if (expense.chequeId) await tx.update(chequeRegister).set({ documentId: null, status: UNSPENT_CHEQUE_STATUS }).where(and(eq(chequeRegister.id, expense.chequeId), eq(chequeRegister.documentId, documentId)));
      await tx.update(expenses).set({ status: "cancelled", cancelledBy: session.userId, cancelledAt: new Date() }).where(eq(expenses.id, expense.id));
      await tx.execute(sql`
        INSERT INTO inventory_transactions
          (company_id, document_line_id, movement, quantity, base_quantity, unit_cost, total_cost)
        SELECT it.company_id, it.document_line_id, -it.movement, it.quantity, it.base_quantity, it.unit_cost, it.total_cost
        FROM inventory_transactions it
        JOIN document_lines dl ON dl.id = it.document_line_id
        WHERE dl.document_id = ${documentId}::uuid
      `);
      await tx
        .update(marketPurchaseRequests)
        .set({ status: "pending", confirmationDocumentId: null, expenseId: null, purchaseCost: null, confirmedBy: null, confirmedAt: null })
        .where(eq(marketPurchaseRequests.confirmationDocumentId, documentId));
      await tx.update(documents).set({ status: "cancelled", cancelledBy: session.userId, cancelledAt: new Date(), updatedAt: new Date() }).where(eq(documents.id, documentId));
    });

    invalidateLookups(CACHE.items, CACHE.expenseCategories, CACHE.cheques);
    invalidateReads(...READS);
    for (const path of REVALIDATION_PATHS) revalidatePath(path);
    await recordAudit({ action: "cancel", entity: "market purchase", entityId: documentId, summary: existing.number, companyId: existing.companyId });
    return { success: true };
  });
}
