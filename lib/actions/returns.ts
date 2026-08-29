"use server";

import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { documentLines, documentNumberLedger, documents, documentTypes, inventoryTransactions, items, ledgerEntries, units } from "@/lib/db/schema";
import { getLiveSession, getSession } from "@/lib/auth/session";
import { requirePermission } from "@/lib/auth/permissions";
import { companyInPermissionScope, companyInScope } from "@/lib/auth/scope";
import { ensureDocumentType, nextDocumentNumber } from "@/lib/actions/document-numbering";
import { claimOperation, readOperationId, DuplicateOperationError } from "@/lib/actions/operation-id";
import { guard, describeDbError, type ActionResult } from "@/lib/actions/guard";
import { recordAudit } from "@/lib/actions/audit";
import { CACHE, invalidateLookups, invalidateReads, READ_DOMAIN } from "@/lib/queries/lookups";
import { round1 } from "@/lib/format";
import { salesReturnHeaderTotals } from "@/lib/return-constants";

type RequestedLine = { sourceLineId: string; quantity: number };
function salesReturnType(companyId: string) {
  return ensureDocumentType({
    companyId,
    code: "SALES_RETURN",
    name: "Sales Return",
    series: "SR",
    affectsInventory: true,
    affectsAccounting: true,
    affectsReceivable: true,
    active: true,
  });
}

function readRequestedLines(formData: FormData): RequestedLine[] | null {
  try {
    const value = JSON.parse(String(formData.get("linesJson") ?? "[]"));
    if (!Array.isArray(value)) return null;
    const rows = value
      .map((line) => ({ sourceLineId: String(line?.sourceLineId ?? "").trim(), quantity: Number(line?.quantity) }))
      .filter((line) => line.sourceLineId && Number.isFinite(line.quantity) && line.quantity > 0);
    return new Set(rows.map((line) => line.sourceLineId)).size === rows.length ? rows : null;
  } catch {
    return null;
  }
}

const READS = [READ_DOMAIN.sales, READ_DOMAIN.ledger, READ_DOMAIN.products, READ_DOMAIN.stock, READ_DOMAIN.payments] as const;

export type ReturnableSaleLine = {
  sourceLineId: string;
  lineNo: number;
  itemId: string | null;
  itemName: string | null;
  unitId: string | null;
  unitSymbol: string | null;
  quantity: string;
  returnedQuantity: string;
  availableQuantity: string;
  unitPrice: string;
};

export async function getReturnableSale(documentId: string): Promise<{ id: string; number: string; companyId: string; documentDate: string; lines: ReturnableSaleLine[]; returns: { id: string; number: string; documentDate: string; grandTotal: string; status: "draft" | "pending" | "approved" | "posted" | "cancelled" }[] } | null> {
  const session = await getSession();
  requirePermission(session, "sales", "view");
  const [doc] = await db
    .select({ id: documents.id, number: documents.number, companyId: documents.companyId, documentDate: documents.documentDate })
    .from(documents)
    .innerJoin(documentTypes, eq(documentTypes.id, documents.documentTypeId))
    .where(and(eq(documents.id, documentId), eq(documents.status, "posted"), eq(documentTypes.code, "SALES_INVOICE"), await companyInPermissionScope(documents.companyId, session, "sales")))
    .limit(1);
  if (!doc) return null;

  // Return lines deliberately retain their original line number. That makes a
  // partial return unambiguous even if the same item appears twice on an invoice
  // at different prices, without another mutable quantity column on the sale.
  const [sourceLines, returned, returnDocs] = await Promise.all([
    db
      .select({ id: documentLines.id, lineNo: documentLines.lineNo, itemId: documentLines.itemId, itemName: items.name, unitId: documentLines.unitId, unitSymbol: units.symbol, quantity: documentLines.quantity, unitPrice: documentLines.unitPrice })
      .from(documentLines)
      .leftJoin(items, eq(items.id, documentLines.itemId))
      .leftJoin(units, eq(units.id, documentLines.unitId))
      .where(eq(documentLines.documentId, documentId))
      .orderBy(asc(documentLines.lineNo)),
    db.execute<{ line_no: number; quantity: string }>(sql`
      SELECT dl.line_no, coalesce(sum(dl.quantity), 0) AS quantity
      FROM document_lines dl
      JOIN documents r ON r.id = dl.document_id
      JOIN document_types rt ON rt.id = r.document_type_id
      WHERE r.source_document_id = ${documentId}::uuid
        AND r.status = 'posted'
        AND rt.code = 'SALES_RETURN'
      GROUP BY dl.line_no`),
    db
      .select({ id: documents.id, number: documents.number, documentDate: documents.documentDate, grandTotal: documents.grandTotal, status: documents.status })
      .from(documents)
      .innerJoin(documentTypes, eq(documentTypes.id, documents.documentTypeId))
      .where(and(eq(documents.sourceDocumentId, documentId), eq(documentTypes.code, "SALES_RETURN")))
      .orderBy(desc(documents.documentDate), desc(documents.createdAt)),
  ]);
  const returnedByLine = new Map(returned.map((line) => [line.line_no, Number(line.quantity)]));
  return {
    ...doc,
    lines: sourceLines.map((line) => {
      const returnedQuantity = returnedByLine.get(line.lineNo) ?? 0;
      return { sourceLineId: line.id, lineNo: line.lineNo, itemId: line.itemId, itemName: line.itemName, unitId: line.unitId, unitSymbol: line.unitSymbol, quantity: line.quantity, returnedQuantity: String(returnedQuantity), availableQuantity: String(Math.max(0, Number(line.quantity) - returnedQuantity)), unitPrice: line.unitPrice };
    }),
    returns: returnDocs,
  };
}

export async function createSalesReturn(_prevState: (ActionResult & { id?: string }) | undefined, formData: FormData): Promise<ActionResult & { id?: string }> {
  return guard("Couldn't create the sales return.", async () => {
    const session = await getLiveSession();
    const sourceDocumentId = String(formData.get("sourceDocumentId") ?? "").trim();
    const documentDate = String(formData.get("documentDate") ?? "").trim();
    const requested = readRequestedLines(formData);
    if (!sourceDocumentId) return { error: "Choose the original sale." };
    if (!documentDate) return { error: "Return date is required." };
    if (!requested || requested.length === 0) return { error: "Choose at least one item and quantity to return." };

    const [source] = await db
      .select({ companyId: documents.companyId })
      .from(documents)
      .innerJoin(documentTypes, eq(documentTypes.id, documents.documentTypeId))
      .where(and(eq(documents.id, sourceDocumentId), eq(documents.status, "posted"), eq(documentTypes.code, "SALES_INVOICE"), await companyInScope(documents.companyId)))
      .limit(1);
    if (!source) return { error: "Original sale not found." };
    requirePermission(session, "sales", "create", { companyId: source.companyId });
    const returnType = await salesReturnType(source.companyId);
    const operationId = readOperationId(formData);
    let createdId = "";
    let createdNumber = "";

    try {
      createdId = await db.transaction(async (tx) => {
        if (!(await claimOperation(tx, operationId))) throw new DuplicateOperationError();
        const [lockedSource] = await tx
          .select({
            id: documents.id,
            companyId: documents.companyId,
            contactId: documents.contactId,
            subtotal: documents.subtotal,
            discountTotal: documents.discountTotal,
            taxTotal: documents.taxTotal,
            taxId: documents.taxId,
            taxRate: documents.taxRate,
            taxInclusive: documents.taxInclusive,
            shippingTotal: documents.shippingTotal,
            grandTotal: documents.grandTotal,
          })
          .from(documents)
          .innerJoin(documentTypes, eq(documentTypes.id, documents.documentTypeId))
          .where(and(eq(documents.id, sourceDocumentId), eq(documents.companyId, source.companyId), eq(documents.status, "posted"), eq(documentTypes.code, "SALES_INVOICE")))
          .limit(1)
          .for("update");
        if (!lockedSource) throw new Error("The original sale is no longer available.");
        if (!lockedSource.contactId) throw new Error("The original sale has no customer to credit.");

        const sourceLines = await tx
          .select({ id: documentLines.id, lineNo: documentLines.lineNo, itemId: documentLines.itemId, locationId: documentLines.locationId, unitId: documentLines.unitId, quantity: documentLines.quantity, baseQuantity: documentLines.baseQuantity, unitPrice: documentLines.unitPrice, unitCost: documentLines.unitCost, lineTotal: documentLines.lineTotal, taxable: documentLines.taxable, taxAmount: documentLines.taxAmount })
          .from(documentLines)
          .where(and(eq(documentLines.documentId, sourceDocumentId), inArray(documentLines.id, requested.map((line) => line.sourceLineId))))
          .orderBy(asc(documentLines.lineNo));
        if (sourceLines.length !== requested.length) throw new Error("One of the selected sale lines no longer exists.");
        const requestedById = new Map(requested.map((line) => [line.sourceLineId, line.quantity]));
        const priorReturns = await tx.execute<{ line_no: number; quantity: string }>(sql`
          SELECT dl.line_no, coalesce(sum(dl.quantity), 0) AS quantity
          FROM document_lines dl
          JOIN documents r ON r.id = dl.document_id
          JOIN document_types rt ON rt.id = r.document_type_id
          WHERE r.source_document_id = ${sourceDocumentId}::uuid
            AND r.status = 'posted'
            AND rt.code = 'SALES_RETURN'
          GROUP BY dl.line_no`);
        const priorByLine = new Map(priorReturns.map((line) => [line.line_no, Number(line.quantity)]));
        const selected = sourceLines.map((line) => {
          const quantity = requestedById.get(line.id) ?? 0;
          const available = Number(line.quantity) - (priorByLine.get(line.lineNo) ?? 0);
          if (quantity > available + 1e-9) throw new Error(`Line ${line.lineNo}: only ${available} can still be returned.`);
          const fraction = quantity / Number(line.quantity);
          return { ...line, quantity, baseQuantity: Number(line.baseQuantity) * fraction, lineTotal: Number(line.lineTotal) * fraction, taxAmount: Number(line.taxAmount) * fraction };
        });

        const costRows = await tx
          .select({ documentLineId: inventoryTransactions.documentLineId, totalCost: inventoryTransactions.totalCost })
          .from(inventoryTransactions)
          .where(inArray(inventoryTransactions.documentLineId, selected.map((line) => line.id)));
        const costByLine = new Map(costRows.map((row) => [row.documentLineId, Number(row.totalCost ?? 0)]));
        const selectedSubtotal = selected.reduce((total, line) => total + line.lineTotal, 0);
        const selectedTax = selected.reduce((total, line) => total + line.taxAmount, 0);
        const sourceSubtotal = Number(lockedSource.subtotal);
        const sourceLineCount = await tx.select({ id: documentLines.id, quantity: documentLines.quantity, lineNo: documentLines.lineNo }).from(documentLines).where(eq(documentLines.documentId, sourceDocumentId));
        const returnedAfter = new Map(priorByLine);
        for (const line of selected) returnedAfter.set(line.lineNo, (returnedAfter.get(line.lineNo) ?? 0) + line.quantity);
        const totals = salesReturnHeaderTotals({
          sourceSubtotal, sourceDiscount: Number(lockedSource.discountTotal), sourceTax: Number(lockedSource.taxTotal), sourceShipping: Number(lockedSource.shippingTotal), sourceGrandTotal: Number(lockedSource.grandTotal),
          selectedSubtotal, selectedTax, hasPriorReturns: priorReturns.length > 0,
          returnsEverySourceLineNow: sourceLineCount.every((line) => Math.abs((returnedAfter.get(line.lineNo) ?? 0) - Number(line.quantity)) < 1e-9),
          round: round1,
        });
        const { discount, shipping, tax, grandTotal } = totals;
        const number = await nextDocumentNumber(returnType.series, tx);
        createdNumber = number;
        const [returnDoc] = await tx
          .insert(documents)
          .values({ companyId: lockedSource.companyId, documentTypeId: returnType.id, number, status: "posted", documentDate, contactId: lockedSource.contactId, sourceDocumentId, subtotal: String(selectedSubtotal), discountTotal: String(discount), taxTotal: String(tax), taxId: lockedSource.taxId, taxRate: lockedSource.taxRate, taxInclusive: lockedSource.taxInclusive, shippingTotal: String(shipping), grandTotal: String(grandTotal), createdBy: session.userId })
          .returning({ id: documents.id });
        const inserted = await tx
          .insert(documentLines)
          .values(selected.map((line) => ({ companyId: lockedSource.companyId, documentId: returnDoc.id, lineNo: line.lineNo, sortOrder: line.lineNo, itemId: line.itemId, locationId: line.locationId, unitId: line.unitId, quantity: String(line.quantity), baseQuantity: String(line.baseQuantity), unitPrice: line.unitPrice, unitCost: line.unitCost, lineTotal: String(line.lineTotal), taxable: line.taxable, taxAmount: String(line.taxAmount), stockMovement: 1 })))
          .returning({ id: documentLines.id });
        const stockRows = selected.map((line, index) => ({ line, lineId: inserted[index].id })).filter(({ line }) => line.itemId);
        if (stockRows.length) await tx.insert(inventoryTransactions).values(stockRows.map(({ line, lineId }) => {
          const sourceCost = costByLine.get(line.id) ?? 0;
          const restoredCost = Number(line.quantity) > 0 ? sourceCost * line.quantity / Number(sourceLines.find((sourceLine) => sourceLine.id === line.id)!.quantity) : 0;
          return { companyId: lockedSource.companyId, documentLineId: lineId, movement: 1, quantity: String(line.quantity), baseQuantity: String(line.baseQuantity), unitCost: String(line.baseQuantity > 0 ? restoredCost / line.baseQuantity : 0), totalCost: String(restoredCost) };
        }));
        await tx.insert(documentNumberLedger).values({ companyId: lockedSource.companyId, documentTypeId: returnType.id, number, documentId: returnDoc.id });
        // A return is a customer credit. It reduces their receivable immediately;
        // if the original invoice was already paid, the credit remains visible in
        // the party ledger until it is refunded through an ordinary payment-out.
        if (grandTotal > 0) await tx.insert(ledgerEntries).values({ companyId: lockedSource.companyId, documentId: returnDoc.id, credit: String(grandTotal) });
        return returnDoc.id;
      });
    } catch (error) {
      if (error instanceof DuplicateOperationError) return { error: error.message };
      return { error: describeDbError(error, "Can't create this sales return.") };
    }
    await invalidateLookups(CACHE.documentTypes, CACHE.items, CACHE.cheques);
    await invalidateReads(...READS);
    revalidatePath("/sales/invoices"); revalidatePath("/inventory/stock"); revalidatePath("/inventory/products"); revalidatePath("/ledger");
    await recordAudit({ action: "create", entity: "sales return", entityId: createdId, summary: createdNumber, companyId: source.companyId, detail: `Return against the original sale ${sourceDocumentId}` });
    return { success: true, id: createdId };
  });
}

export async function cancelSalesReturn(_prevState: ActionResult | undefined, formData: FormData): Promise<ActionResult> {
  return guard("Couldn't cancel the sales return.", async () => {
    const session = await getLiveSession();
    const documentId = String(formData.get("documentId") ?? "").trim();
    const [existing] = await db
      .select({ number: documents.number, companyId: documents.companyId, contactId: documents.contactId })
      .from(documents).innerJoin(documentTypes, eq(documentTypes.id, documents.documentTypeId))
      .where(and(eq(documents.id, documentId), eq(documents.status, "posted"), eq(documentTypes.code, "SALES_RETURN"), await companyInScope(documents.companyId))).limit(1);
    if (!existing) return { error: "Sales return not found." };
    requirePermission(session, "sales", "delete", { companyId: existing.companyId });
    let vanished = false;
    await db.transaction(async (tx) => {
      const [locked] = await tx.select({ id: documents.id }).from(documents).where(and(eq(documents.id, documentId), eq(documents.status, "posted"))).limit(1).for("update");
      if (!locked) { vanished = true; return; }
      await tx.execute(sql`INSERT INTO inventory_transactions (company_id, document_line_id, movement, quantity, base_quantity, unit_cost, total_cost)
        SELECT it.company_id, it.document_line_id, -it.movement, it.quantity, it.base_quantity, it.unit_cost, it.total_cost
        FROM inventory_transactions it JOIN document_lines dl ON dl.id = it.document_line_id WHERE dl.document_id = ${documentId}::uuid`);
      await tx.execute(sql`INSERT INTO ledger_entries (company_id, document_id, debit, credit)
        SELECT company_id, document_id, credit, debit FROM ledger_entries WHERE document_id = ${documentId}::uuid`);
      await tx.update(documents).set({ status: "cancelled", cancelledBy: session.userId, cancelledAt: new Date(), updatedAt: new Date() }).where(and(eq(documents.id, documentId), eq(documents.status, "posted")));
    });
    if (vanished) return { error: "Sales return not found — it may already have been cancelled." };
    await invalidateLookups(CACHE.documentTypes, CACHE.items, CACHE.cheques);
    await invalidateReads(...READS);
    revalidatePath("/sales/invoices"); revalidatePath("/inventory/stock"); revalidatePath("/inventory/products"); revalidatePath("/ledger");
    await recordAudit({ action: "cancel", entity: "sales return", entityId: documentId, summary: existing.number, companyId: existing.companyId });
    return { success: true };
  });
}
