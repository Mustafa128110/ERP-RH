"use client";

import { useState } from "react";
import { exportReportCsv } from "@/lib/actions/reports";
import type { ReportResult } from "@/lib/queries/reports";
import type { ReportSlug } from "@/lib/report-constants";
import { DataTable } from "@/components/ui/DataTable";
import { PageHeader } from "@/components/ui/PageHeader";
import { errorTextClass, iconButtonClass } from "@/components/ui/form-styles";
import { Icon } from "@/components/ui/Icon";
import { money, qty } from "@/lib/format";
import type { ColumnDef, Row } from "@/lib/table";
import { toCsv } from "@/lib/csv";

// One component for all eleven reports. They differ in their columns and their
// SQL (lib/actions/reports.ts) and in nothing else — the filter bar, the table,
// the totals line and the CSV button are the same screen every time, which is
// what the old placeholder page was already promising ("shared filter shape
// across all report types") without doing.

function download(text: string, filename: string) {
  // Excel reads a CSV with no BOM as ANSI and mangles anything non-Latin — the
  // same reason CsvActions writes one.
  const url = URL.createObjectURL(new Blob(["﻿" + text], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function recordsToCsv(rows: Record<string, string>[]): string {
  if (rows.length === 0) return "";
  const headers = Object.keys(rows[0]);
  return toCsv([headers, ...rows.map((row) => headers.map((header) => row[header] ?? ""))]);
}

export function ReportView({
  slug,
  report,
  filters,
  filterBar,
}: {
  slug: ReportSlug;
  report: ReportResult;
  filters: { from?: string; to?: string; company?: string; location?: string };
  filterBar: React.ReactNode;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const columns: ColumnDef[] = report.columns.map((c) => ({
    key: c.key,
    label: c.label,
    align: c.align,
  }));

  // Formatted here, once, so the table and the totals line agree — and so the
  // raw numbers stay available for the CSV, which formats them server-side.
  const format = (column: (typeof report.columns)[number], value: string | number | null) =>
    value === null || value === undefined ? "—" : column.money ? money(value) : column.qty ? qty(value) : String(value);

  const rows: Row[] = report.rows.map((r, i) => {
    const row: Row = { id: String(i) };
    for (const c of report.columns) row[c.key] = format(c, r[c.key]);
    return row;
  });

  async function exportCsv() {
    setBusy(true);
    setError(null);
    try {
      const data = await exportReportCsv(slug, filters);
      if (data.length === 0) {
        setError("Nothing to export — this report has no rows for the chosen dates.");
        return;
      }
      download(recordsToCsv(data), `${slug}-${filters.from ?? "start"}-to-${filters.to ?? "today"}.csv`);
    } catch {
      setError("Couldn't build the export. Try again, or narrow the date range.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex h-full flex-col gap-2">
      <PageHeader title={`${report.title} Report`} subtitle={report.description}>
        {filterBar}
        <button
          type="button"
          onClick={() => void exportCsv()}
          disabled={busy || report.rows.length === 0}
          className={iconButtonClass}
          aria-label="Export this report as CSV"
          title={busy ? "Building…" : "Export CSV"}
        >
          <Icon name="export" />
        </button>
      </PageHeader>

      {report.note && <p className="shrink-0 rounded border border-sand bg-ivory p-3 text-sm text-steel">{report.note}</p>}
      {error && <p role="alert" className={`${errorTextClass} shrink-0`}>{error}</p>}

      <DataTable
        columns={columns}
        rows={rows}
        idKey="id"
        emptyMessage="No rows for these dates."
        searchPlaceholder="Search this report…"
      />

      {report.totals && (
        <dl className="flex shrink-0 flex-col gap-3 rounded-lg border border-sand bg-white px-4 py-3 sm:flex-row sm:flex-wrap sm:justify-end sm:gap-6">
          {report.columns
            .filter((c) => c.money || c.qty)
            .map((c) => (
              <div key={c.key} className="flex min-w-0 items-baseline justify-between gap-2 sm:justify-start">
                <dt className="text-xs uppercase tracking-wide text-steel">{c.label}</dt>
                <dd className="numeric-contain text-right text-base font-semibold tabular-nums text-navy-800">{format(c, report.totals![c.key])}</dd>
              </div>
            ))}
        </dl>
      )}
    </div>
  );
}
