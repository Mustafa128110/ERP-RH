import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

// Weighted average cost of one item: the total cost of its priced inflows over
// their quantity. Only movement = 1 rows carry a cost, which is the same basis
// lib/actions/stock.ts values stock on, so this and the Stock page agree.
//
// Movements that aren't a purchase (a transfer, an adjustment) have no price of
// their own — the stock is already owned, it's just somewhere else or recounted.
// Leaving their cost NULL made the receiving location value at zero: the Stock
// page divides cost by quantity per location, so a location that only ever
// received transfers had cost 0 over a real quantity. Stamping this average on
// the movement moves the value with the goods.
//
// Prefers the average at the location the stock is leaving (FR-PROD-006 keeps
// average cost per warehouse), and falls back to the item's overall average when
// that location has no priced inflow of its own — which is the normal case for a
// shop that only ever receives transfers from the warehouse.
export async function averageCost(tx: Tx, itemId: string, locationId: string | null): Promise<number> {
  const priced = sql`${sql.raw("it")}.movement = 1 AND ${sql.raw("it")}.total_cost IS NOT NULL`;
  const rows = await tx.execute<{ at_location: string | null; overall: string | null }>(sql`
    SELECT
      (SELECT sum(it.total_cost) / nullif(sum(it.base_quantity), 0)
         FROM inventory_transactions it
         JOIN document_lines dl ON dl.id = it.document_line_id
        WHERE dl.item_id = ${itemId}
          AND dl.location_id IS NOT DISTINCT FROM ${locationId}
          AND ${priced}) AS at_location,
      (SELECT sum(it.total_cost) / nullif(sum(it.base_quantity), 0)
         FROM inventory_transactions it
         JOIN document_lines dl ON dl.id = it.document_line_id
        WHERE dl.item_id = ${itemId}
          AND ${priced}) AS overall`);

  const row = rows[0];
  return Number(row?.at_location ?? row?.overall ?? 0);
}

export async function averageCosts(tx: Tx, rows: { itemId: string | null; locationId: string | null }[]): Promise<number[]> {
  if (rows.length === 0) return [];
  const values = sql.join(
    rows.map((row, index) => sql`(${index}::int, ${row.itemId}::uuid, ${row.locationId}::uuid)`),
    sql`, `,
  );
  const costs = await tx.execute<{ position: number; unit_cost: string | null }>(sql`
    WITH input(position, item_id, location_id) AS (VALUES ${values})
    SELECT i.position,
      coalesce(
        sum(it.total_cost) FILTER (WHERE dl.location_id IS NOT DISTINCT FROM i.location_id)
          / nullif(sum(it.base_quantity) FILTER (WHERE dl.location_id IS NOT DISTINCT FROM i.location_id), 0),
        sum(it.total_cost) / nullif(sum(it.base_quantity), 0),
        0
      ) AS unit_cost
    FROM input i
    LEFT JOIN document_lines dl ON dl.item_id = i.item_id
    LEFT JOIN inventory_transactions it
      ON it.document_line_id = dl.id
     AND it.movement = 1
     AND it.total_cost IS NOT NULL
    GROUP BY i.position, i.location_id
    ORDER BY i.position
  `);
  const byPosition = new Map(costs.map((row) => [Number(row.position), Number(row.unit_cost ?? 0)]));
  return rows.map((_, index) => byPosition.get(index) ?? 0);
}
