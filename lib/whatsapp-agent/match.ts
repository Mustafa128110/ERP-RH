function normalize(text: string) { return text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(); }

export function bestMatches<T>(query: string, rows: readonly T[], nameOf: (row: T) => string, limit = 5): T[] {
  const q = normalize(query);
  if (!q) return [];
  const scored = rows
    .map((row) => {
      const name = normalize(nameOf(row));
      const exact = q === name;
      const prefix = name.startsWith(q);
      const tokens = q.split(" ").every((token) => name.split(" ").some((word) => word.startsWith(token)));
      return { row, score: exact ? 3 : prefix ? 2 : tokens ? 1 : 0 };
    })
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score);
  if (scored[0]?.score === 3 && scored.filter((entry) => entry.score === 3).length === 1) return [scored[0].row];
  return scored.slice(0, limit).map((entry) => entry.row);
}

export function chooseFrom(label: string, names: string[]): string {
  return [`Which ${label}?`, ...names.map((name, index) => `${index + 1}. ${name}`), "", "Reply with a fuller name."].join("\n");
}
