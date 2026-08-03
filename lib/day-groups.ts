// A day's payments to one party arrive as several documents — three cheques
// handed to one supplier on the same date is three rows in the list, reading as
// three unrelated payments with no total between them. Expenses do the same
// thing to a category: four fuel entries on a Tuesday, four rows, no day's fuel
// bill anywhere on screen. Grouping puts them on one line with the individual
// amounts and their total behind it.
//
// What counts as "the same thing on the same day" is the caller's to say —
// payments key on company + contact + date + direction (netting a payment made
// against one received, or one company's books against another's, would produce
// a total nobody asked for), expenses on company + category + date. A key of
// null means the row must stand alone: a payment with no contact has no party to
// group it under.

export type DayGroup<T> = {
  key: string;
  members: T[];
  // Summed in whole cents, then divided back: 1234.10 + 2345.20 in floating
  // point is 3579.2999999999997, and a total is not the place to be
  // approximately right.
  total: number;
};

export function groupSameDay<T>(rows: T[], keyOf: (row: T) => string | null, amountOf: (row: T) => string): DayGroup<T>[] {
  const groups: DayGroup<T>[] = [];
  const cents = new Map<string, number>();
  const byKey = new Map<string, DayGroup<T>>();

  rows.forEach((row, i) => {
    // A row that can't group still comes back as a group of one, so the caller
    // renders one shape rather than branching over two. The index keeps those
    // keys apart without the caller having to supply an id.
    const key = keyOf(row) ?? `solo:${i}`;
    const amount = Math.round(Number(amountOf(row) || 0) * 100);
    const existing = byKey.get(key);
    if (existing) {
      existing.members.push(row);
      cents.set(key, (cents.get(key) ?? 0) + amount);
    } else {
      // Placed where its first member sat, so grouping never reorders a list
      // that arrived sorted by date.
      const group: DayGroup<T> = { key, members: [row], total: 0 };
      byKey.set(key, group);
      cents.set(key, amount);
      groups.push(group);
    }
  });

  for (const group of groups) group.total = (cents.get(group.key) ?? 0) / 100;
  return groups;
}
