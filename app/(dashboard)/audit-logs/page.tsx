import { listAuditLogs } from "@/lib/actions/audit";
import { AuditLogManager } from "@/components/modules/AuditLogManager";
import { ListFilters } from "@/components/ui/ListFilters";

export const dynamic = "force-dynamic";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ user?: string; entity?: string; action?: string; from?: string; to?: string }>;
}) {
  const filters = await searchParams;
  const entries = await listAuditLogs(filters);

  return (
    <AuditLogManager
      entries={entries}
      filters={
        <ListFilters key="filters" />
      }
    />
  );
}
