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
import { UNASSIGNED_LABEL, locationFormValue, locationIdOrNull } from "@/lib/location-constants";
import { describeDbError, type ActionResult } from "@/lib/actions/guard";
import { recordAudit } from "@/lib/actions/audit";
import { claimOperation, readOperationId, DuplicateOperationError } from "@/lib/actions/operation-id";

// A transfer is stored as two document_lines per item: one at the source location
// carrying the -1 inventory movement, one at the destination carrying the +1.
// document_lines.location_id is a single column, and on-hand is derived from it
// (lib/actions/stock.ts), so a movement out of A and into B cannot share a line.
// The pair is what makes the same document reduce A and raise B.

export interface TransferItemRow {
  itemName: string;
  quantity: string;
  unitSymbol: string | null;
}

export async function listStockTransfers() {
  const session = await getSession();
  requirePermission(session, "stock_transfers", "view");
  const scope = await companyInScope(documents.companyId);

  // Both queries only need the document type, not ids from the first, so they run
  // concurrently — same reasoning as listSales.
  const [docs, lineRows] = await Promise.all([
    db
      .select({
        id: documents.id,
        number: documents.number,
        documentDate: documents.documentDate,
        status: documents.status,
        company: companies.name,
      })
      .from(documents)
      .innerJoin(documentTypes, eq(documentTypes.id, documents.documentTypeId))
      .innerJoin(companies, eq(companies.id, documents.companyId))
      .where(and(eq(documentTypes.code, "STOCK_TRANSFER"), scope))
      .orderBy(desc(documents.documentDate)),
    db
      .select({
        documentId: documentLines.documentId,
        itemName: items.name,
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
      .where(and(eq(documentTypes.code, "STOCK_TRANSFER"), scope))
      .orderBy(documentLines.lineNo),
  ]);

  // From/to aren't stored on the document — they're the locations of the -1 and
  // +1 sides of the pair, so they're read back off the lines.
  const byDoc = new Map<string, { from: string | null; to: string | null; items: TransferItemRow[] }>();
  for (const l of lineRows) {
    const entry = byDoc.get(l.documentId) ?? { from: null, to: null, items: [] };
    if (l.movement === -1) {
      entry.from ??= l.locationName;
      // Only the outbound side is listed, or every item would appear twice.
      entry.items.push({ itemName: l.itemName ?? "—", quantity: l.quantity, unitSymbol: l.unitSymbol });
    } else {
      entry.to ??= l.locationName;
    }
    byDoc.set(l.documentId, entry);
  }

  return docs.map((d) => ({
    ...d,
    from: byDoc.get(d.id)?.from ?? "—",
    to: byDoc.get(d.id)?.to ?? "—",
    items: byDoc.get(d.id)?.items ?? [],
  }));
}

export async function getStockTransfer(documentId: string) {
  const session = await getSession();
  requirePermission(session, "stock_transfers", "view");

  // Ids, not names — this feeds the edit form, which resolves its own labels from
  // the option lists. from/to are read back off the -1 and +1 sides of each pair.
  const [[doc], lineRows] = await Promise.all([
    db.select().from(documents).where(eq(documents.id, documentId)).limit(1),
    db
      .select({
        itemId: documentLines.itemId,
        unitId: documentLines.unitId,
        locationId: documentLines.locationId,
        quantity: documentLines.quantity,
        movement: inventoryTransactions.movement,
      })
      .from(documentLines)
      .innerJoin(inventoryTransactions, eq(inventoryTransactions.documentLineId, documentLines.id))
      .where(eq(documentLines.documentId, documentId))
      .orderBy(documentLines.lineNo),
  ]);
  if (!doc) return null;

  const out = lineRows.filter((l) => l.movement === -1);
  const inbound = lineRows.find((l) => l.movement === 1);
  return {
    id: doc.id,
    number: doc.number,
    companyId: doc.companyId,
    documentDate: doc.documentDate,
    status: doc.status,
    // A NULL location on a saved line means Unassigned, not "unset" — mapping it
    // back to the sentinel is what lets the form reselect it instead of opening
    // on a blank dropdown and silently changing the transfer on the next save.
    fromLocationId: out[0] ? locationFormValue(out[0].locationId) : "",
    toLocationId: inbound ? locationFormValue(inbound.locationId) : "",
    // One entry per item — the inbound half of each pair carries no extra
    // information, it's the same item and quantity at the other location.
    lines: out.map((l) => ({
      itemId: l.itemId ?? "",
      unitId: l.unitId ?? "",
      quantity: l.quantity,
    })),
  };
}

interface TransferLineInput {
  itemId: string;
  itemName: string;
  unitId: string;
  unitName: string;
  quantity: string;
}

function readLines(formData: FormData): TransferLineInput[] {
  let lines: TransferLineInput[];
  try {
    lines = JSON.parse(String(formData.get("linesJson") ?? "[]"));
  } catch {
    return [];
  }
  return lines.filter((l) => (l.itemId || l.itemName?.trim()) && Number(l.quantity) > 0);
}

// Fixed document type, same as sales invoices — never user-configured.
function getOrCreateTransferDocumentType(companyId: string) {
  return ensureDocumentType({
    companyId,
    code: "STOCK_TRANSFER",
    name: "Stock Transfer",
    series: "ST",
    affectsInventory: true,
    active: true,
  });
}

type TransferTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

// The header fields, validated once for both create and edit.
//
// Either side may be "Unassigned" — stock booked with no location at all. That
// is the whole point of offering it: a transfer out of Unassigned into a real
// location is how mislaid stock gets put where it belongs, and it does it with
// a document rather than an UPDATE nobody can see afterwards. Validation runs on
// the raw form values, where "" (nothing picked) and the sentinel (Unassigned
// picked) are still different things; only then do both collapse to NULL.
function readHeader(formData: FormData) {
  const companyId = String(formData.get("companyId") ?? "");
  const documentDate = String(formData.get("documentDate") ?? "");
  const fromRaw = String(formData.get("fromLocationId") ?? "");
  const toRaw = String(formData.get("toLocationId") ?? "");
  const lines = readLines(formData);

  const error = !companyId
    ? "Company is required."
    : !documentDate
      ? "Document date is required."
      : !fromRaw || !toRaw
        ? "Both a source and a destination location are required."
        : fromRaw === toRaw
          ? "Source and destination must be different locations."
          : lines.length === 0
            ? "Add at least one item."
            : null;

  return { companyId, documentDate, fromLocationId: locationIdOrNull(fromRaw), toLocationId: locationIdOrNull(toRaw), lines, error };
}

// Two lines per item — out of the source, into the destination — plus the matching
// inventory movements. A transfer moves stock, not money, so every amount stays 0.
// The movement rides alongside the row rather than in it: document_lines has no
// such column, it belongs on the inventory_transactions row written from the pair.
//
// Shared by create and edit; an edit clears the old lines first and calls this
// again, so the two can't drift apart.
async function writeTransferLines(
  tx: TransferTx,
  documentId: string,
  header: { companyId: string; fromLocationId: string | null; toLocationId: string | null; lines: TransferLineInput[] },
) {
  const { companyId, fromLocationId, toLocationId } = header;
  const pairs: { line: typeof documentLines.$inferInsert; movement: 1 | -1; unitCost: number }[] = [];

  for (const l of header.lines) {
    const quantity = String(Number(l.quantity));
    const itemId = await resolveItemId(tx, companyId, l.itemId || null, l.itemName || null);
    const unitId = await resolveUnitId(tx, l.unitId || null, l.unitName || null);
    // A transfer carries no price of its own, so it moves at cost — the source
    // location's average. Without this the receiving location valued the stock at
    // zero (see lib/queries/stock-cost.ts).
    const unitCost = itemId ? await averageCost(tx, itemId, fromLocationId) : 0;
    for (const [locationId, movement] of [
      [fromLocationId, -1],
      [toLocationId, 1],
    ] as const) {
      pairs.push({
        movement,
        unitCost,
        line: {
          companyId,
          documentId,
          lineNo: pairs.length + 1,
          sortOrder: pairs.length,
          itemId,
          locationId,
          unitId,
          quantity,
          baseQuantity: quantity,
        },
      });
    }
  }

  const insertedLines = await tx
    .insert(documentLines)
    .values(pairs.map((p) => p.line))
    .returning({ id: documentLines.id });

  await tx.insert(inventoryTransactions).values(
    pairs
      .map((p, i) => ({ ...p, lineId: insertedLines[i].id }))
      // Nothing to track stock of when the line has no catalog item.
      .filter((p) => p.line.itemId)
      .map((p) => ({
        companyId,
        documentLineId: p.lineId,
        movement: p.movement,
        quantity: p.line.quantity!,
        baseQuantity: p.line.baseQuantity!,
        unitCost: String(p.unitCost),
        totalCost: String(p.unitCost * Number(p.line.baseQuantity)),
      })),
  );
}

// Stock moved, and items can appear out of nowhere (resolve-refs.ts), so the
// lookup lists and every page reading stock are stale.
function invalidateTransferViews() {
  invalidateLookups(CACHE.documentTypes, CACHE.items, CACHE.cheques);
  revalidatePath("/inventory/stock-transfers");
  revalidatePath("/inventory/stock");
  revalidatePath("/inventory/products");
}

export async function createStockTransfer(
  _prevState: (ActionResult & { id?: string }) | undefined,
  formData: FormData,
) {
  const session = await getSession();
  requirePermission(session, "stock_transfers", "create");

  const header = readHeader(formData);
  if (header.error) return { error: header.error };
  const operationId = readOperationId(formData);

  const documentType = await getOrCreateTransferDocumentType(header.companyId);

  let createdId: string;
  let createdNumber = "";
  try {
    createdId = await db.transaction(async (tx) => {
      // First statement: claim the operation id, or abort as a duplicate.
      if (!(await claimOperation(tx, operationId))) throw new DuplicateOperationError();
      const number = await nextDocumentNumber(documentType.series, tx);
      createdNumber = number;
      const [doc] = await tx
        .insert(documents)
        .values({
          companyId: header.companyId,
          documentTypeId: documentType.id,
          number,
          status: "posted",
          documentDate: header.documentDate,
          createdBy: session.userId,
        })
        .returning({ id: documents.id });

      await writeTransferLines(tx, doc.id, header);
      await tx
        .insert(documentNumberLedger)
        .values({ companyId: header.companyId, documentTypeId: documentType.id, number, documentId: doc.id });

      return doc.id;
    });
  } catch (e) {
    if (e instanceof DuplicateOperationError) return { error: e.message };
    return { error: describeDbError(e, "Can't create — document number already in use for this company/type.") };
  }

  invalidateTransferViews();
  await recordAudit({ action: "create", entity: "stock transfer", entityId: createdId, summary: createdNumber, companyId: header.companyId });
  return { success: true, id: createdId };
}

// Editing replays the whole transfer: the old movements and lines go, the new ones
// are written in their place. Stock lands correctly because it's derived from
// what's there now, not from a running total — dropping the -1/+1 pair is the
// reversal, and inserting the new pair is the re-post.
export async function updateStockTransfer(
  documentId: string,
  _prevState: ActionResult | undefined,
  formData: FormData,
) {
  const session = await getSession();
  requirePermission(session, "stock_transfers", "create");

  const header = readHeader(formData);
  if (header.error) return { error: header.error };

  const [existing] = await db.select({ id: documents.id, number: documents.number }).from(documents).where(eq(documents.id, documentId)).limit(1);
  if (!existing) return { error: "Transfer not found." };

  try {
    await db.transaction(async (tx) => {
      await tx
        .update(documents)
        .set({ companyId: header.companyId, documentDate: header.documentDate, status: "posted", updatedAt: new Date() })
        .where(eq(documents.id, documentId));

      // inventory_transactions.document_line_id is ON DELETE RESTRICT, so the
      // movements go before the lines they point at can be replaced.
      const oldLines = await tx.select({ id: documentLines.id }).from(documentLines).where(eq(documentLines.documentId, documentId));
      if (oldLines.length > 0) {
        await tx.delete(inventoryTransactions).where(
          inArray(
            inventoryTransactions.documentLineId,
            oldLines.map((l) => l.id),
          ),
        );
      }
      await tx.delete(documentLines).where(eq(documentLines.documentId, documentId));

      await writeTransferLines(tx, documentId, header);
    });
  } catch (e) {
    return { error: describeDbError(e, "Can't save this transfer.") };
  }

  invalidateTransferViews();
  revalidatePath(`/inventory/stock-transfers/${documentId}`);
  await recordAudit({ action: "update", entity: "stock transfer", entityId: documentId, summary: existing.number, companyId: header.companyId });
  return { success: true };
}

export async function deleteStockTransfer(_prevState: ActionResult | undefined, formData: FormData) {
  const session = await getSession();
  // No stock_transfers.delete in the permission catalog — reversing a posted
  // transfer is an approve-level act, so it reuses that.
  requirePermission(session, "stock_transfers", "approve");

  const documentId = String(formData.get("documentId") ?? "");
  if (!documentId) return { error: "Transfer not found." };

  // Read before the delete, because afterwards there is nothing left to name it
  // by — an audit entry saying a uuid was deleted answers nobody.
  const [doomed] = await db
    .select({ number: documents.number, companyId: documents.companyId })
    .from(documents)
    .where(eq(documents.id, documentId))
    .limit(1);
  if (!doomed) return { error: "Transfer not found." };

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
    return { error: describeDbError(e, "Can't delete — this transfer is still referenced elsewhere.") };
  }

  invalidateTransferViews();
  await recordAudit({ action: "delete", entity: "stock transfer", entityId: documentId, summary: doomed.number, companyId: doomed.companyId });
  return { success: true };
}
