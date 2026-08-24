// Formatting for audit detail, on the pure side of `lib/actions/audit.ts`.
//
// That module is "use server" and may only export async functions, so the shape
// of what goes into `AuditEntry.detail` lives here — the same split as
// lib/sale-constants.ts and lib/report-constants.ts.
//
// This exists because "logged with old value and new value" is only useful if
// every module writes it the same way. A trail that says "Total 100000.00 →
// 50000.00" in one place and "changed total" in another is not a trail anyone can
// read back.

// One field that moved. `before`/`after` are whatever the caller has — a string
// from the database, a number off a form, null for an empty column.
export type FieldChange = readonly [label: string, before: unknown, after: unknown];

const show = (value: unknown): string => {
  if (value === null || value === undefined || value === "") return "—";
  return String(value);
};

// Only the fields that actually changed, as "Label old → new" joined by "; ".
// Comparison is on the rendered strings, so a numeric 100 and a database "100"
// do not read as an edit — which is what stops every save logging every column.
//
// Returns "" when nothing moved. Callers should treat that as "no detail" rather
// than logging an empty change list.
export function changeSummary(changes: readonly FieldChange[]): string {
  return changes
    .filter(([, before, after]) => show(before) !== show(after))
    .map(([label, before, after]) => `${label} ${show(before)} → ${show(after)}`)
    .join("; ");
}
