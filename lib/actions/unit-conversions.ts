"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { unitConversions, units, items } from "@/lib/db/schema";
import { getSession } from "@/lib/auth/session";
import { requirePermission } from "@/lib/auth/permissions";
import { companyInScope } from "@/lib/auth/scope";
import { guard, DUPLICATE, type ActionResult } from "@/lib/actions/guard";
import { recordAudit } from "@/lib/actions/audit";

export async function listUnitConversions() {
  const session = await getSession();
  requirePermission(session, "unit_conversions", "view");

  return db
    .select({
      id: unitConversions.id,
      multiplier: unitConversions.multiplier,
      itemId: unitConversions.itemId,
      itemName: items.name,
      itemSku: items.sku,
      fromUnitId: unitConversions.fromUnitId,
      fromUnitName: units.name,
    })
    .from(unitConversions)
    .leftJoin(items, eq(items.id, unitConversions.itemId))
    .leftJoin(units, eq(units.id, unitConversions.fromUnitId))
    .where(await companyInScope(unitConversions.companyId));
}

export async function getUnitConversion(id: string) {
  const session = await getSession();
  requirePermission(session, "unit_conversions", "view");
  const [row] = await db.select().from(unitConversions).where(eq(unitConversions.id, id)).limit(1);
  return row ?? null;
}

function readForm(formData: FormData) {
  return {
    companyId: String(formData.get("companyId") ?? "") || null,
    itemId: String(formData.get("itemId") ?? ""),
    fromUnitId: String(formData.get("fromUnitId") ?? ""),
    toUnitId: String(formData.get("toUnitId") ?? ""),
    multiplier: String(formData.get("multiplier") ?? ""),
  };
}

export async function createUnitConversion(_prevState: ActionResult | undefined, formData: FormData): Promise<ActionResult> {
  return guard(
    "Couldn't save the unit conversion.",
    async () => {
      const session = await getSession();
      requirePermission(session, "unit_conversions", "create");

      const values = readForm(formData);
      if (!values.itemId || !values.fromUnitId || !values.toUnitId) return { error: "Item and both units are required." };
      if (values.fromUnitId === values.toUnitId) return { error: "From and to units must be different." };
      const multiplier = Number(values.multiplier);
      if (!Number.isFinite(multiplier) || multiplier <= 0) return { error: "Multiplier must be a positive number." };

      await db.insert(unitConversions).values({ ...values, multiplier: values.multiplier });

      revalidatePath("/inventory/unit-conversions");
      await recordAudit({ action: "create", entity: "unit conversion", summary: `${values.multiplier}x`, companyId: values.companyId });
      return { success: true };
    },
    { [DUPLICATE]: "A conversion for this item/from-unit/to-unit combination already exists." },
  );
}

export interface UnitConversionBatchRow {
  companyId: string | null;
  itemId: string;
  fromUnitId: string;
  toUnitId: string;
  multiplier: string;
}

export async function createUnitConversionsBatch(rows: UnitConversionBatchRow[]): Promise<ActionResult> {
  return guard(
    "Couldn't save the unit conversions.",
    async () => {
      const session = await getSession();
      requirePermission(session, "unit_conversions", "create");

      const valid = rows.filter((r) => r.itemId && r.fromUnitId && r.toUnitId && r.fromUnitId !== r.toUnitId && Number(r.multiplier) > 0);
      if (valid.length === 0) {
        return { error: "Add at least one row with an item, two different units, and a positive multiplier." };
      }

      await db.insert(unitConversions).values(valid);

      revalidatePath("/inventory/unit-conversions");
      return { success: true };
    },
    { [DUPLICATE]: "Can't create — a conversion for one of these item/from/to combinations already exists." },
  );
}

export async function updateUnitConversion(id: string, _prevState: ActionResult | undefined, formData: FormData): Promise<ActionResult> {
  return guard(
    "Couldn't save the unit conversion.",
    async () => {
      const session = await getSession();
      requirePermission(session, "unit_conversions", "edit");

      const values = readForm(formData);
      if (!values.itemId || !values.fromUnitId || !values.toUnitId) return { error: "Item and both units are required." };
      if (values.fromUnitId === values.toUnitId) return { error: "From and to units must be different." };
      const multiplier = Number(values.multiplier);
      if (!Number.isFinite(multiplier) || multiplier <= 0) return { error: "Multiplier must be a positive number." };

      await db.update(unitConversions).set({ ...values, multiplier: values.multiplier }).where(eq(unitConversions.id, id));

      revalidatePath("/inventory/unit-conversions");
      await recordAudit({ action: "update", entity: "unit conversion", entityId: id, summary: `${values.multiplier}x`, companyId: values.companyId });
      return { success: true };
    },
    { [DUPLICATE]: "A conversion for this item/from-unit/to-unit combination already exists." },
  );
}

export async function deleteUnitConversion(_prevState: ActionResult | undefined, formData: FormData): Promise<ActionResult> {
  return guard("Couldn't delete this conversion.", async () => {
    const session = await getSession();
    requirePermission(session, "unit_conversions", "delete");

    const id = String(formData.get("id") ?? "");
    await db.delete(unitConversions).where(eq(unitConversions.id, id));

    revalidatePath("/inventory/unit-conversions");
    await recordAudit({ action: "delete", entity: "unit conversion", entityId: id, summary: id });
    return { success: true };
  });
}
