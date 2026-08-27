import Link from "next/link";
import { REPORT_TYPES } from "@/lib/report-constants";

// The index. The list of reports lives in lib/actions/reports.ts next to the
// queries that answer them, so a new report is one entry and one SQL statement
// rather than an entry here that has to be kept in step with one over there.
export default function Page() {
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl text-navy-800">Reports</h1>
        <p className="text-sm text-steel">Every report takes the same date range and company filter, and every one exports to CSV.</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {REPORT_TYPES.map((r) => (
          <Link key={r.slug} href={`/reports/${r.slug}`} className="min-w-0 rounded-lg border border-sand bg-white p-4 hover:border-navy-800">
            <p className="safe-wrap text-sm font-semibold text-navy-800">{r.label}</p>
            <p className="safe-wrap mt-1 text-xs text-steel">{r.desc}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
