"use server";

import { and, desc, eq, gte, ilike, lte, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { companies, contacts, documentLines, documentTypes, documents, inventoryTransactions, items, locations, units, users } from "@/lib/db/schema";
import { getSession } from "@/lib/auth/session";
import { requirePermission } from "@/lib/auth/permissions";
import { companyInScope } from "@/lib/auth/scope";

// Every movement of stock, in and out, in the order it happened. This page used
// to be four rows invented in lib/modules.ts; the data behind it has existed all
// along — inventory_transactions is written by every sale, purchase, transfer and
// adjustment — it simply was never read.
//
// One query with the joins it needs, capped. An inventory ledger only grows, so
// an uncapped SELECT is a page that works for a month and then doesn't.

export type StockMovementRow = {
  id: string;
  date: string;
  createdAt: Date;
  itemName: string;
  sku: string;
  company: string;
  location: string;
  // Sale / Purchase / Stock Transfer / Adjustment — the document type's name, so
  // it stays right when a new type is added.
  type: string;
  // Signed: negative left the building.
  quantity: string;
  unit: string;
  reference: string;
  contact: string | null;
  user: string | null;
  value: string | null;
};

export type MovementFilters = {
  // Document number, matched anywhere in it — "3311" finds SI-3311.
  reference?: string;
  item?: string;
  location?: string;
  company?: string;
  type?: string;
  from?: string;
  to?: string;
};

const PAGE = 500;

export async function listStockMovements(filters: MovementFilters = {}): Promise<StockMovementRow[]> {
  const session = await getSession();
  requirePermission(session, "stock", "view");

  const rows = await db
    .select({
      id: inventoryTransactions.id,
      createdAt: inventoryTransactions.createdAt,
      date: documents.documentDate,
      itemName: items.name,
      sku: items.sku,
      company: companies.name,
      location: locations.name,
      type: documentTypes.name,
      typeCode: documentTypes.code,
      movement: inventoryTransactions.movement,
      quantity: inventoryTransactions.quantity,
      unit: units.symbol,
      unitName: units.name,
      reference: documents.number,
      contact: contacts.displayName,
      user: users.name,
      totalCost: inventoryTransactions.totalCost,
    })
    .from(inventoryTransactions)
    .innerJoin(documentLines, eq(documentLines.id, inventoryTransactions.documentLineId))
    .innerJoin(documents, eq(documents.id, documentLines.documentId))
    .innerJoin(documentTypes, eq(documentTypes.id, documents.documentTypeId))
    .innerJoin(companies, eq(companies.id, inventoryTransactions.companyId))
    .leftJoin(items, eq(items.id, documentLines.itemId))
    .leftJoin(locations, eq(locations.id, documentLines.locationId))
    .leftJoin(units, eq(units.id, documentLines.unitId))
    .leftJoin(contacts, eq(contacts.id, documents.contactId))
    .leftJoin(users, eq(users.id, documents.createdBy))
    .where(
      and(
        await companyInScope(inventoryTransactions.companyId),
        // Narrows within the scope, never widens it.
        filters.company ? eq(inventoryTransactions.companyId, filters.company) : undefined,
        filters.location ? eq(documentLines.locationId, filters.location) : undefined,
        filters.item ? eq(documentLines.itemId, filters.item) : undefined,
        filters.reference ? ilike(documents.number, `%${filters.reference}%`) : undefined,
        filters.type ? eq(documentTypes.code, filters.type as "SALES_INVOICE") : undefined,
        filters.from ? gte(documents.documentDate, filters.from) : undefined,
        filters.to ? lte(documents.documentDate, filters.to) : undefined,
      ),
    )
    // Newest first, and createdAt breaks the tie — a day's movements all carry
    // the same document_date, so without it today's order is whatever the
    // planner happens to return.
    .orderBy(desc(documents.documentDate), desc(inventoryTransactions.createdAt))
    .limit(PAGE);

  return rows.map((r) => ({
    id: r.id,
    date: r.date,
    createdAt: r.createdAt ?? new Date(),
    itemName: r.itemName ?? "—",
    sku: r.sku ?? "—",
    company: r.company,
    location: r.location ?? "Unassigned",
    type: r.type,
    // The sign lives in `movement` (+1 in, -1 out) and the quantity is stored
    // absolute; the two are only meaningful together, so they're combined here
    // rather than in three different places on screen.
    quantity: String(r.movement * Number(r.quantity)),
    unit: r.unit ?? r.unitName ?? "",
    reference: r.reference,
    contact: r.contact,
    user: r.user,
    value: r.totalCost,
  }));
}

// The document types that have actually moved stock, for the type filter —
// offering every type in the enum when most have never been used is a filter
// that mostly returns nothing.
export async function movementTypes(): Promise<{ id: string; name: string }[]> {
  const session = await getSession();
  requirePermission(session, "stock", "view");

  const rows = await db
    .selectDistinct({ code: documentTypes.code, name: documentTypes.name })
    .from(inventoryTransactions)
    .innerJoin(documentLines, eq(documentLines.id, inventoryTransactions.documentLineId))
    .innerJoin(documents, eq(documents.id, documentLines.documentId))
    .innerJoin(documentTypes, eq(documentTypes.id, documents.documentTypeId))
    .where(await companyInScope(inventoryTransactions.companyId))
    .orderBy(documentTypes.name);

  return rows.map((r) => ({ id: r.code, name: r.name }));
}

// Running total for one item at one location — what the stock card of an item
// looks like, which is the question "why is the on-hand what it is" turned into
// a list. Computed as a window function rather than in JS so it stays correct
// when the list is capped.
export async function itemStockCard(itemId: string, locationId?: string) {
  const session = await getSession();
  requirePermission(session, "stock", "view");

  return db
    .select({
      id: inventoryTransactions.id,
      date: documents.documentDate,
      type: documentTypes.name,
      reference: documents.number,
      quantity: sql<string>`${inventoryTransactions.movement} * ${inventoryTransactions.baseQuantity}`,
      running: sql<string>`sum(${inventoryTransactions.movement} * ${inventoryTransactions.baseQuantity}) over (order by ${documents.documentDate}, ${inventoryTransactions.createdAt})`,
    })
    .from(inventoryTransactions)
    .innerJoin(documentLines, eq(documentLines.id, inventoryTransactions.documentLineId))
    .innerJoin(documents, eq(documents.id, documentLines.documentId))
    .innerJoin(documentTypes, eq(documentTypes.id, documents.documentTypeId))
    .where(
      and(
        eq(documentLines.itemId, itemId),
        locationId ? eq(documentLines.locationId, locationId) : undefined,
        await companyInScope(inventoryTransactions.companyId),
      ),
    )
    .orderBy(documents.documentDate, inventoryTransactions.createdAt);
}
