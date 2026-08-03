"use client";

import { DataTable } from "@/components/ui/DataTable";
import { PageHeader } from "@/components/ui/PageHeader";
import { DetailHover } from "@/components/ui/DetailHover";
import type { ColumnDef, Row } from "@/lib/table";
import type { AuditRow } from "@/lib/actions/audit";

// The audit log used to be four invented rows in lib/modules.ts, shown as if
// they were history. It reads real audit_logs rows now, written by every
// mutation in lib/actions (see lib/actions/audit.ts).

// Local time, and the seconds kept: two edits a minute apart are the same minute
// on a date-only stamp, and "who changed it last" is exactly the question.
function when(value: Date): string {
  const d = new Date(value);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

const columns: ColumnDef[] = [
  { key: "when", label: "When" },
  { key: "user", label: "User" },
  { key: "action", label: "Action", badge: true },
  { key: "entity", label: "Record" },
  {
    key: "summary",
    label: "What",
    // The detail — a stock adjustment's reason, an invoice total, how many
    // duplicates a merge folded in — is the whole reason to read this page, and
    // it doesn't fit in a column. Hovering the row's own words is where anyone
    // looks for it.
    render: (row) =>
      row.detail ? (
        <DetailHover
          trigger={String(row.summary)}
          heading={String(row.summary)}
          width={320}
          footer={`${row.entity} · ${row.when} · ${row.user}`}
          extraHeight={20}
        >
          <span className="block whitespace-pre-line text-sm text-ink">{String(row.detail)}</span>
        </DetailHover>
      ) : (
        String(row.summary)
      ),
  },
];

export function AuditLogManager({ entries, filters }: { entries: AuditRow[]; filters: React.ReactNode }) {
  const rows: Row[] = entries.map((e) => ({
    id: e.id,
    when: when(e.createdAt),
    user: e.userName,
    action: e.action,
    entity: e.entity,
    summary: e.summary,
    detail: e.detail,
  }));

  return (
    <div className="flex h-full flex-col gap-4">
      <PageHeader
        title="Audit Logs"
        subtitle={`${entries.length} most recent change${entries.length === 1 ? "" : "s"} — newest first`}
      >
        {filters}
      </PageHeader>

      {/* Nothing opens: an audit entry is a fact about something that already
          happened, and the record it describes is often gone. */}
      <DataTable
        columns={columns}
        rows={rows}
        idKey="id"
        emptyMessage="Nothing recorded yet — every create, edit and delete from here on will show up."
        searchPlaceholder="Search the log…"
      />

      <p className="shrink-0 text-xs text-steel">
        Capped at the 200 most recent entries. Narrow the date range to reach further back.
      </p>
    </div>
  );
}
