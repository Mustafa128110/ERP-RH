"use server";

import { and, eq, inArray, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { companies, settings, taxes } from "@/lib/db/schema";
import { getLiveSession, getSession } from "@/lib/auth/session";
import { requirePermission } from "@/lib/auth/permissions";
import { getScopeCompanyIds } from "@/lib/auth/scope";
import { guard, type ActionResult } from "@/lib/actions/guard";
import { recordAudit } from "@/lib/actions/audit";
import { SETTING_DEFS } from "@/lib/setting-constants";
import { CACHE, invalidateLookups } from "@/lib/queries/lookups";

// The settings table has existed since the first migration and nothing had ever
// read or written it — the Settings page was a hard-coded list of numbers
// presented as configuration. These are the ones the app actually consults.
//
// Definitions live here rather than in the page, so a setting is one entry and
// the form renders itself from the list.

const BY_KEY = new Map(SETTING_DEFS.map((d) => [d.key, d]));

// Settings are per company, so the whole page is per company. Values missing
// from the table fall back to the definition above rather than to empty — a
// blank threshold would mean "everything is dead stock".
export async function getSettings(companyId: string): Promise<Record<string, string>> {
  const session = await getSession();
  requirePermission(session, "settings", "view", { companyId });

  const rows = await db
    .select({ key: settings.key, value: settings.value })
    .from(settings)
    .where(and(eq(settings.companyId, companyId), inArray(settings.key, SETTING_DEFS.map((d) => d.key))));

  const stored = new Map(rows.map((r) => [r.key, r.value ?? ""]));
  return Object.fromEntries(SETTING_DEFS.map((d) => [d.key, stored.get(d.key) ?? d.fallback]));
}

export async function saveSettings(companyId: string, _prevState: ActionResult | undefined, formData: FormData): Promise<ActionResult> {
  return guard("Couldn't save the settings.", async () => {
    const session = await getLiveSession();
    requirePermission(session, "settings", "edit", { companyId });

    const accessible = await getScopeCompanyIds();
    if (!accessible.includes(companyId)) return { error: "You don't have access to that company." };

    const values: { companyId: string; key: string; value: string }[] = [];
    for (const def of SETTING_DEFS) {
      const raw = def.kind === "boolean" ? (formData.get(def.key) === "on" ? "true" : "false") : String(formData.get(def.key) ?? "").trim();
      if (def.kind === "number" && raw !== "" && !(Number(raw) >= 0)) {
        return { error: `${def.label} has to be a number of ${def.suffix ?? "units"}, zero or more.` };
      }
      values.push({ companyId, key: def.key, value: raw });
    }

    const taxIds = values.filter((value) => BY_KEY.get(value.key)?.kind === "tax" && value.value).map((value) => value.value);
    if (taxIds.length > 0) {
      const found = await db.select({ id: taxes.id }).from(taxes).where(and(inArray(taxes.id, taxIds), eq(taxes.isActive, true)));
      if (found.length !== new Set(taxIds).size) return { error: "One of the selected default taxes is no longer active." };
    }

    // One upsert for the lot rather than one per key: settings is UNIQUE
    // (company_id, key), so ON CONFLICT DO UPDATE is both the insert and the
    // edit, in a single round trip.
    await db
      .insert(settings)
      .values(values)
      .onConflictDoUpdate({ target: [settings.companyId, settings.key], set: { value: sql`excluded.value` } });

    invalidateLookups(CACHE.settings);
    revalidatePath("/settings");
    await recordAudit({ action: "update", entity: "settings", summary: "Company settings changed", companyId });
    return { success: true };
  });
}

// What the page shows above the form: the companies it can be set for, and
// whether the outside connections this app has are actually connected.
export async function settingsOverview() {
  const session = await getSession();
  requirePermission(session, "settings", "view");

  const ids = (await getScopeCompanyIds()).filter(
    (companyId) => session.globalPermissions.has("settings.view") || session.permissionsByCompany.get(companyId)?.has("settings.view"),
  );
  const companyRows = ids.length
    ? await db.select({ id: companies.id, name: companies.name, taxNumber: companies.taxNumber, phone: companies.phone }).from(companies).where(inArray(companies.id, ids)).orderBy(companies.name)
    : [];

  return {
    companies: companyRows,
    integrations: [
      {
        name: "Database",
        connected: true,
        detail: process.env.DATABASE_URL_DIRECT ? "Session-mode connection (prepared statements on)." : "Pooled connection.",
      },
    ],
  };
}
