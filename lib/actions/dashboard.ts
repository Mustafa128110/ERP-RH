"use server";

import { inArray } from "drizzle-orm";
import { loadDashboard } from "@/lib/queries/dashboard";
import { db } from "@/lib/db";
import { companies } from "@/lib/db/schema";
import { getSession } from "@/lib/auth/session";
import { PermissionError } from "@/lib/auth/permissions";
import { getScopeCompanyIds } from "@/lib/auth/scope";
import { cached, MINUTE } from "@/lib/cache";

// Every number on the dashboard is derived here, in SQL, from the same rows the
// list pages read. Nothing is stored as a running total, so a figure can't drift
// from the documents behind it.
//
// The business runs on one clock, and `documents.document_date` is a DATE written
// from the browser's local day. Asking the server for "today" would return the
// UTC day, which at UTC+5 flips five hours early — an evening sale would land on
// tomorrow's card.
const BUSINESS_TIMEZONE = "Asia/Karachi";

function businessToday() {
  return new Date().toLocaleDateString("en-CA", { timeZone: BUSINESS_TIMEZONE });
}

// The dashboard is live figures, not reference data, so the cache TTL is a
// backstop rather than the freshness mechanism — the write-invalidation in
// await invalidateLookups() (lib/queries/lookups.ts) is what keeps a sale showing
// the moment it's made. 60s bounds the worst case for anything that writes
// outside the action layer (a psql session, a future action nobody wired up)
// and for the per-instance copies behind a load balancer.
const AGGREGATE_TTL = MINUTE;

export interface DashboardData {
  today: string;
  todaySales: number;
  todayPurchases: number;
  todayExpenses: number;
  cashPosition: number;
  receivables: number;
  payables: number;
  inventoryValue: number;
  outOfStock: number;
  topProducts: { name: string; unitsSold: number; unit: string }[];
  warehouses: { name: string; value: number; outOfStock: number }[];
}

export async function getDashboardData(): Promise<DashboardData> {
  const session = await getSession();
  if (!session) throw new PermissionError("Not authenticated");

  // The business day is part of the key, so the cache flips at midnight exactly
  // rather than waiting out a TTL to stop showing yesterday as today. The scope
  // keeps two views — Royal Hardware vs M52 — from sharing a figure. The auth
  // check above runs on every request; only the query is cached.
  const today = businessToday();
  const selected = await getScopeCompanyIds();
  const idsFor = (key: string) => selected.filter(
    (companyId) => session.globalPermissions.has(key) || session.permissionsByCompany.get(companyId)?.has(key),
  );
  const scopes = {
    sales: idsFor("sales.view"),
    purchases: idsFor("purchases.view"),
    expenses: idsFor("expenses.view"),
    accounts: idsFor("accounts.view"),
    stock: idsFor("stock.view"),
  };
  const cacheScope = Object.values(scopes).map((ids) => ids.join(",")).join("|");
  return cached(`dashboard:${today}:${cacheScope}`, AGGREGATE_TTL, () => loadDashboard(today, scopes));
}



// Named separately from the numbers above because it's the one thing on the page
// that isn't an aggregate — used for the header line. Cached under the
// dashboard: prefix, so the same invalidate("dashboard") that clears the
// figures clears this too.
export async function getDashboardCompanies() {
  const session = await getSession();
  if (!session) throw new PermissionError("Not authenticated");
  const ids = await getScopeCompanyIds();
  return cached(`dashboard:companies:${ids.join(",")}`, AGGREGATE_TTL, async () =>
    ids.length > 0 ? db.select({ name: companies.name }).from(companies).where(inArray(companies.id, ids)) : [],
  );
}
