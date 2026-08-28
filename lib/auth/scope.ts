import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { and, isNull, inArray, or, type Column, type SQL } from "drizzle-orm";
import { getSession } from "./session";
import type { AuthSession } from "./session";
import { agentSession } from "@/lib/whatsapp-agent/context";

// The company scope decides what data is on screen. It's the Topbar selector:
// pick a company and you see that company's rows plus everything global; pick
// "All" and you see every company you have access to, plus global. You can never
// see a company you don't have access to — the selection is always intersected
// with the session's companyIds, so a stale or forged cookie can't widen it.
//
// Global rows (company_id IS NULL) are always in view — a shared currency or
// brand belongs to every company at once, so scoping never hides it.

export const SCOPE_COOKIE = "scope_company";

// The company ids currently in view. A single selected company, or every
// accessible one. Cached per request so the cookie/session are read once.
export async function getScopeCompanyIds(): Promise<string[]> {
  const agent = agentSession();
  if (agent) return agent.companyIds;
  return getCookieScopeCompanyIds();
}

const getCookieScopeCompanyIds = cache(async (): Promise<string[]> => {
  const session = await getSession();
  if (!session) return [];
  const selected = (await cookies()).get(SCOPE_COOKIE)?.value;
  if (selected && selected !== "all" && session.companyIds.includes(selected)) {
    return [selected];
  }
  return session.companyIds;
});

// What the Topbar selector currently shows — "all" or a specific company id.
export const getSelectedScope = cache(async (): Promise<string> => {
  const session = await getSession();
  const selected = (await cookies()).get(SCOPE_COOKIE)?.value;
  if (selected && selected !== "all" && session?.companyIds.includes(selected)) return selected;
  return "all";
});

// A WHERE condition for a company-scoped table: the row is in scope, or it's
// global. Drop this into any list query's `.where()`.
//
//   .where(await companyInScope(items.companyId))
//
// For a NOT NULL company column the isNull branch simply never matches, so the
// same helper works for scoped-only tables (items, documents) and
// global-capable ones (currencies, brands) alike.
export async function companyInScope(column: Column): Promise<SQL | undefined> {
  const ids = await getScopeCompanyIds();
  // No company access at all: only global rows are visible.
  if (ids.length === 0) return isNull(column);
  return or(isNull(column), inArray(column, ids));
}

// Read permissions are company-scoped too. Requiring `sales.view` without a
// company is only a page-level gate (the user has it somewhere); this predicate
// narrows the rows to the selected companies where that exact permission is
// effective. Without it, membership in company B plus sales.view in company A
// exposed B's sales.
export async function companyInPermissionScope(
  column: Column,
  session: AuthSession,
  moduleName: string,
  action = "view",
): Promise<SQL> {
  const selected = await getScopeCompanyIds();
  const key = `${moduleName}.${action}`;
  const ids = selected.filter(
    (companyId) => session.globalPermissions.has(key) || session.permissionsByCompany.get(companyId)?.has(key),
  );
  // Global rows are shared reference data. The caller has already passed the
  // page-level permission check, so those remain visible even when no selected
  // company grants the permission.
  if (ids.length === 0) return isNull(column);
  return or(isNull(column), inArray(column, ids))!;
}

// Combine the scope condition with an existing filter.
//
//   .where(await scopedWhere(items.companyId, eq(items.isActive, true)))
export async function scopedWhere(column: Column, ...extra: (SQL | undefined)[]): Promise<SQL | undefined> {
  return and(await companyInScope(column), ...extra);
}
