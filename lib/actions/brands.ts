"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { brands } from "@/lib/db/schema";
import { getLiveSession, getSession } from "@/lib/auth/session";
import { requirePermission } from "@/lib/auth/permissions";
import { CACHE, invalidateLookups } from "@/lib/queries/lookups";
import { guard, type ActionResult, type CreateResult } from "@/lib/actions/guard";
import { recordAudit } from "@/lib/actions/audit";

export async function listBrands() {
  const session = await getSession();
  requirePermission(session, "brands", "view");
  return db.select().from(brands);
}

function readBrandForm(formData: FormData) {
  return {
    name: String(formData.get("name") ?? "").trim(),
  };
}

export interface BrandBatchRow {
  name: string;
}

export async function createBrandsBatch(rows: BrandBatchRow[]): Promise<CreateResult<{ id: string; name: string }>> {
  return guard("Couldn't save the brands.", async () => {
    const session = await getLiveSession();
    requirePermission(session, "brands", "create");

    const valid = rows.filter((r) => r.name.trim());
    if (valid.length === 0) return { error: "Add at least one brand with a name." };

    const created = await db.insert(brands).values(valid).returning({ id: brands.id, name: brands.name });
    invalidateLookups(CACHE.brands);
    revalidatePath("/inventory/brands");
    await recordAudit({ action: "create", entity: "brand", summary: valid.map((r) => r.name).join(", ") });
    return { created };
  });
}

export async function updateBrand(brandId: string, _prevState: ActionResult | undefined, formData: FormData): Promise<ActionResult> {
  return guard("Couldn't save the brand.", async () => {
    const session = await getLiveSession();
    requirePermission(session, "brands", "edit");

    const values = readBrandForm(formData);
    if (!values.name) return { error: "Name is required." };

    await db.update(brands).set(values).where(eq(brands.id, brandId));
    invalidateLookups(CACHE.brands);
    revalidatePath("/inventory/brands");
    await recordAudit({ action: "update", entity: "brand", entityId: brandId, summary: values.name });
    return { success: true };
  });
}

export async function deleteBrand(_prevState: ActionResult | undefined, formData: FormData): Promise<ActionResult> {
  return guard("Can't delete — this brand is still referenced by items.", async () => {
    const session = await getLiveSession();
    requirePermission(session, "brands", "delete");

    const brandId = String(formData.get("brandId") ?? "");
    await db.delete(brands).where(eq(brands.id, brandId));

    invalidateLookups(CACHE.brands);
    revalidatePath("/inventory/brands");
    await recordAudit({ action: "delete", entity: "brand", entityId: brandId, summary: brandId });
    return { success: true };
  });
}
