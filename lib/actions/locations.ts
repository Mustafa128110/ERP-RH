"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { locations, locationTypeEnum } from "@/lib/db/schema";
import { getLiveSession, getSession } from "@/lib/auth/session";
import { requireGlobalPermission } from "@/lib/auth/permissions";
import { CACHE, invalidateLookups, invalidateReads, READ_DOMAIN } from "@/lib/queries/lookups";
import { guard, type ActionResult, type CreateResult } from "@/lib/actions/guard";
import { recordAudit } from "@/lib/actions/audit";

const locationTypes = locationTypeEnum.enumValues;

export async function listLocations() {
  const session = await getSession();
  requireGlobalPermission(session, "locations", "view");
  return db.select().from(locations);
}

function readLocationForm(formData: FormData) {
  return {
    name: String(formData.get("name") ?? "").trim(),
    code: String(formData.get("code") ?? "").trim() || null,
    locationType: String(formData.get("locationType") ?? "") as (typeof locationTypes)[number],
  };
}

export interface LocationBatchRow {
  name: string;
  code: string | null;
  locationType: (typeof locationTypes)[number];
}

export async function createLocationsBatch(rows: LocationBatchRow[]): Promise<CreateResult<{ id: string; name: string }>> {
  return guard("Couldn't save the locations.", async () => {
    const session = await getLiveSession();
    requireGlobalPermission(session, "locations", "create");

    const valid = rows.filter((r) => r.name.trim() && locationTypes.includes(r.locationType));
    if (valid.length === 0) return { error: "Add at least one location with a name and type." };

    const created = await db.insert(locations).values(valid).returning({ id: locations.id, name: locations.name });
    await invalidateLookups(CACHE.locations);
    // Stock on hand is reported per location, by name.
    await invalidateReads(READ_DOMAIN.stock);
    revalidatePath("/inventory/warehouses");
    await recordAudit({ action: "create", entity: "location", summary: valid.map((r) => r.name).join(", ") });
    return { created };
  });
}

export async function updateLocation(locationId: string, _prevState: ActionResult | undefined, formData: FormData): Promise<ActionResult> {
  return guard("Couldn't save the location.", async () => {
    const session = await getLiveSession();
    requireGlobalPermission(session, "locations", "edit");

    const values = readLocationForm(formData);
    if (!values.name) return { error: "Name is required." };
    if (!locationTypes.includes(values.locationType)) return { error: "Location type is required." };

    await db.update(locations).set(values).where(eq(locations.id, locationId));
    await invalidateLookups(CACHE.locations);
    // Stock on hand is reported per location, by name.
    await invalidateReads(READ_DOMAIN.stock);
    revalidatePath("/inventory/warehouses");
    await recordAudit({ action: "update", entity: "location", entityId: locationId, summary: values.name });
    return { success: true };
  });
}

export async function deleteLocation(_prevState: ActionResult | undefined, formData: FormData): Promise<ActionResult> {
  return guard("Can't delete — this location is still referenced by stock, transactions, or user access.", async () => {
    const session = await getLiveSession();
    requireGlobalPermission(session, "locations", "delete");

    const locationId = String(formData.get("locationId") ?? "");
    await db.delete(locations).where(eq(locations.id, locationId));

    await invalidateLookups(CACHE.locations);
    // Stock on hand is reported per location, by name.
    await invalidateReads(READ_DOMAIN.stock);
    revalidatePath("/inventory/warehouses");
    await recordAudit({ action: "delete", entity: "location", entityId: locationId, summary: locationId });
    return { success: true };
  });
}
