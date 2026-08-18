"use server";

import { and, desc, eq, getTableColumns, inArray, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import {
  companies,
  documents,
  documentTypes,
  documentLines,
  documentNumberLedger,
  items,
  units,
  locations,
  inventoryTransactions,
} from "@/lib/db/schema";
import { getLiveSession, getSession } from "@/lib/auth/session";
import { requirePermission } from "@/lib/auth/permissions";
import { companyInPermissionScope, companyInScope } from "@/lib/auth/scope";
import { CACHE, invalidateLookups } from "@/lib/queries/lookups";
import { ensureDocumentType, nextDocumentNumber } from "@/lib/actions/document-numbering";
import { resolveItemIds, resolveUnitIds } from "@/lib/actions/resolve-refs";
import { averageCosts } from "@/lib/queries/stock-cost";
import { ADJUSTMENT_REASONS, type AdjustmentReason } from "@/lib/adjustment-constants";
import { UNASSIGNED_LABEL, locationIdOrNull } from "@/lib/location-constants";
import { guard, describeDbError, type ActionResult } from "@/lib/actions/guard";
import { recordAudit } from "@/lib/actions/audit";
import { claimOperation, readOperationId, DuplicateOperationError } from "@/lib/actions/operation-id";
import { resolveBaseQuantities } from "@/lib/queries/unit-conversion";
import { companySettingValue } from "@/lib/queries/settings";

// An adjustment is the one document that writes stock without a counterparty: no
// customer, no supplier, no second location. One line per item at the adjusted
// location, and the sign of the entered quantity picks the movement — a shrink is
// movement -1, a found-more is +1. inventory_transactions.quantity is CHECKed >= 0,
// so the sign lives in `movement` and the quantity is stored absolute.

export interface AdjustmentItemRow {
  itemName: string;
  sku: string;
  // Signed: what the user entered, movement folded back in.
  quantity: string;
  unitSymbol: string | null;
}

export async function listStockAdjustments(companyId?: string) {
  const session = await getSession();
  requirePermission(session, "stock_adjustments", "view");
  const scope = and(await companyInPermissionScope(documents.companyId, session, "stock_adjustments"), companyId ? eq(documents.companyId, companyId) : undefined);

  const [docs, lineRows] = await Promise.all([
    db
      .select({
        id: documents.id,
        number: documents.number,
        documentDate: documents.documentDate,
        status: documents.status,
        reason: documents.reason,
        company: companies.name,
      })
      .from(documents)
      .innerJoin(documentTypes, eq(documentTypes.id, documents.documentTypeId))
      .innerJoin(companies, eq(companies.id, documents.companyId))
      .where(and(eq(documentTypes.code, "STOCK_ADJUSTMENT"), scope))
      .orderBy(desc(documents.documentDate)),
    db
      .select({
        documentId: documentLines.documentId,
        itemName: items.name,
        sku: items.sku,
        quantity: documentLines.quantity,
        unitSymbol: units.symbol,
        // A line with no location is where the stock actually is — nowhere in
        // particular — so it reads as Unassigned rather than as a missing value.
        locationName: sql<string>`coalesce(${locations.name}, ${UNASSIGNED_LABEL})`,
        movement: documentLines.stockMovement,
      })
      .from(documentLines)
      .innerJoin(documents, eq(documents.id, documentLines.documentId))
      .innerJoin(documentTypes, eq(documentTypes.id, documents.documentTypeId))
      .leftJoin(items, eq(items.id, documentLines.itemId))
      .leftJoin(units, eq(units.id, documentLines.unitId))
      .leftJoin(locations, eq(locations.id, documentLines.locationId))
      .where(and(eq(documentTypes.code, "STOCK_ADJUSTMENT"), scope))
      .orderBy(documentLines.lineNo),
  ]);

  const byDoc = new Map<string, { location: string | null; items: AdjustmentItemRow[]; net: number }>();
  for (const l of lineRows) {
    const entry = byDoc.get(l.documentId) ?? { location: null, items: [], net: 0 };
    entry.location ??= l.locationName;
    const signed = Number(l.quantity) * Number(l.movement ?? 0);
    entry.items.push({ itemName: l.itemName ?? "—", sku: l.sku ?? "", quantity: String(signed), unitSymbol: l.unitSymbol });
    entry.net += signed;
    byDoc.set(l.documentId, entry);
  }

  return docs.map((d) => ({
    ...d,
    location: byDoc.get(d.id)?.location ?? "—",
    items: byDoc.get(d.id)?.items ?? [],
    net: byDoc.get(d.id)?.net ?? 0,
  }));
}

export async function getStockAdjustment(documentId: string) {
  const session = await getSession();
  requirePermission(session, "stock_adjustments", "view");

  const [[doc], lineRows] = await Promise.all([
    db
      .select(getTableColumns(documents))
      .from(documents)
      .innerJoin(documentTypes, eq(documentTypes.id, documents.documentTypeId))
      .where(and(eq(documents.id, documentId), eq(documentTypes.code, "STOCK_ADJUSTMENT"), await companyInPermissionScope(documents.companyId, session, "stock_adjustments")))
      .limit(1),
    db
      .select({
        itemName: items.name,
        sku: items.sku,
        quantity: documentLines.quantity,
        unitSymbol: units.symbol,
        // A line with no location is where the stock actually is — nowhere in
        // particular — so it reads as Unassigned rather than as a missing value.
        locationName: sql<string>`coalesce(${locations.name}, ${UNASSIGNED_LABEL})`,
        movement: documentLines.stockMovement,
      })
      .from(documentLines)
      .leftJoin(items, eq(items.id, documentLines.itemId))
      .leftJoin(units, eq(units.id, documentLines.unitId))
      .leftJoin(locations, eq(locations.id, documentLines.locationId))
      .where(eq(documentLines.documentId, documentId))
      .orderBy(documentLines.lineNo),
  ]);
  if (!doc) return null;

  return {
    id: doc.id,
    number: doc.number,
    documentDate: doc.documentDate,
    status: doc.status,
    reason: doc.reason,
    location: lineRows[0]?.locationName ?? "—",
    lines: lineRows.map((l) => ({
      itemName: l.itemName ?? "—",
      sku: l.sku ?? "",
      quantity: String(Number(l.quantity) * Number(l.movement ?? 0)),
      unitSymbol: l.unitSymbol,
    })),
  };
}

interface AdjustmentLineInput {
  itemId: string;
  itemName: string;
  unitId: string;
  unitName: string;
  quantity: string;
}

function readLines(formData: FormData): AdjustmentLineInput[] {
  let lines: AdjustmentLineInput[];
  try {
    lines = JSON.parse(String(formData.get("linesJson") ?? "[]"));
  } catch {
    return [];
  }
  // Zero adjusts nothing, so a line counts only with an item and a non-zero
  // quantity — either direction.
  return lines.filter((l) => (l.itemId || l.itemName?.trim()) && Number(l.quantity) !== 0);
}

function getOrCreateAdjustmentDocumentType(companyId: string) {
  return ensureDocumentType({
    companyId,
    code: "STOCK_ADJUSTMENT",
    name: "Stock Adjustment",
    series: "SA",
    affectsInventory: true,
    active: true,
  });
}

export async function createStockAdjustment(
  _prevState: (ActionResult & { id?: string; status?: "posted" | "pending" }) | undefined,
  formData: FormData,
): Promise<ActionResult & { id?: string; status?: "posted" | "pending" }> {
  return guard("Couldn't create the stock adjustment.", async () => {
  const session = await getLiveSession();

  const operationId = readOperationId(formData);
  const companyId = String(formData.get("companyId") ?? "");
  const documentDate = String(formData.get("documentDate") ?? "");
  const locationRaw = String(formData.get("locationId") ?? "");
  const reason = String(formData.get("reason") ?? "");
  if (!companyId) return { error: "Company is required." };
  if (!documentDate) return { error: "Document date is required." };
  // Scoped to the submitted company: membership + stock_adjustments.create there.
  requirePermission(session, "stock_adjustments", "create", { companyId });
  // Checked before the sentinel is collapsed, so "nothing picked" and
  // "Unassigned picked" stay distinguishable. Adjusting at Unassigned is how
  // stock booked without a location gets written off or counted where it sits.
  if (!locationRaw) return { error: "Location is required." };
  const locationId = locationIdOrNull(locationRaw);
  if (locationId) requirePermission(session, "stock_adjustments", "create", { companyId, warehouseId: locationId });
  if (!ADJUSTMENT_REASONS.includes(reason as AdjustmentReason)) return { error: "Pick a reason for the adjustment." };

  const validLines = readLines(formData);
  if (validLines.length === 0) return { error: "Add at least one item with a non-zero quantity." };

  const documentType = await getOrCreateAdjustmentDocumentType(companyId);
  const approvalThreshold = Number(await companySettingValue(companyId, "adjustment_approval_amount")) || 0;

  let createdId: string;
  let createdNumber = "";
  let pendingApproval = false;
  try {
    createdId = await db.transaction(async (tx) => {
      // First statement: claim the operation id, or abort as a duplicate.
      if (!(await claimOperation(tx, operationId))) throw new DuplicateOperationError();
      const number = await nextDocumentNumber(documentType.series, tx);
      createdNumber = number;
      const itemIds = await resolveItemIds(
        tx,
        validLines.map((line) => ({ companyId, itemId: line.itemId || null, itemName: line.itemName || null })),
      );
      const unitIds = await resolveUnitIds(tx, validLines.map((line) => ({ unitId: line.unitId || null, unitName: line.unitName || null })));
      const baseQuantities = await resolveBaseQuantities(
        tx,
        validLines.map((line, index) => ({ itemId: itemIds[index] ?? null, unitId: unitIds[index] ?? null, quantity: Math.abs(Number(line.quantity)) })),
      );
      const costs = await averageCosts(tx, itemIds.map((itemId) => ({ itemId, locationId })));
      const adjustmentValue = baseQuantities.reduce((sum, quantity, index) => sum + quantity * (costs[index] ?? 0), 0);
      pendingApproval = approvalThreshold > 0 && adjustmentValue > approvalThreshold;
      const [doc] = await tx
        .insert(documents)
        .values({
          companyId,
          documentTypeId: documentType.id,
          number,
          status: pendingApproval ? "pending" : "posted",
          documentDate,
          reason,
          createdBy: session.userId,
        })
        .returning();
      const rows = validLines.map((l, index) => {
        const entered = Number(l.quantity);
        const itemId = itemIds[index] ?? null;
        return {
          movement: (entered < 0 ? -1 : 1) as -1 | 1,
          // An adjustment has no price of its own either — found or lost stock is
          // valued at what the location already holds it at. Left unpriced, an
          // increase would drag that location's average cost toward zero.
          unitCost: costs[index] ?? 0,
          line: {
            companyId,
            documentId: doc.id,
            lineNo: index + 1,
            sortOrder: index,
            itemId,
            locationId,
            unitId: unitIds[index] ?? null,
            quantity: String(Math.abs(entered)),
            baseQuantity: String(baseQuantities[index]),
            unitCost: String(costs[index] ?? 0),
            lineTotal: String((costs[index] ?? 0) * baseQuantities[index]),
            stockMovement: entered < 0 ? -1 : 1,
          } satisfies typeof documentLines.$inferInsert,
        };
      });

      const insertedLines = await tx
        .insert(documentLines)
        .values(rows.map((r) => r.line))
        .returning({ id: documentLines.id });

      if (!pendingApproval) {
        await tx.insert(inventoryTransactions).values(
          rows
            .map((r, i) => ({ ...r, lineId: insertedLines[i].id }))
            .filter((r) => r.line.itemId)
            .map((r) => ({
              companyId,
              documentLineId: r.lineId,
              movement: r.movement,
              quantity: r.line.quantity!,
              baseQuantity: r.line.baseQuantity!,
              unitCost: String(r.unitCost),
              totalCost: String(r.unitCost * Number(r.line.baseQuantity)),
            })),
        );
      }

      await tx.insert(documentNumberLedger).values({ companyId, documentTypeId: documentType.id, number, documentId: doc.id });

      return doc.id;
    });
  } catch (e) {
    if (e instanceof DuplicateOperationError) return { error: e.message };
    return { error: describeDbError(e, "Can't create — document number already in use for this company/type.") };
  }

  invalidateLookups(CACHE.documentTypes, CACHE.items, CACHE.cheques);
  revalidatePath("/inventory/stock-adjustments");
  revalidatePath("/inventory/stock");
  revalidatePath("/inventory/products");
  await recordAudit({ action: "create", entity: "stock adjustment", entityId: createdId, summary: createdNumber, companyId, detail: `${reason}${pendingApproval ? " · pending approval" : ""}` });
  return { success: true, id: createdId, status: pendingApproval ? "pending" : "posted" };
  });
}

export async function approveStockAdjustment(_prevState: ActionResult | undefined, formData: FormData): Promise<ActionResult> {
  return guard("Couldn't approve the stock adjustment.", async () => {
    const session = await getLiveSession();
    const documentId = String(formData.get("documentId") ?? "");
    requirePermission(session, "stock_adjustments", "approve");
    const [pending] = await db
      .select({ number: documents.number, companyId: documents.companyId, reason: documents.reason })
      .from(documents)
      .innerJoin(documentTypes, eq(documentTypes.id, documents.documentTypeId))
      .where(and(eq(documents.id, documentId), eq(documents.status, "pending"), eq(documentTypes.code, "STOCK_ADJUSTMENT"), await companyInScope(documents.companyId)))
      .limit(1);
    if (!pending) return { error: "Pending adjustment not found." };
    requirePermission(session, "stock_adjustments", "approve", { companyId: pending.companyId });

    await db.transaction(async (tx) => {
      const updated = await tx
        .update(documents)
        .set({ status: "posted", approvedBy: session.userId, updatedAt: new Date() })
        .where(and(eq(documents.id, documentId), eq(documents.status, "pending")))
        .returning({ id: documents.id });
      if (updated.length === 0) throw new Error("This adjustment is no longer pending.");
      await tx.execute(sql`
        INSERT INTO inventory_transactions
          (company_id, document_line_id, movement, quantity, base_quantity, unit_cost, total_cost)
        SELECT dl.company_id, dl.id, dl.stock_movement, dl.quantity, dl.base_quantity,
               dl.unit_cost, dl.line_total
        FROM document_lines dl
        WHERE dl.document_id = ${documentId}::uuid
          AND dl.item_id IS NOT NULL AND dl.stock_movement IS NOT NULL
      `);
    });

    invalidateLookups(CACHE.items);
    revalidatePath("/inventory/stock-adjustments");
    revalidatePath(`/inventory/stock-adjustments/${documentId}`);
    revalidatePath("/inventory/stock");
    await recordAudit({ action: "approve", entity: "stock adjustment", entityId: documentId, summary: pending.number, companyId: pending.companyId, detail: pending.reason });
    return { success: true };
  });
}

export async function deleteStockAdjustment(_prevState: ActionResult | undefined, formData: FormData): Promise<ActionResult> {
  return guard("Couldn't cancel the stock adjustment.", async () => {
  const session = await getLiveSession();
  requirePermission(session, "stock_adjustments", "approve");

  const documentId = String(formData.get("documentId") ?? "");
  if (!documentId) return { error: "Adjustment not found." };

  const [doomed] = await db
    .select({ number: documents.number, companyId: documents.companyId, reason: documents.reason, status: documents.status })
    .from(documents)
    .innerJoin(documentTypes, eq(documentTypes.id, documents.documentTypeId))
    .where(and(eq(documents.id, documentId), inArray(documents.status, ["pending", "posted"]), eq(documentTypes.code, "STOCK_ADJUSTMENT"), await companyInScope(documents.companyId)))
    .limit(1);
  if (!doomed) return { error: "Adjustment not found." };
  requirePermission(session, "stock_adjustments", "approve", { companyId: doomed.companyId });

  try {
    await db.transaction(async (tx) => {
      if (doomed.status === "posted") {
        await tx.execute(sql`
          INSERT INTO inventory_transactions
            (company_id, document_line_id, movement, quantity, base_quantity, unit_cost, total_cost)
          SELECT it.company_id, it.document_line_id, -it.movement, it.quantity,
                 it.base_quantity, it.unit_cost, it.total_cost
          FROM inventory_transactions it
          JOIN document_lines dl ON dl.id = it.document_line_id
          WHERE dl.document_id = ${documentId}::uuid
        `);
      }
      await tx.update(documents).set({ status: "cancelled", cancelledBy: session.userId, cancelledAt: new Date(), updatedAt: new Date() }).where(and(eq(documents.id, documentId), inArray(documents.status, ["pending", "posted"])));
    });
  } catch (e) {
    return { error: describeDbError(e, "Can't cancel this adjustment.") };
  }

  invalidateLookups(CACHE.documentTypes, CACHE.cheques);
  revalidatePath("/inventory/stock-adjustments");
  revalidatePath("/inventory/stock");
  await recordAudit({ action: "cancel", entity: "stock adjustment", entityId: documentId, summary: doomed.number, companyId: doomed.companyId, detail: doomed.reason });
  return { success: true };
  });
}
