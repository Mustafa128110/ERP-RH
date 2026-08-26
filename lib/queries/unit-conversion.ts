import "server-only";

import { inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { documentLines, itemUnitConversionRules, items, unitConversions } from "@/lib/db/schema";
import { multiplierToBase, type UnitConversionOption } from "@/lib/unit-conversion";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export class MissingUnitConversionError extends Error {
  constructor() {
    super("One of the selected units has no rule connecting it to the product's base stock unit.");
    this.name = "MissingUnitConversionError";
  }
}

export type QuantityToConvert = {
  itemId: string | null;
  unitId: string | null;
  quantity: number;
};

// A missing conversion is a setup gap, not a reason to stop a customer at the
// counter. Sales opt into "assume-base" and retain the entered quantity until a
// base unit/rule is configured and the product's stock is rebuilt. Other stock
// documents keep the stricter policy where a known base unit is disconnected.
export type MissingConversionPolicy = "throw" | "assume-base";

// Resolves a whole document from one snapshot of product bases and that
// product's rule graph. No unit is assigned as a side effect: base_unit_id is a
// deliberate product setting, never an accidental consequence of the first
// sale or purchase that happened to mention a unit.
export async function resolveBaseQuantities(
  tx: Tx,
  lines: QuantityToConvert[],
  onMissing: MissingConversionPolicy = "throw",
): Promise<number[]> {
  if (lines.length === 0) return [];

  const itemIds = [...new Set(lines.map((line) => line.itemId).filter((id): id is string => Boolean(id)))];
  if (itemIds.length === 0) return lines.map((line) => Math.abs(line.quantity));

  const [itemRows, rules] = await Promise.all([
    tx.select({ id: items.id, baseUnitId: items.baseUnitId }).from(items).where(inArray(items.id, itemIds)),
    tx
      .select({ itemId: itemUnitConversionRules.itemId, fromUnitId: unitConversions.fromUnitId, toUnitId: unitConversions.toUnitId, multiplier: unitConversions.multiplier })
      .from(itemUnitConversionRules)
      .innerJoin(unitConversions, sql`${unitConversions.id} = ${itemUnitConversionRules.ruleId}`)
      .where(inArray(itemUnitConversionRules.itemId, itemIds)),
  ]);
  const baseByItem = new Map(itemRows.map((item) => [item.id, item.baseUnitId]));
  const conversions: UnitConversionOption[] = rules.map((rule) => ({
    itemId: rule.itemId,
    fromUnitId: rule.fromUnitId,
    toUnitId: rule.toUnitId,
    multiplier: rule.multiplier,
  }));

  const quantities = lines.map((line) => {
    if (!line.itemId || !line.unitId) return Math.abs(line.quantity);
    const multiplier = multiplierToBase(line.itemId, line.unitId, baseByItem.get(line.itemId), conversions);
    return multiplier === null ? null : Math.abs(line.quantity) * multiplier;
  });
  if (onMissing === "throw" && quantities.some((quantity) => quantity === null)) {
    throw new MissingUnitConversionError();
  }
  return quantities.map((quantity, index) => quantity ?? Math.abs(lines[index].quantity));
}

// Rebuilds persisted stock quantities after a product's base unit or one of its
// rules changes. The original entered quantity/unit stays on document_lines;
// only its derived base_quantity changes, and transaction unit cost is kept
// consistent with the already-recorded total cost. Both updates are set-based.
export async function rebuildItemBaseQuantities(tx: Tx, itemIds: string[]): Promise<void> {
  const distinctIds = [...new Set(itemIds.filter(Boolean))];
  if (distinctIds.length === 0) return;
  const lines = await tx
    .select({ id: documentLines.id, itemId: documentLines.itemId, unitId: documentLines.unitId, quantity: documentLines.quantity })
    .from(documentLines)
    .where(inArray(documentLines.itemId, distinctIds));
  if (lines.length === 0) return;

  const quantities = await resolveBaseQuantities(
    tx,
    lines.map((line) => ({ itemId: line.itemId, unitId: line.unitId, quantity: Number(line.quantity) })),
    "assume-base",
  );
  const values = sql.join(lines.map((line, index) => sql`(${line.id}::uuid, ${String(quantities[index])}::numeric)`), sql`, `);
  await tx.execute(sql`
    UPDATE document_lines dl
    SET base_quantity = v.base_quantity
    FROM (VALUES ${values}) AS v(id, base_quantity)
    WHERE dl.id = v.id
  `);
  await tx.execute(sql`
    UPDATE inventory_transactions it
    SET base_quantity = dl.base_quantity,
        unit_cost = CASE
          WHEN dl.base_quantity <> 0 THEN it.total_cost / dl.base_quantity
          ELSE it.unit_cost
        END
    FROM document_lines dl
    WHERE it.document_line_id = dl.id
      AND dl.item_id IN (${sql.join(distinctIds.map((id) => sql`${id}::uuid`), sql`, `)})
  `);
}
