"use server";

import { and, desc, eq, inArray, sql } from "drizzle-orm";
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
import { getSession } from "@/lib/auth/session";
import { requirePermission } from "@/lib/auth/permissions";
import { companyInScope } from "@/lib/auth/scope";
import { CACHE, invalidateLookups } from "@/lib/queries/lookups";
import { ensureDocumentType, nextDocumentNumber } from "@/lib/actions/document-numbering";
import { resolveItemId, resolveUnitId } from "@/lib/actions/resolve-refs";
import { averageCost } from "@/lib/queries/stock-cost";
import { ADJUSTMENT_REASONS, type AdjustmentReason } from "@/lib/adjustment-constants";
import { UNASSIGNED_LABEL, locationIdOrNull } from "@/lib/location-constants";
import { describeDbError, type ActionResult } from "@/lib/actions/guard";
import { recordAudit } from "@/lib/actions/audit";

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
  const scope = and(await companyInScope(documents.companyId), companyId ? eq(documents.companyId, companyId) : undefined);

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
        movement: inventoryTransactions.movement,
      })
      .from(documentLines)
      .innerJoin(documents, eq(documents.id, documentLines.documentId))
      .innerJoin(documentTypes, eq(documentTypes.id, documents.documentTypeId))
      .innerJoin(inventoryTransactions, eq(inventoryTransactions.documentLineId, documentLines.id))
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
    const signed = Number(l.quantity) * l.movement;
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
    db.select().from(documents).where(eq(documents.id, documentId)).limit(1),
    db
      .select({
        itemName: items.name,
        sku: items.sku,
        quantity: documentLines.quantity,
        unitSymbol: units.symbol,
        // A line with no location is where the stock actually is — nowhere in
        // particular — so it reads as Unassigned rather than as a missing value.
        locationName: sql<string>`coalesce(${locations.name}, ${UNASSIGNED_LABEL})`,
        movement: inventoryTransactions.movement,
      })
      .from(documentLines)
      .innerJoin(inventoryTransactions, eq(inventoryTransactions.documentLineId, documentLines.id))
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
      quantity: String(Number(l.quantity) * l.movement),
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
  _prevState: (ActionResult & { id?: string }) | undefined,
  formData: FormData,
) {
  const session = await getSession();
  requirePermission(session, "stock_adjustments", "create");

  const companyId = String(formData.get("companyId") ?? "");
  const documentDate = String(formData.get("documentDate") ?? "");
  const locationRaw = String(formData.get("locationId") ?? "");
  const reason = String(formData.get("reason") ?? "");
  if (!companyId) return { error: "Company is required." };
  if (!documentDate) return { error: "Document date is required." };
  // Checked before the sentinel is collapsed, so "nothing picked" and
  // "Unassigned picked" stay distinguishable. Adjusting at Unassigned is how
  // stock booked without a location gets written off or counted where it sits.
  if (!locationRaw) return { error: "Location is required." };
  const locationId = locationIdOrNull(locationRaw);
  if (!ADJUSTMENT_REASONS.includes(reason as AdjustmentReason)) return { error: "Pick a reason for the adjustment." };

  const validLines = readLines(formData);
  if (validLines.length === 0) return { error: "Add at least one item with a non-zero quantity." };

  const documentType = await getOrCreateAdjustmentDocumentType(companyId);

  let createdId: string;
  let createdNumber = "";
  try {
    createdId = await db.transaction(async (tx) => {
      const number = await nextDocumentNumber(documentType.series, tx);
      createdNumber = number;
      const [doc] = await tx
        .insert(documents)
        .values({
          companyId,
          documentTypeId: documentType.id,
          number,
          status: "posted",
          documentDate,
          reason,
          createdBy: session.userId,
        })
        .returning();

      const rows = [];
      for (const l of validLines) {
        const entered = Number(l.quantity);
        const itemId = await resolveItemId(tx, companyId, l.itemId || null, l.itemName || null);
        rows.push({
          movement: (entered < 0 ? -1 : 1) as -1 | 1,
          // An adjustment has no price of its own either — found or lost stock is
          // valued at what the location already holds it at. Left unpriced, an
          // increase would drag that location's average cost toward zero.
          unitCost: itemId ? await averageCost(tx, itemId, locationId) : 0,
          line: {
            companyId,
            documentId: doc.id,
            lineNo: rows.length + 1,
            sortOrder: rows.length,
            itemId,
            locationId,
            unitId: await resolveUnitId(tx, l.unitId || null, l.unitName || null),
            quantity: String(Math.abs(entered)),
            baseQuantity: String(Math.abs(entered)),
          } satisfies typeof documentLines.$inferInsert,
        });
      }

      const insertedLines = await tx
        .insert(documentLines)
        .values(rows.map((r) => r.line))
        .returning({ id: documentLines.id });

      await tx.insert(inventoryTransactions).values(
        rows
          .map((r, i) => ({ ...r, lineId: insertedLines[i].id }))
          // Nothing to track stock of when the line has no catalog item.
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

      await tx.insert(documentNumberLedger).values({ companyId, documentTypeId: documentType.id, number, documentId: doc.id });

      return doc.id;
    });
  } catch (e) {
    return { error: describeDbError(e, "Can't create — document number already in use for this company/type.") };
  }

  invalidateLookups(CACHE.documentTypes, CACHE.items, CACHE.cheques);
  revalidatePath("/inventory/stock-adjustments");
  revalidatePath("/inventory/stock");
  revalidatePath("/inventory/products");
  await recordAudit({ action: "create", entity: "stock adjustment", entityId: createdId, summary: createdNumber, companyId, detail: reason });
  return { success: true, id: createdId };
}

export async function deleteStockAdjustment(_prevState: ActionResult | undefined, formData: FormData) {
  const session = await getSession();
  // No stock_adjustments.delete in the permission catalog — undoing a posted
  // adjustment is an approve-level act, so it reuses that.
  requirePermission(session, "stock_adjustments", "approve");

  const documentId = String(formData.get("documentId") ?? "");
  if (!documentId) return { error: "Adjustment not found." };

  // Read before the delete, because afterwards there is nothing left to name it
  // by — an audit entry saying a uuid was deleted answers nobody.
  const [doomed] = await db
    .select({ number: documents.number, companyId: documents.companyId, reason: documents.reason })
    .from(documents)
    .where(eq(documents.id, documentId))
    .limit(1);
  if (!doomed) return { error: "Adjustment not found." };

  try {
    await db.transaction(async (tx) => {
      // inventory_transactions.document_line_id is ON DELETE RESTRICT, so the
      // movements go before the lines they point at.
      const oldLines = await tx.select({ id: documentLines.id }).from(documentLines).where(eq(documentLines.documentId, documentId));
      if (oldLines.length > 0) {
        await tx.delete(inventoryTransactions).where(
          inArray(
            inventoryTransactions.documentLineId,
            oldLines.map((l) => l.id),
          ),
        );
      }
      await tx.delete(documents).where(eq(documents.id, documentId));
    });
  } catch (e) {
    return { error: describeDbError(e, "Can't delete — this adjustment is still referenced elsewhere.") };
  }

  invalidateLookups(CACHE.documentTypes, CACHE.cheques);
  revalidatePath("/inventory/stock-adjustments");
  revalidatePath("/inventory/stock");
  await recordAudit({ action: "delete", entity: "stock adjustment", entityId: documentId, summary: doomed.number, companyId: doomed.companyId, detail: doomed.reason });
  return { success: true };
}
