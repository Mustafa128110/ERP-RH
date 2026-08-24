import "server-only";

import { sql } from "drizzle-orm";
import { db } from "@/lib/db";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export class MissingUnitConversionError extends Error {
  constructor() {
    super("One of the selected units has no conversion to the product's base unit.");
    this.name = "MissingUnitConversionError";
  }
}

export type QuantityToConvert = {
  itemId: string | null;
  unitId: string | null;
  quantity: number;
};

// What a line whose unit has no conversion to the item's base unit does to the
// document it is on.
//
// "throw" is the strict rule every stock-moving document started with: no
// multiplier, no save. "assume-base" lets the document through and counts the
// entered quantity as base units — which is what the statement below *already*
// does for the two other cases where the multiplier is unknown (the item has no
// base unit, or the line has no unit at all). A missing conversion is a setup gap
// on the products page, and it is not a reason to turn a customer away at the
// counter; the stock figure it leaves behind is put right by entering the
// conversion and re-saving the document.
export type MissingConversionPolicy = "throw" | "assume-base";

// Establish missing base units and convert an entire document in one database
// statement. `multiplier` means one from-unit equals N base units. The caller
// receives results in the same order as the submitted lines.
export async function resolveBaseQuantities(
  tx: Tx,
  lines: QuantityToConvert[],
  onMissing: MissingConversionPolicy = "throw",
): Promise<number[]> {
  if (lines.length === 0) return [];

  const values = sql.join(
    lines.map((line, index) => sql`(${index}::int, ${line.itemId}::uuid, ${line.unitId}::uuid, ${String(Math.abs(line.quantity))}::numeric)`),
    sql`, `,
  );

  const rows = await tx.execute<{ line_index: number; base_quantity: string | null; missing: boolean }>(sql`
    WITH input(line_index, item_id, unit_id, quantity) AS (
      VALUES ${values}
    ), chosen_base AS (
      SELECT DISTINCT ON (item_id) item_id, unit_id
      FROM input
      WHERE item_id IS NOT NULL AND unit_id IS NOT NULL
      ORDER BY item_id, line_index
    ), assigned AS (
      UPDATE items i
      SET base_unit_id = chosen_base.unit_id
      FROM chosen_base
      WHERE i.id = chosen_base.item_id AND i.base_unit_id IS NULL
      RETURNING i.id, i.base_unit_id
    ), resolved AS (
      SELECT input.line_index, input.quantity,
             coalesce(i.base_unit_id, assigned.base_unit_id, chosen_base.unit_id) AS base_unit_id,
             input.unit_id,
             uc.multiplier
      FROM input
      LEFT JOIN items i ON i.id = input.item_id
      LEFT JOIN chosen_base ON chosen_base.item_id = input.item_id
      LEFT JOIN assigned ON assigned.id = input.item_id
      LEFT JOIN unit_conversions uc
        ON uc.item_id = input.item_id
       AND uc.from_unit_id = input.unit_id
       AND uc.to_unit_id = coalesce(i.base_unit_id, assigned.base_unit_id, chosen_base.unit_id)
    )
    SELECT line_index,
           CASE
             WHEN unit_id IS NULL OR base_unit_id IS NULL OR unit_id = base_unit_id THEN quantity
             WHEN multiplier IS NOT NULL THEN quantity * multiplier
             ELSE NULL
           END AS base_quantity,
           unit_id IS NOT NULL AND base_unit_id IS NOT NULL
             AND unit_id <> base_unit_id AND multiplier IS NULL AS missing
    FROM resolved
    ORDER BY line_index
  `);

  // A short row set means the statement didn't answer for every line. That is a
  // fault, not a missing setting, and no policy makes it safe to guess past.
  if (rows.length !== lines.length) throw new MissingUnitConversionError();
  if (onMissing === "throw" && rows.some((row) => row.missing || row.base_quantity === null)) {
    throw new MissingUnitConversionError();
  }
  // `Math.abs`, matching the quantity handed to the statement above: the sign of a
  // movement is the caller's `stockMovement`, never the base quantity's.
  return rows.map((row, index) =>
    row.base_quantity === null ? Math.abs(lines[index].quantity) : Number(row.base_quantity),
  );
}

