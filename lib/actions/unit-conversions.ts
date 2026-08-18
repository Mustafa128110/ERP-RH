"use server";

import { and, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { unitConversions, units, items } from "@/lib/db/schema";
import { getLiveSession, getSession } from "@/lib/auth/session";
import { requirePermission } from "@/lib/auth/permissions";
import { companyInPermissionScope } from "@/lib/auth/scope";
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
    .where(await companyInPermissionScope(unitConversions.companyId, session, "unit_conversions"));
}

export async function getUnitConversion(id: string) {
  const session = await getSession();
  requirePermission(session, "unit_conversions", "view");
  const [row] = await db
    .select()
    .from(unitConversions)
    .where(and(eq(unitConversions.id, id), await companyInPermissionScope(unitConversions.companyId, session, "unit_conversions")))
    .limit(1);
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

async function itemsMatchCompanies(rows: { itemId: string; companyId: string | null }[]): Promise<boolean> {
  const ids = [...new Set(rows.map((row) => row.itemId))];
  const found = ids.length > 0
    ? await db.select({ id: items.id, companyId: items.companyId }).from(items).where(inArray(items.id, ids))
    : [];
  const companyById = new Map(found.map((item) => [item.id, item.companyId]));
  return rows.every((row) => row.companyId !== null && companyById.get(row.itemId) === row.companyId);
}

export async function createUnitConversion(_prevState: ActionResult | undefined, formData: FormData): Promise<ActionResult> {
  return guard(
    "Couldn't save the unit conversion.",
    async () => {
      const session = await getLiveSession();

      const values = readForm(formData);
      if (!values.companyId) return { error: "Company is required." };
      requirePermission(session, "unit_conversions", "create", { companyId: values.companyId });
      if (!values.itemId || !values.fromUnitId || !values.toUnitId) return { error: "Item and both units are required." };
      if (!(await itemsMatchCompanies([values]))) return { error: "The selected item doesn't belong to that company." };
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
      const session = await getLiveSession();

      const valid = rows.filter((r) => r.itemId && r.fromUnitId && r.toUnitId && r.fromUnitId !== r.toUnitId && Number(r.multiplier) > 0);
      if (valid.length === 0) {
        return { error: "Add at least one row with an item, two different units, and a positive multiplier." };
      }
      if (valid.some((row) => !row.companyId)) return { error: "Company is required on every conversion." };
      if (!(await itemsMatchCompanies(valid))) return { error: "One of the selected items doesn't belong to its conversion's company." };
      for (const companyId of new Set(valid.map((row) => row.companyId!))) {
        requirePermission(session, "unit_conversions", "create", { companyId });
      }

      await db.insert(unitConversions).values(valid);

      revalidatePath("/inventory/unit-conversions");
      await recordAudit({
        action: "create",
        entity: "unit conversion",
        summary: `${valid.length} conversion${valid.length === 1 ? "" : "s"} created`,
        companyId: new Set(valid.map((row) => row.companyId)).size === 1 ? valid[0].companyId : undefined,
      });
      return { success: true };
    },
    { [DUPLICATE]: "Can't create — a conversion for one of these item/from/to combinations already exists." },
  );
}

export async function updateUnitConversion(id: string, _prevState: ActionResult | undefined, formData: FormData): Promise<ActionResult> {
  return guard(
    "Couldn't save the unit conversion.",
    async () => {
      const session = await getLiveSession();

      const values = readForm(formData);
      if (!values.companyId) return { error: "Company is required." };
      requirePermission(session, "unit_conversions", "edit", { companyId: values.companyId });
      if (!values.itemId || !values.fromUnitId || !values.toUnitId) return { error: "Item and both units are required." };
      if (!(await itemsMatchCompanies([values]))) return { error: "The selected item doesn't belong to that company." };
      if (values.fromUnitId === values.toUnitId) return { error: "From and to units must be different." };
      const multiplier = Number(values.multiplier);
      if (!Number.isFinite(multiplier) || multiplier <= 0) return { error: "Multiplier must be a positive number." };

      const [existing] = await db
        .select({ companyId: unitConversions.companyId })
        .from(unitConversions)
        .where(and(eq(unitConversions.id, id), await companyInPermissionScope(unitConversions.companyId, session, "unit_conversions", "edit")))
        .limit(1);
      if (!existing) return { error: "Unit conversion not found." };
      if (existing.companyId !== values.companyId) return { error: "A unit conversion can't be moved to another company." };
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
    const session = await getLiveSession();
    requirePermission(session, "unit_conversions", "delete");

    const id = String(formData.get("id") ?? "");
    const [existing] = await db
      .select({ companyId: unitConversions.companyId })
      .from(unitConversions)
      .where(and(eq(unitConversions.id, id), await companyInPermissionScope(unitConversions.companyId, session, "unit_conversions", "delete")))
      .limit(1);
    if (!existing?.companyId) return { error: "Unit conversion not found." };
    requirePermission(session, "unit_conversions", "delete", { companyId: existing.companyId });
    await db.delete(unitConversions).where(eq(unitConversions.id, id));

    revalidatePath("/inventory/unit-conversions");
    await recordAudit({ action: "delete", entity: "unit conversion", entityId: id, summary: id });
    return { success: true };
  });
}
