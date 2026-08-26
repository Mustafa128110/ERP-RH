"use client";

import { DataTable } from "@/components/ui/DataTable";
import type { ColumnDef, Row } from "@/lib/table";
import { money, qty } from "@/lib/format";

export type StockBreakdownRow = { location: string; unit: string; onHand: number; valuation: number };
export type StockUnitTotal = { unit: string; onHand: number; valuation: number };
export type StockItem = {
  itemId: string;
  sku: string;
  itemName: string;
  company: string;
  companyId: string;
  lowStockQty: number;
  location: string;
  unitTotals: StockUnitTotal[];
  breakdown: StockBreakdownRow[];
};

// The grouped view was the last hand-rolled table in the app: one row per item
// with its per-location split as extra <tr>s underneath. Those sub-rows are what
// kept it out of DataTable — a row you can't tick, number or arrow onto — so the
// split now renders inside the item's own cells instead. Same information, one
// row per item, and the shared keyboard model comes with it.
export function StockLevels({ items }: { items: StockItem[] }) {
  const breakdownOf = (row: Row) => (row as unknown as { breakdown: StockBreakdownRow[] }).breakdown;
  const totalsOf = (row: Row) => (row as unknown as { unitTotals: StockUnitTotal[] }).unitTotals;

  const columns: ColumnDef[] = [
    { key: "sku", label: "SKU", hideOnMobile: true },
    { key: "itemName", label: "Product" },
    { key: "company", label: "Company" },
    {
      key: "location",
      label: "Location",
      render: (row) => (
        <div className="flex flex-col gap-0.5">
          <span>{String(row.location)}</span>
          {breakdownOf(row).map((b, i) => (
            <span key={i} className="text-xs text-steel">
              {b.location}
            </span>
          ))}
        </div>
      ),
    },
    {
      key: "onHand",
      label: "On Hand",
      align: "right",
      render: (row) => (
        <div className="flex flex-col gap-0.5">
          {totalsOf(row).map((u) => (
            <span key={u.unit}>
              {qty(u.onHand)} {u.unit}
            </span>
          ))}
          {breakdownOf(row).map((b, i) => (
            <span key={i} className="text-xs text-steel">
              {qty(b.onHand)} {b.unit}
            </span>
          ))}
        </div>
      ),
    },
    {
      key: "valuation",
      label: "Valuation",
      align: "right",
      sortable: true,
      sortBy: "_sortValuation",
      render: (row) => (
        <div className="flex flex-col gap-0.5">
          {totalsOf(row).map((u) => (
            <span key={u.unit}>{money(u.valuation)}</span>
          ))}
          {breakdownOf(row).map((b, i) => (
            <span key={i} className="text-xs text-steel">
              {money(b.valuation)}
            </span>
          ))}
        </div>
      ),
    },
    { key: "status", label: "Status", badge: true },
  ];

  // Row's value type is primitives — it's what a plain cell can print. The two
  // array fields are only ever read back by the renderers above, so they ride
  // along past that type rather than becoming columns of their own.
  const rows = items.map((it) => ({
    id: it.itemId,
    sku: it.sku,
    itemName: it.itemName,
    _searchItem: `${it.itemName} ${it.sku}`,
    _searchUnit: [...it.unitTotals.map((unit) => unit.unit), ...it.breakdown.map((row) => row.unit)].join(" "),
    company: it.company,
    location: it.location,
    _sortValuation: it.unitTotals.reduce((sum, unit) => sum + unit.valuation, 0),
    status: it.unitTotals.every((u) => u.onHand <= 0) ? "Out" : it.unitTotals.some((u) => u.onHand <= it.lowStockQty) ? "Low" : "OK",
    unitTotals: it.unitTotals,
    breakdown: it.breakdown,
  })) as unknown as Row[];

  return <DataTable columns={columns} rows={rows} idKey="id" emptyMessage="No stock activity yet." searchPlaceholder="Search stock…" />;
}
