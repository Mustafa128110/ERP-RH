import type { ReactNode } from "react";

// The shape every list in this app speaks. It used to live in lib/modules.ts
// alongside 250 lines of invented demo rows, which meant importing a type
// dragged the fixtures in with it — and made it easy to miss that several pages
// were still rendering them as if they were real records.

// One row of a list. Primitives only: rows cross the server/client boundary, and
// keeping them flat is what lets DataTable search, sort and compare them without
// knowing anything about the module they came from.
//
// Two keys are special and never displayed: `id` (or whatever `idKey` names) and
// `_incomplete`, which paints the red "missing details" dot.
export type Row = Record<string, string | number | boolean | null>;

export type ColumnDef = {
  key: string;
  label: string;
  align?: "left" | "right";
  badge?: boolean;
  // Escape hatch for a cell that needs more than the stringified value — Row only
  // holds primitives, so anything richer (the sales list's hover panel) comes from
  // here, closing over the caller's own data.
  render?: (row: Row) => ReactNode;
};

// A right-aligned money column, which is most of the numeric ones.
export const amountColumn = (key: string, label: string): ColumnDef => ({ key, label, align: "right" });

// The status pill column, spelled once instead of in every module.
export const statusColumn = (key = "status", label = "Status"): ColumnDef => ({ key, label, badge: true });
