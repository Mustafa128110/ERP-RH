import { listAuditLogs, getAuditFacets } from "@/lib/actions/audit";
import { AuditLogManager } from "@/components/modules/AuditLogManager";
import { ListFilters } from "@/components/ui/ListFilters";
import { StockFilter } from "@/components/modules/StockFilters";

export const dynamic = "force-dynamic";

const ACTIONS = [
  { id: "create", name: "Created" },
  { id: "update", name: "Edited" },
  { id: "delete", name: "Deleted" },
  { id: "merge", name: "Merged" },
  { id: "import", name: "Imported" },
];

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ user?: string; entity?: string; action?: string; from?: string; to?: string }>;
}) {
  const filters = await searchParams;
  const [entries, facets] = await Promise.all([listAuditLogs(filters), getAuditFacets()]);

  return (
    <AuditLogManager
      entries={entries}
      filters={
        // The name box filters by user, since "who did this" is the question this
        // page gets opened with. Entity and action narrow it from there, and the
        // date range is what reaches past the 200-row cap.
        <ListFilters nameParam="user" namePlaceholder="User name">
          <StockFilter
            param="entity"
            allLabel="All records"
            options={facets.entities.map((e) => ({ id: e, name: e.replace(/^./, (c) => c.toUpperCase()) }))}
          />
          <StockFilter param="action" allLabel="All actions" options={ACTIONS} />
        </ListFilters>
      }
    />
  );
}
