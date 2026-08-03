"use server";

import { getSession } from "@/lib/auth/session";
import { requirePermission } from "@/lib/auth/permissions";
import { getScopeCompanyIds } from "@/lib/auth/scope";
import { money, qty } from "@/lib/format";
import { REPORT_TYPES, type ReportSlug } from "@/lib/report-constants";
import { queryReport, reportScope, type ReportFilters, type ReportResult } from "@/lib/queries/reports";

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
  const scope = reportScope(await getScopeCompanyIds(), filters);
  if (!scope) {
    return {
      title: meta.label,
      description: meta.desc,
      columns: [],
      rows: [],
      note: "You don't have access to any company, so there is nothing to report on.",
    };
  }

  return queryReport(slug, scope);
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
