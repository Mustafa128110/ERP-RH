"use server";

import { getSession } from "@/lib/auth/session";
import { requirePermission } from "@/lib/auth/permissions";
import { getScopeCompanyIds } from "@/lib/auth/scope";
import { cached, MINUTE } from "@/lib/cache";
import { money, qty } from "@/lib/format";
import { REPORT_TYPES, type ReportSlug } from "@/lib/report-constants";
import { queryReport, reportScope, type ReportFilters, type ReportResult } from "@/lib/queries/reports";

// Same reasoning as the dashboard cache (lib/actions/dashboard.ts): a report
// is a live aggregate, so the write-invalidation in invalidateLookups() is the
// freshness mechanism and the TTL is a backstop for anything that writes
// outside the action layer.
const AGGREGATE_TTL = MINUTE;

// The reports screen used to render two invented rows under every heading, with
// a disabled Export button. All eleven read real data now.
//
// This file is the boundary: it checks the permission, turns the session into a
// company scope, and hands both to lib/queries/reports.ts, which owns the SQL.
// Same split as lib/queries/lookups.ts — a "use server" module publishes every
// export as an HTTP endpoint, so the only things reachable here are the two an
// authorised user is allowed to ask for.

export async function runReport(slug: ReportSlug, filters: ReportFilters): Promise<ReportResult> {
  const session = await getSession();
  requirePermission(session, "reports", "view");

  const meta = REPORT_TYPES.find((r) => r.slug === slug)!;
  const ids = await getScopeCompanyIds();
  const scope = reportScope(ids, filters);
  if (!scope) {
    return {
      title: meta.label,
      description: meta.desc,
      columns: [],
      rows: [],
      note: "You don't have access to any company, so there is nothing to report on.",
    };
  }

  // Keyed on the *resolved* scope — the effective date range, the narrowed
  // company, the location — so two visits whose raw filters mean the same
  // thing (an omitted date range, a company the user can't see) share one
  // entry. The permission check above runs on every request; only the query is
  // cached, and invalidateLookups() clears every reports:… key on any write.
  return cached(
    `reports:${slug}:${ids.length ? [...ids].sort().join(",") : "none"}:${scope.from}:${scope.to}:${scope.company ?? ""}:${scope.location ?? ""}`,
    AGGREGATE_TTL,
    () => queryReport(slug, scope),
  );
}

// The same rows the table shows, as strings a spreadsheet will read. Formatted
// here rather than in the browser so the file matches the screen exactly.
export async function exportReportCsv(slug: ReportSlug, filters: ReportFilters): Promise<Record<string, string>[]> {
  const session = await getSession();
  requirePermission(session, "reports", "export");

  const report = await runReport(slug, filters);
  return report.rows.map((row) => {
    const out: Record<string, string> = {};
    for (const column of report.columns) {
      const value = row[column.key];
      out[column.label] = value === null || value === undefined ? "" : column.money ? money(value) : column.qty ? qty(value) : String(value);
    }
    return out;
  });
}
