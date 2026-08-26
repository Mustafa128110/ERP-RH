export type TableSortColumn = {
  key: string;
  render?: unknown;
  sortable?: boolean;
  sortBy?: string;
};

export type TableSortDirection = "asc" | "desc";

export function tableColumnSortKey(column: TableSortColumn, excludedKey: string): string | null {
  if (column.key === excludedKey || column.sortable === false) return null;
  if (column.render && column.sortable !== true) return null;
  return column.sortBy ?? column.key;
}

export function compareTableValues(a: unknown, b: unknown, direction: TableSortDirection): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;

  const multiplier = direction === "asc" ? 1 : -1;
  if (typeof a === "number" && typeof b === "number") return (a - b) * multiplier;

  const left = String(a).toLowerCase();
  const right = String(b).toLowerCase();
  const displayDateLeft = left.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  const displayDateRight = right.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (displayDateLeft && displayDateRight) {
    const leftTime = new Date(Number(displayDateLeft[3]), Number(displayDateLeft[2]) - 1, Number(displayDateLeft[1])).getTime();
    const rightTime = new Date(Number(displayDateRight[3]), Number(displayDateRight[2]) - 1, Number(displayDateRight[1])).getTime();
    return (leftTime - rightTime) * multiplier;
  }

  const isoDateLeft = left.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const isoDateRight = right.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoDateLeft && isoDateRight) {
    const leftTime = new Date(Number(isoDateLeft[1]), Number(isoDateLeft[2]) - 1, Number(isoDateLeft[3])).getTime();
    const rightTime = new Date(Number(isoDateRight[1]), Number(isoDateRight[2]) - 1, Number(isoDateRight[3])).getTime();
    return (leftTime - rightTime) * multiplier;
  }

  return left.localeCompare(right) * multiplier;
}
