"use server";

import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { companies, inventoryTransactions, documentLines, items, locations, units } from "@/lib/db/schema";
import { getSession } from "@/lib/auth/session";
import { requirePermission } from "@/lib/auth/permissions";
import { companyInPermissionScope, getScopeCompanyIds } from "@/lib/auth/scope";
import { UNASSIGNED_LABEL, UNASSIGNED_LOCATION } from "@/lib/location-constants";
import { cachedPageRead, stableReadKey } from "@/lib/read-cache";

export interface StockUnitTotal {
  unit: string;
  onHand: number;
  valuation: number;
}

export interface StockLocationBreakdown {
  location: string;
  unit: string;
  onHand: number;
  valuation: number;
}

export interface StockItemRow {
  itemId: string;
  itemName: string;
  sku: string;
  // The item's owning company (items.company_id is NOT NULL — no global products),
  // so this never splits an item across rows.
  company: string;
  location: string;
  // Different units for the same item are never added together — each gets
  // its own total here (one item = one card, one entry per unit).
  unitTotals: StockUnitTotal[];
  // Populated only in the "all locations" view. One entry per location+unit
  // pair — a location stocking an item in two units gets two rows here.
  breakdown: StockLocationBreakdown[];
}

// On-hand quantity is derived, not stored — SUM(movement * base_quantity)
// over every inventory_transactions row for the item, scoped to a matching
// unit (a line with no unit recorded gets its own "—" bucket). No
// locationId filter aggregates every location into one card per item — the
// "All" default — with a per-location, per-unit breakdown; a locationId
// filter (including the "unassigned" sentinel, for lines with no location)
// scopes everything to that one location and skips the breakdown.
// `companyId` narrows to one company on top of the scope, which the page drives
// from a query param — it never widens anything, since companyInScope() still
// gates every row.
export async function listStockLevels(locationId?: string, companyId?: string): Promise<StockItemRow[]> {
  const session = await getSession();
  requirePermission(session, "products", "view");
  const cacheScope = (await getScopeCompanyIds()).sort().join(",");

  return cachedPageRead(`${session.userId}:stock:${cacheScope}:${stableReadKey({ locationId, companyId })}`, async () => {

  // Aggregated in SQL (GROUP BY) instead of pulling every inventory_transactions
  // row ever recorded to Node and reducing in JS — that scaled with total
  // transaction history instead of distinct item x unit x location count and
  // got slower every purchase/sale ever made.
  const rows = await db
    .select({
      itemId: items.id,
      itemName: items.name,
      sku: items.sku,
      companyName: companies.name,
      locationId: documentLines.locationId,
      locationName: locations.name,
      unit: sql<string>`coalesce(${units.symbol}, '—')`,
      onHand: sql<string>`sum(${inventoryTransactions.movement} * ${inventoryTransactions.baseQuantity})`,
      costSum: sql<string>`sum(case when ${inventoryTransactions.movement} = 1 then ${inventoryTransactions.totalCost} else 0 end)`,
      costQty: sql<string>`sum(case when ${inventoryTransactions.movement} = 1 then ${inventoryTransactions.baseQuantity} else 0 end)`,
    })
    .from(inventoryTransactions)
    .innerJoin(documentLines, eq(documentLines.id, inventoryTransactions.documentLineId))
    .innerJoin(items, eq(items.id, documentLines.itemId))
    .innerJoin(companies, eq(companies.id, items.companyId))
    .leftJoin(locations, eq(locations.id, documentLines.locationId))
    .leftJoin(units, eq(units.id, documentLines.unitId))
    .where(
      and(
        // Stock is scoped by the item's company (inventory_transactions carries
        // company_id too, but the item is the source of truth for ownership).
        await companyInPermissionScope(items.companyId, session, "products"),
        companyId ? eq(items.companyId, companyId) : undefined,
        locationId === UNASSIGNED_LOCATION
          ? isNull(documentLines.locationId)
          : locationId
            ? eq(documentLines.locationId, locationId)
            : undefined,
      ),
    )
    .groupBy(items.id, items.name, items.sku, companies.name, documentLines.locationId, locations.name, units.symbol);

  // All rows share one location when locationId is set — grab its name once.
  const filteredLocationName = locationId ? (rows[0]?.locationName ?? UNASSIGNED_LABEL) : null;

  // Level 1: one row per item + unit + location already, straight from SQL.
  type LocAgg = {
    itemId: string;
    itemName: string;
    sku: string;
    companyName: string;
    unit: string;
    locationName: string;
    onHand: number;
    costSum: number;
    costQty: number;
  };
  const byItemUnitLocation = new Map<string, LocAgg>();
  for (const r of rows) {
    const key = `${r.itemId}::${r.unit}::${r.locationId ?? UNASSIGNED_LOCATION}`;
    byItemUnitLocation.set(key, {
      itemId: r.itemId,
      itemName: r.itemName,
      sku: r.sku,
      companyName: r.companyName,
      unit: r.unit,
      locationName: r.locationName ?? UNASSIGNED_LABEL,
      onHand: Number(r.onHand),
      costSum: Number(r.costSum),
      costQty: Number(r.costQty),
    });
  }

  // Level 2: roll up per item — a unitTotal per distinct unit (summed across
  // locations), plus the raw location+unit breakdown for the "all" view.
  type ItemAgg = {
    itemId: string;
    itemName: string;
    sku: string;
    companyName: string;
    unitAgg: Map<string, { onHand: number; costSum: number; costQty: number }>;
    breakdown: StockLocationBreakdown[];
  };
  const byItem = new Map<string, ItemAgg>();
  for (const loc of byItemUnitLocation.values()) {
    const entry: ItemAgg = byItem.get(loc.itemId) ?? {
      itemId: loc.itemId,
      itemName: loc.itemName,
      sku: loc.sku,
      companyName: loc.companyName,
      unitAgg: new Map(),
      breakdown: [],
    };
    const u = entry.unitAgg.get(loc.unit) ?? { onHand: 0, costSum: 0, costQty: 0 };
    u.onHand += loc.onHand;
    u.costSum += loc.costSum;
    u.costQty += loc.costQty;
    entry.unitAgg.set(loc.unit, u);

    if (!locationId && loc.onHand !== 0) {
      const locAvgCost = loc.costQty > 0 ? loc.costSum / loc.costQty : 0;
      entry.breakdown.push({ location: loc.locationName, unit: loc.unit, onHand: loc.onHand, valuation: loc.onHand * locAvgCost });
    }
    byItem.set(loc.itemId, entry);
  }

  return Array.from(byItem.values())
    .map((e) => {
      const unitTotals: StockUnitTotal[] = Array.from(e.unitAgg.entries())
        .map(([unit, u]) => ({
          unit,
          onHand: u.onHand,
          valuation: u.onHand * (u.costQty > 0 ? u.costSum / u.costQty : 0),
        }))
        .sort((a, b) => a.unit.localeCompare(b.unit));

      // An item stocked in exactly one place doesn't need "All Locations" and a
      // one-row breakdown restating it — name the location on the item row and
      // drop the breakdown. Two or more, and the split is worth showing.
      const stockedIn = new Set(e.breakdown.map((b) => b.location));
      const onlyLocation = stockedIn.size === 1 ? [...stockedIn][0] : null;

      return {
        itemId: e.itemId,
        itemName: e.itemName,
        sku: e.sku,
        company: e.companyName,
        location: filteredLocationName ?? onlyLocation ?? "All Locations",
        unitTotals,
        breakdown: onlyLocation ? [] : e.breakdown.sort((a, b) => a.location.localeCompare(b.location) || a.unit.localeCompare(b.unit)),
      };
    })
    .sort((a, b) => a.itemName.localeCompare(b.itemName));
  });
}
