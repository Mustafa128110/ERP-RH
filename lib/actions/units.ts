"use server";

import { and, eq, inArray, or } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { documentLines, items, marketPurchaseRequests, unitConversions, units } from "@/lib/db/schema";
import { getLiveSession, getSession } from "@/lib/auth/session";
import { requireGlobalPermission } from "@/lib/auth/permissions";
import { CACHE, invalidateLookups, invalidateReads, READ_DOMAIN } from "@/lib/queries/lookups";
import { guard, type ActionResult, type CreateResult } from "@/lib/actions/guard";
import { recordAudit } from "@/lib/actions/audit";
import { directUnitMergeError } from "@/lib/unit-merge";

// A unit symbol is printed on every sale line, purchase line and stock row, and
// on-hand is totalled per unit — so renaming "Bag" is visible on three screens.
const READS = [READ_DOMAIN.sales, READ_DOMAIN.purchases, READ_DOMAIN.products, READ_DOMAIN.stock] as const;

export async function listUnits() {
  const session = await getSession();
  requireGlobalPermission(session, "units", "view");
  return db.select().from(units);
}

export async function getUnit(unitId: string) {
  const session = await getSession();
  requireGlobalPermission(session, "units", "view");
  const [row] = await db.select().from(units).where(eq(units.id, unitId)).limit(1);
  return row ?? null;
}

function readUnitForm(formData: FormData) {
  return {
    name: String(formData.get("name") ?? "").trim(),
    symbol: String(formData.get("symbol") ?? "").trim() || null,
  };
}

export interface UnitBatchRow {
  name: string;
  symbol: string;
}

// Returns what it created so a quick-add from a document line can select the
// new unit immediately.
export async function createUnitsBatch(rows: UnitBatchRow[]): Promise<CreateResult<{ id: string; name: string; symbol: string | null }>> {
  return guard("Couldn't save the units.", async () => {
    const session = await getLiveSession();
    requireGlobalPermission(session, "units", "create");

    const valid = rows.filter((r) => r.name.trim());
    if (valid.length === 0) return { error: "Add at least one unit with a name." };

    const created = await db
      .insert(units)
      .values(valid.map((r) => ({ name: r.name.trim(), symbol: r.symbol.trim() || null })))
      .returning({ id: units.id, name: units.name, symbol: units.symbol });
    await invalidateLookups(CACHE.units);
    await invalidateReads(...READS);
    revalidatePath("/inventory/units");
    await recordAudit({ action: "create", entity: "unit", summary: valid.map((r) => r.name).join(", ") });
    return { created };
  });
}

export async function updateUnit(unitId: string, _prevState: ActionResult | undefined, formData: FormData): Promise<ActionResult> {
  return guard("Couldn't save the unit.", async () => {
    const session = await getLiveSession();
    requireGlobalPermission(session, "units", "edit");

    const values = readUnitForm(formData);
    if (!values.name) return { error: "Name is required." };

    await db.update(units).set(values).where(eq(units.id, unitId));
    await invalidateLookups(CACHE.units);
    await invalidateReads(...READS);
    revalidatePath("/inventory/units");
    await recordAudit({ action: "update", entity: "unit", entityId: unitId, summary: values.name });
    return { success: true };
  });
}

export async function deleteUnit(_prevState: ActionResult | undefined, formData: FormData): Promise<ActionResult> {
  return guard("Can't delete — this unit is still referenced by items or unit conversions.", async () => {
    const session = await getLiveSession();
    requireGlobalPermission(session, "units", "delete");

    const unitId = String(formData.get("unitId") ?? "");
    await db.delete(units).where(eq(units.id, unitId));

    await invalidateLookups(CACHE.units);
    await invalidateReads(...READS);
    revalidatePath("/inventory/units");
    await recordAudit({ action: "delete", entity: "unit", entityId: unitId, summary: unitId });
    return { success: true };
  });
}

// Merge a duplicate unit into the chosen survivor. Historical document lines
// keep their quantities and prices; only their unit reference moves. Stored
// base_quantity and inventory cost remain untouched, so the stock ledger does
// not change merely because two labels were consolidated.
export async function mergeUnits(_prevState: ActionResult | undefined, formData: FormData): Promise<ActionResult> {
  return guard("Couldn't merge the units.", async () => {
    const session = await getLiveSession();
    requireGlobalPermission(session, "units", "edit");
    requireGlobalPermission(session, "units", "delete");

    const sourceUnitId = String(formData.get("sourceUnitId") ?? "");
    const targetUnitId = String(formData.get("targetUnitId") ?? "");
    if (!sourceUnitId || !targetUnitId) return { error: "Select the unit to delete and the unit that should survive." };
    if (sourceUnitId === targetUnitId) return { error: "The deleted unit and surviving unit must be different." };

    const directRuleWhere = or(
      and(eq(unitConversions.fromUnitId, sourceUnitId), eq(unitConversions.toUnitId, targetUnitId)),
      and(eq(unitConversions.fromUnitId, targetUnitId), eq(unitConversions.toUnitId, sourceUnitId)),
    )!;
    const [selected, directRuleRows] = await Promise.all([
      db
        .select({ id: units.id, name: units.name })
        .from(units)
        .where(inArray(units.id, [sourceUnitId, targetUnitId])),
      db.select({ multiplier: unitConversions.multiplier }).from(unitConversions).where(directRuleWhere),
    ]);
    if (selected.length !== 2) return { error: "One of the selected units no longer exists." };
    const directRuleError = directUnitMergeError(directRuleRows);
    if (directRuleError) return { error: directRuleError };
    const source = selected.find((unit) => unit.id === sourceUnitId)!;
    const target = selected.find((unit) => unit.id === targetUnitId)!;

    let removedDirectRules = 0;
    await db.transaction(async (tx) => {
      // A direct source↔target conversion becomes an invalid self-conversion
      // after the merge. Delete it first; its product assignments cascade.
      const directRules = await tx
        .delete(unitConversions)
        .where(directRuleWhere)
        .returning({ id: unitConversions.id });
      removedDirectRules = directRules.length;

      await tx.update(unitConversions).set({ fromUnitId: targetUnitId, updatedAt: new Date() }).where(eq(unitConversions.fromUnitId, sourceUnitId));
      await tx.update(unitConversions).set({ toUnitId: targetUnitId, updatedAt: new Date() }).where(eq(unitConversions.toUnitId, sourceUnitId));
      await tx.update(items).set({ baseUnitId: targetUnitId }).where(eq(items.baseUnitId, sourceUnitId));
      await tx.update(documentLines).set({ unitId: targetUnitId }).where(eq(documentLines.unitId, sourceUnitId));
      await tx.update(marketPurchaseRequests).set({ unitId: targetUnitId }).where(eq(marketPurchaseRequests.unitId, sourceUnitId));
      await tx.delete(units).where(eq(units.id, sourceUnitId));
    });

    await invalidateLookups(CACHE.units, CACHE.items);
    await invalidateReads(...READS);
    revalidatePath("/inventory/units");
    revalidatePath("/inventory/unit-conversions");
    revalidatePath("/inventory/products");
    revalidatePath("/inventory/stock");
    revalidatePath("/sales");
    revalidatePath("/purchases");
    await recordAudit({
      action: "merge",
      entity: "unit",
      entityId: targetUnitId,
      summary: `${source.name} → ${target.name}`,
      detail: `Historical references transferred; ${removedDirectRules} direct conversion rule(s) removed`,
    });
    return { success: true };
  });
}
