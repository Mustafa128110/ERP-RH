import "server-only";

import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { settings } from "@/lib/db/schema";
import { SETTING_DEFS } from "@/lib/setting-constants";

const FALLBACK = new Map(SETTING_DEFS.map((definition) => [definition.key, definition.fallback]));

export async function companySettingValues(companyId: string, keys: string[]): Promise<Record<string, string>> {
  const unique = [...new Set(keys)];
  if (unique.length === 0) return {};
  const rows = await db
    .select({ key: settings.key, value: settings.value })
    .from(settings)
    .where(and(eq(settings.companyId, companyId), inArray(settings.key, unique)));
  const stored = new Map(rows.map((row) => [row.key, row.value ?? ""]));
  return Object.fromEntries(unique.map((key) => [key, stored.get(key) ?? FALLBACK.get(key) ?? ""]));
}

export async function companySettingValue(companyId: string, key: string): Promise<string> {
  return (await companySettingValues(companyId, [key]))[key] ?? "";
}

export async function settingsForCompanies(companyIds: string[], keys: string[]): Promise<Record<string, Record<string, string>>> {
  const ids = [...new Set(companyIds)];
  const wanted = [...new Set(keys)];
  if (ids.length === 0 || wanted.length === 0) return {};
  const rows = await db
    .select({ companyId: settings.companyId, key: settings.key, value: settings.value })
    .from(settings)
    .where(and(inArray(settings.companyId, ids), inArray(settings.key, wanted)));
  const stored = new Map(rows.map((row) => [`${row.companyId}:${row.key}`, row.value ?? ""]));
  return Object.fromEntries(
    ids.map((companyId) => [
      companyId,
      Object.fromEntries(wanted.map((key) => [key, stored.get(`${companyId}:${key}`) ?? FALLBACK.get(key) ?? ""])),
    ]),
  );
}
