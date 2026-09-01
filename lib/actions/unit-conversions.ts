"use server";

import { and, eq, inArray, notInArray, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { itemUnitConversionRules, items, unitConversions, units } from "@/lib/db/schema";
import { getLiveSession, getSession } from "@/lib/auth/session";
import { requirePermission } from "@/lib/auth/permissions";
import { companyInPermissionScope } from "@/lib/auth/scope";
import { guard, type ActionResult } from "@/lib/actions/guard";
import { recordAudit } from "@/lib/actions/audit";
import { CACHE, invalidateLookups, invalidateReads, READ_DOMAIN } from "@/lib/queries/lookups";
import { rebuildItemBaseQuantities } from "@/lib/queries/unit-conversion";
import { expandUnitConversionOptions } from "@/lib/unit-conversion";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type RuleValues = { name: string; fromUnitId: string; toUnitId: string; multiplier: string };

function readForm(formData: FormData): RuleValues {
  return {
    name: String(formData.get("name") ?? "").trim(),
    fromUnitId: String(formData.get("fromUnitId") ?? ""),
    toUnitId: String(formData.get("toUnitId") ?? ""),
    multiplier: String(formData.get("multiplier") ?? ""),
  };
}

function valid(values: RuleValues): string | null {
  if (!values.name || !values.fromUnitId || !values.toUnitId) return "Rule name and both units are required.";
  if (values.name.length > 150) return "Rule name must be 150 characters or fewer.";
  if (values.fromUnitId === values.toUnitId) return "From and to units must be different.";
  const multiplier = Number(values.multiplier);
  return Number.isFinite(multiplier) && multiplier > 0 ? null : "Multiplier must be a positive number.";
}

async function scopedItems(session: NonNullable<Awaited<ReturnType<typeof getLiveSession>>>, itemIds: string[], action: "edit") {
  const ids = [...new Set(itemIds.filter(Boolean))];
  const rows = ids.length
    ? await db.select({ id: items.id, companyId: items.companyId }).from(items).where(and(inArray(items.id, ids), await companyInPermissionScope(items.companyId, session, "unit_conversions", action)))
    : [];
  if (rows.length !== ids.length) return null;
  for (const item of rows) requirePermission(session, "unit_conversions", action, { companyId: item.companyId });
  return rows;
}

async function scopedRule(id: string, action: "view" | "create" | "edit" | "delete") {
  const session = action === "view" ? await getSession() : await getLiveSession();
  requirePermission(session, "unit_conversions", action);
  const [rule] = await db
    .select({ id: unitConversions.id, companyId: unitConversions.companyId, name: unitConversions.name })
    .from(unitConversions)
    .where(and(eq(unitConversions.id, id), await companyInPermissionScope(unitConversions.companyId, session, "unit_conversions", action)))
    .limit(1);
  return { session, rule };
}

// Multiple rules may form a chain, but every path must agree.  A contradiction
// would make both stock and unit-price conversion ambiguous, so reject it while
// the assignment/update transaction can still roll back safely.
async function assertConsistentRuleGraphs(tx: Tx, itemIds: string[]) {
  const ids = [...new Set(itemIds.filter(Boolean))];
  if (ids.length === 0) return;
  const [assignments, rules] = await Promise.all([
    tx
      .select({ ruleId: unitConversions.id, itemId: itemUnitConversionRules.itemId, fromUnitId: unitConversions.fromUnitId, toUnitId: unitConversions.toUnitId, multiplier: unitConversions.multiplier })
      .from(itemUnitConversionRules)
      .innerJoin(unitConversions, eq(unitConversions.id, itemUnitConversionRules.ruleId))
      .where(inArray(itemUnitConversionRules.itemId, ids)),
    tx.select({ ruleId: unitConversions.id, fromUnitId: unitConversions.fromUnitId, toUnitId: unitConversions.toUnitId, multiplier: unitConversions.multiplier }).from(unitConversions),
  ]);
  const rows = expandUnitConversionOptions(assignments, rules);
  const byItem = new Map<string, typeof rows>();
  for (const row of rows) byItem.set(row.itemId, [...(byItem.get(row.itemId) ?? []), row]);
  for (const [itemId, rules] of byItem) {
    const graph = new Map<string, { to: string; factor: number }[]>();
    for (const rule of rules) {
      const factor = Number(rule.multiplier);
      graph.set(rule.fromUnitId, [...(graph.get(rule.fromUnitId) ?? []), { to: rule.toUnitId, factor }]);
      graph.set(rule.toUnitId, [...(graph.get(rule.toUnitId) ?? []), { to: rule.fromUnitId, factor: 1 / factor }]);
    }
    const known = new Map<string, number>();
    for (const first of graph.keys()) {
      if (known.has(first)) continue;
      known.set(first, 1);
      const queue = [first];
      for (let cursor = 0; cursor < queue.length; cursor++) {
        const from = queue[cursor];
        const fromFactor = known.get(from)!;
        for (const edge of graph.get(from) ?? []) {
          const next = fromFactor * edge.factor;
          const seen = known.get(edge.to);
          if (seen === undefined) { known.set(edge.to, next); queue.push(edge.to); }
          else if (Math.abs(seen - next) > Math.max(1, Math.abs(seen), Math.abs(next)) * 0.000001) {
            throw new Error(`The selected rules conflict for a product (${itemId}).`);
          }
        }
      }
    }
  }
}

// A rule can affect products without being assigned to them directly. For
// example, changing the shared dozen-to-piece rule changes every product whose
// assigned packing hierarchy reaches Dozen. Capture those products before a
// rule is edited/deleted so their persisted base quantities are rebuilt too.
async function effectiveRuleItemIds(tx: Tx, ruleId: string) {
  const [assignments, rules] = await Promise.all([
    tx
      .select({ ruleId: unitConversions.id, itemId: itemUnitConversionRules.itemId, fromUnitId: unitConversions.fromUnitId, toUnitId: unitConversions.toUnitId, multiplier: unitConversions.multiplier })
      .from(itemUnitConversionRules)
      .innerJoin(unitConversions, eq(unitConversions.id, itemUnitConversionRules.ruleId)),
    tx.select({ ruleId: unitConversions.id, fromUnitId: unitConversions.fromUnitId, toUnitId: unitConversions.toUnitId, multiplier: unitConversions.multiplier }).from(unitConversions),
  ]);
  return [...new Set(expandUnitConversionOptions(assignments, rules).filter((row) => row.ruleId === ruleId).map((row) => row.itemId))];
}

async function ruleItemIds(tx: Tx, ruleId: string) {
  const rows = await tx.select({ itemId: itemUnitConversionRules.itemId }).from(itemUnitConversionRules).where(eq(itemUnitConversionRules.ruleId, ruleId));
  return rows.map((row) => row.itemId);
}

async function invalidateUnitRuleViews() {
  await invalidateLookups(CACHE.items);
  await invalidateReads(READ_DOMAIN.products, READ_DOMAIN.sales, READ_DOMAIN.purchases, READ_DOMAIN.stock);
  revalidatePath("/inventory/unit-conversions");
  revalidatePath("/inventory/products");
  revalidatePath("/inventory/stock");
  revalidatePath("/sales");
  revalidatePath("/purchases");
}

export async function listUnitConversions() {
  const session = await getSession();
  requirePermission(session, "unit_conversions", "view");
  return db.select({ id: unitConversions.id, name: unitConversions.name, multiplier: unitConversions.multiplier, fromUnitId: unitConversions.fromUnitId, fromUnitName: units.name, toUnitId: unitConversions.toUnitId, assignedCount: sql<number>`count(${itemUnitConversionRules.itemId})::int` })
    .from(unitConversions)
    .leftJoin(units, eq(units.id, unitConversions.fromUnitId))
    .leftJoin(itemUnitConversionRules, eq(itemUnitConversionRules.ruleId, unitConversions.id))
    .where(await companyInPermissionScope(unitConversions.companyId, session, "unit_conversions"))
    .groupBy(unitConversions.id, units.name);
}

export async function getUnitConversion(id: string) {
  const { rule } = await scopedRule(id, "view");
  if (!rule) return null;
  const [detail] = await db.select().from(unitConversions).where(eq(unitConversions.id, id)).limit(1);
  const assigned = await db.select({ itemId: itemUnitConversionRules.itemId }).from(itemUnitConversionRules).where(eq(itemUnitConversionRules.ruleId, id));
  return { ...detail, itemIds: assigned.map((row) => row.itemId) };
}

export async function createUnitConversion(_prevState: ActionResult | undefined, formData: FormData): Promise<ActionResult> {
  return guard("Couldn't save the unit rule.", async () => {
    const session = await getLiveSession();
    requirePermission(session, "unit_conversions", "create");
    const values = readForm(formData);
    const error = valid(values);
    if (error) return { error };
    let createdId = "";
    await db.transaction(async (tx) => {
      const [created] = await tx.insert(unitConversions).values(values).returning({ id: unitConversions.id });
      createdId = created.id;
      const affected = await effectiveRuleItemIds(tx, created.id);
      await assertConsistentRuleGraphs(tx, affected);
      await rebuildItemBaseQuantities(tx, affected);
    });
    await invalidateUnitRuleViews();
    await recordAudit({ action: "create", entity: "unit rule", entityId: createdId, summary: values.name });
    return { success: true };
  });
}

export async function updateUnitConversion(id: string, _prevState: ActionResult | undefined, formData: FormData): Promise<ActionResult> {
  return guard("Couldn't save the unit rule.", async () => {
    const { rule } = await scopedRule(id, "edit");
    if (!rule) return { error: "Unit rule not found." };
    const values = readForm(formData);
    const error = valid(values);
    if (error) return { error };
    await db.transaction(async (tx) => {
      const before = await effectiveRuleItemIds(tx, id);
      await tx.update(unitConversions).set({ ...values, updatedAt: new Date() }).where(eq(unitConversions.id, id));
      const affected = [...new Set([...before, ...(await effectiveRuleItemIds(tx, id))])];
      await assertConsistentRuleGraphs(tx, affected);
      await rebuildItemBaseQuantities(tx, affected);
    });
    await invalidateUnitRuleViews();
    await recordAudit({ action: "update", entity: "unit rule", entityId: id, summary: values.name });
    return { success: true };
  });
}

export async function setUnitConversionRuleItems(ruleId: string, itemIds: string[]): Promise<ActionResult> {
  return guard("Couldn't update the products using this unit rule.", async () => {
    const { session, rule } = await scopedRule(ruleId, "edit");
    if (!rule) return { error: "Unit rule not found." };
    const selected = [...new Set(itemIds.filter(Boolean))];
    if (!(await scopedItems(session as NonNullable<Awaited<ReturnType<typeof getLiveSession>>>, selected, "edit"))) return { error: "One or more selected products were not found." };
    let affected: string[] = [];
    await db.transaction(async (tx) => {
      const existing = await ruleItemIds(tx, ruleId);
      affected = [...new Set([...existing, ...selected])];
      if (selected.length > 0) {
        await tx.insert(itemUnitConversionRules).values(selected.map((itemId) => ({ itemId, ruleId }))).onConflictDoNothing();
        await tx.delete(itemUnitConversionRules).where(and(eq(itemUnitConversionRules.ruleId, ruleId), notInArray(itemUnitConversionRules.itemId, selected)));
      } else await tx.delete(itemUnitConversionRules).where(eq(itemUnitConversionRules.ruleId, ruleId));
      await assertConsistentRuleGraphs(tx, affected);
      await rebuildItemBaseQuantities(tx, affected);
    });
    await invalidateUnitRuleViews();
    await recordAudit({ action: "update", entity: "unit rule assignments", entityId: ruleId, summary: rule.name, detail: `${selected.length} product(s) assigned` });
    return { success: true };
  });
}

// Products-page assignment is additive: it attaches the chosen rule to the
// ticked products without removing that rule from products that already use it.
export async function assignUnitConversionRuleToItems(ruleId: string, itemIds: string[]): Promise<ActionResult> {
  return guard("Couldn't assign the unit rule.", async () => {
    const { session, rule } = await scopedRule(ruleId, "edit");
    if (!rule) return { error: "Unit rule not found." };
    const selected = [...new Set(itemIds.filter(Boolean))];
    if (selected.length === 0) return { error: "Select at least one product." };
    const products = await scopedItems(session as NonNullable<Awaited<ReturnType<typeof getLiveSession>>>, selected, "edit");
    if (!products) {
      return { error: "One or more selected products were not found." };
    }
    if (rule.companyId && products.some((product) => product.companyId !== rule.companyId)) {
      return { error: "This company-specific rule can only be assigned to products from the same company." };
    }

    await db.transaction(async (tx) => {
      await tx
        .insert(itemUnitConversionRules)
        .values(selected.map((itemId) => ({ itemId, ruleId })))
        .onConflictDoNothing();
      await assertConsistentRuleGraphs(tx, selected);
      await rebuildItemBaseQuantities(tx, selected);
    });
    await invalidateUnitRuleViews();
    await recordAudit({
      action: "update",
      entity: "unit rule assignments",
      entityId: ruleId,
      summary: rule.name,
      detail: `${selected.length} product(s) assigned from Products`,
    });
    return { success: true };
  });
}

export async function deleteUnitConversion(_prevState: ActionResult | undefined, formData: FormData): Promise<ActionResult> {
  return guard("Couldn't delete this unit rule.", async () => {
    const id = String(formData.get("id") ?? "");
    const { rule } = await scopedRule(id, "delete");
    if (!rule) return { error: "Unit rule not found." };
    let affected: string[] = [];
    await db.transaction(async (tx) => {
      affected = await effectiveRuleItemIds(tx, id);
      await tx.delete(unitConversions).where(eq(unitConversions.id, id));
      await rebuildItemBaseQuantities(tx, affected);
    });
    await invalidateUnitRuleViews();
    await recordAudit({ action: "delete", entity: "unit rule", entityId: id, summary: rule.name, detail: `${affected.length} product assignment(s) removed` });
    return { success: true };
  });
}
