"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { units } from "@/lib/db/schema";
import { getSession } from "@/lib/auth/session";
import { requirePermission } from "@/lib/auth/permissions";
import { CACHE, invalidateLookups } from "@/lib/queries/lookups";
import { guard, type ActionResult, type CreateResult } from "@/lib/actions/guard";
import { recordAudit } from "@/lib/actions/audit";

export async function listUnits() {
  const session = await getSession();
  requirePermission(session, "units", "view");
  return db.select().from(units);
}

export async function getUnit(unitId: string) {
  const session = await getSession();
  requirePermission(session, "units", "view");
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
    const session = await getSession();
    requirePermission(session, "units", "create");

    const valid = rows.filter((r) => r.name.trim());
    if (valid.length === 0) return { error: "Add at least one unit with a name." };

    const created = await db
      .insert(units)
      .values(valid.map((r) => ({ name: r.name.trim(), symbol: r.symbol.trim() || null })))
      .returning({ id: units.id, name: units.name, symbol: units.symbol });
    invalidateLookups(CACHE.units);
    revalidatePath("/inventory/units");
    await recordAudit({ action: "create", entity: "unit", summary: valid.map((r) => r.name).join(", ") });
    return { created };
  });
}

export async function updateUnit(unitId: string, _prevState: ActionResult | undefined, formData: FormData): Promise<ActionResult> {
  return guard("Couldn't save the unit.", async () => {
    const session = await getSession();
    requirePermission(session, "units", "edit");

    const values = readUnitForm(formData);
    if (!values.name) return { error: "Name is required." };

    await db.update(units).set(values).where(eq(units.id, unitId));
    invalidateLookups(CACHE.units);
    revalidatePath("/inventory/units");
    await recordAudit({ action: "update", entity: "unit", entityId: unitId, summary: values.name });
    return { success: true };
  });
}

export async function deleteUnit(_prevState: ActionResult | undefined, formData: FormData): Promise<ActionResult> {
  return guard("Can't delete — this unit is still referenced by items or unit conversions.", async () => {
    const session = await getSession();
    requirePermission(session, "units", "delete");

    const unitId = String(formData.get("unitId") ?? "");
    await db.delete(units).where(eq(units.id, unitId));

    invalidateLookups(CACHE.units);
    revalidatePath("/inventory/units");
    await recordAudit({ action: "delete", entity: "unit", entityId: unitId, summary: unitId });
    return { success: true };
  });
}
