"use client";

import { DataTable } from "@/components/ui/DataTable";
import { PageHeader } from "@/components/ui/PageHeader";
import { DetailHover } from "@/components/ui/DetailHover";
import { formatDate, money, qty } from "@/lib/format";
import type { ColumnDef, Row } from "@/lib/table";
import type { StockMovementRow } from "@/lib/actions/stock-movements";

const columns: ColumnDef[] = [
  { key: "date", label: "Date" },
  { key: "item", label: "Item" },
  { key: "location", label: "Location" },
  { key: "type", label: "Type", badge: true },
  {
    key: "quantity",
    label: "Qty",
    align: "right",
    // Out is red and in is not. A movement list read in a hurry is read by
    // sign, and "-6" in the same colour as "+100" is the thing that gets misread.
    render: (row) => (
      <span className={Number(row.raw) < 0 ? "tabular-nums text-error" : "tabular-nums"}>{String(row.quantity)}</span>
    ),
  },
  {
    key: "reference",
    label: "Reference",
    // Who it was with, who entered it, and what it was worth — all true of the
    // movement and none of it worth a column of its own.
    render: (row) => (
      <DetailHover
        trigger={String(row.reference)}
        heading={String(row.reference)}
        rows={[
          { label: "Item", value: String(row.item) },
          { label: "Company", value: String(row.company) },
          ...(row.contact ? [{ label: "Contact", value: String(row.contact) }] : []),
          ...(row.value ? [{ label: "Value", value: String(row.value) }] : []),
          { label: "Entered by", value: String(row.user) },
        ]}
      />
    ),
  },
];

export function StockMovementsManager({ movements, filters }: { movements: StockMovementRow[]; filters: React.ReactNode }) {
  const rows: Row[] = movements.map((m) => ({
    id: m.id,
    date: formatDate(m.date),
    item: `${m.itemName}${m.sku && m.sku !== "—" ? ` (${m.sku})` : ""}`,
    location: m.location,
    type: m.type,
    quantity: `${Number(m.quantity) > 0 ? "+" : ""}${qty(m.quantity)} ${m.unit}`.trim(),
    raw: Number(m.quantity),
    reference: m.reference,
    company: m.company,
    contact: m.contact,
    user: m.user ?? "—",
    value: m.value ? money(m.value) : null,
  }));

  const inQty = movements.reduce((sum, m) => sum + Math.max(Number(m.quantity), 0), 0);
  const outQty = movements.reduce((sum, m) => sum + Math.min(Number(m.quantity), 0), 0);

  return (
    <div className="flex h-full flex-col gap-2">
      <PageHeader
        title="Stock Movements"
        subtitle={`${movements.length} movement(s) · ${qty(inQty)} in, ${qty(Math.abs(outQty))} out`}
      >
        {filters}
      </PageHeader>

      {/* Read-only by design: a movement is the consequence of a document, and
          the way to change one is to change the document that caused it. */}
      <DataTable
        columns={columns}
        rows={rows}
        idKey="id"
        emptyMessage="No stock has moved yet."
        searchPlaceholder="Search movements…"
      />

      <p className="shrink-0 text-xs text-steel">
        Capped at the 500 most recent movements. Narrow the date range or pick a location to reach further back.
      </p>
    </div>
  );
}
