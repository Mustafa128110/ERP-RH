import Link from "next/link";
import { notFound } from "next/navigation";
import { runReport } from "@/lib/actions/reports";
import { isReportSlug } from "@/lib/report-constants";
import { getCompanies, getLocations } from "@/lib/queries/lookups";
import { ReportView } from "@/components/modules/ReportView";
import { ListFilters } from "@/components/ui/ListFilters";
import { StockFilter } from "@/components/modules/StockFilters";

export const dynamic = "force-dynamic";

// Only these two care where the stock is; the rest would show a filter that
// changes nothing, which is worse than not offering it.
const LOCATION_AWARE = new Set(["warehouse-stock", "inventory"]);

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ reportType: string }>;
  searchParams: Promise<{ from?: string; to?: string; company?: string; location?: string }>;
}) {
  const [{ reportType }, filters] = await Promise.all([params, searchParams]);
  if (!isReportSlug(reportType)) notFound();

  const [report, companyRows, locationRows] = await Promise.all([runReport(reportType, filters), getCompanies(), getLocations()]);

  return (
    <div className="flex h-full flex-col gap-3">
      <Link href="/reports" className="shrink-0 text-sm text-steel hover:text-navy-800">
        ← Reports
      </Link>

      <ReportView
        slug={reportType}
        report={report}
        filters={filters}
        filterBar={
          // The date range is the whole of most reports' filtering, so it comes
          // from the shared bar rather than being rebuilt here. No name box:
          // finding a row inside the result is the table's own instant search.
          <ListFilters key="filters">
            <StockFilter param="company" allLabel="All companies" options={companyRows.map((c) => ({ id: c.id, name: c.name }))} />
            {LOCATION_AWARE.has(reportType) && (
              <StockFilter key="location" param="location" allLabel="All locations" options={locationRows.map((l) => ({ id: l.id, name: l.name }))} />
            )}
          </ListFilters>
        }
      />
    </div>
  );
}
