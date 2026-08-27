import Link from "next/link";
import { snapshotSizes } from "@/lib/actions/backups";
import { getSession } from "@/lib/auth/session";
import { SNAPSHOT_TABLES } from "@/lib/backup-constants";
import { BackupWorkflowControls } from "@/components/modules/BackupWorkflowControls";
import { SnapshotExport } from "@/components/modules/SnapshotExport";

export const dynamic = "force-dynamic";

export default async function Page() {
  const [sizes, session] = await Promise.all([snapshotSizes(), getSession()]);
  const canDispatch = session?.globalPermissions.has("backups.create") ?? false;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/settings" className="text-sm text-steel hover:text-navy-800">
          ← Settings
        </Link>
        <h1 className="mt-1 text-xl text-navy-800">Backups &amp; Export</h1>
        <p className="text-sm text-steel">Automated encrypted database protection, plus scoped CSV exports.</p>
      </div>

      <div className="rounded-lg border border-sand bg-white p-5">
        <h2 className="mb-2 text-sm font-semibold text-navy-800">Automated database backup</h2>
        <p className="text-sm text-ink">
          A GitHub workflow creates an encrypted ZIP at <strong>3:00 PM</strong> and <strong>8:30 PM Pakistan time</strong>, then stores it in Cloudflare R2.
          The archive contains the ERP access roles, schema, data, and an integrity manifest.
        </p>
        <p className="mt-2 text-sm text-steel">
          Only one archive is retained. The previous archive is replaced only after the new archive is uploaded and verified. Restore testing is not automatic;
          an administrator must explicitly request a test, which must run against a disposable database rather than production.
        </p>
        <BackupWorkflowControls canDispatch={canDispatch} />
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
