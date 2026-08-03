import Link from "next/link";
import { snapshotSizes } from "@/lib/actions/backups";
import { SNAPSHOT_TABLES } from "@/lib/backup-constants";
import { SnapshotExport } from "@/components/modules/SnapshotExport";

export const dynamic = "force-dynamic";

export default async function Page() {
  const sizes = await snapshotSizes();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/settings" className="text-sm text-steel hover:text-navy-800">
          ← Settings
        </Link>
        <h1 className="mt-1 text-xl text-navy-800">Backups &amp; Export</h1>
        <p className="text-sm text-steel">Where the real backups live, and how to take a copy of the data yourself.</p>
      </div>

      {/* This page used to list three invented backup files and a disabled "Run
          Backup Now". Saying plainly where backups come from is more use than a
          button that couldn't have worked: nothing running inside this app can
          take a consistent dump of the database it is connected to. */}
      <div className="rounded-lg border border-sand bg-white p-5">
        <h2 className="mb-2 text-sm font-semibold text-navy-800">Database backups</h2>
        <p className="text-sm text-ink">
          Backups are taken by the database host, not by this app. On Supabase that is the <strong>Database → Backups</strong> page of the project dashboard,
          where you can also restore to a point in time.
        </p>
        <p className="mt-2 text-sm text-steel">
          Check there that backups are actually enabled for your plan, and that the retention window is long enough to notice a problem before it rolls off. A
          backup nobody has ever restored from is a hope, not a backup — restore one into a scratch project once and confirm the data is there.
        </p>
      </div>

      <div className="rounded-lg border border-sand bg-white p-5">
        <h2 className="mb-1 text-sm font-semibold text-navy-800">Take a copy now</h2>
        <p className="mb-4 text-sm text-steel">
          Each of these downloads as a CSV that opens in Excel and survives this app being gone. Scoped to the companies you can see.
        </p>
        <SnapshotExport tables={SNAPSHOT_TABLES} sizes={sizes} />
      </div>
    </div>
  );
}
