export type TableSortColumn = {
  key: string;
  render?: unknown;
  sortable?: boolean;
  sortBy?: string;
};

export type TableSortDirection = "asc" | "desc";
export type TableSort = { key: string; direction: TableSortDirection };

export function parseTableSorts(sort?: string, direction?: string, allowed?: readonly string[]): TableSort[] {
  const directions = (direction ?? "desc").split(",");
  const seen = new Set<string>();
  return (sort ?? "").split(",").slice(0, 32).flatMap((key, index) => {
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(key) || seen.has(key) || allowed && !allowed.includes(key)) return [];
    seen.add(key);
    return [{ key, direction: directions[index] === "asc" ? "asc" as const : "desc" as const }];
  });
}

export function promoteTableSort(sorts: TableSort[], key: string): TableSort[] {
  const previous = sorts.find((sort) => sort.key === key);
  const rest = sorts.filter((sort) => sort.key !== key);
  return previous?.direction === "asc" && sorts[0]?.key === key ? rest : [{ key, direction: previous?.direction === "desc" ? "asc" : "desc" }, ...rest];
}

export function compareSortedRows(a: Record<string, unknown>, b: Record<string, unknown>, sorts: TableSort[]): number {
  for (const sort of sorts) {
    const result = compareTableValues(a[sort.key], b[sort.key], sort.direction);
    if (result) return result;
  }
  return 0;
}

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

  const number = (value: string) => /^-?[\d,]+(?:\.\d+)?$/.test(value.trim()) ? Number(value.replaceAll(",", "")) : null;
  const leftNumber = number(left), rightNumber = number(right);
  if (leftNumber !== null && rightNumber !== null) return (leftNumber - rightNumber) * multiplier;
  return left.localeCompare(right, undefined, { numeric: true }) * multiplier;
}
