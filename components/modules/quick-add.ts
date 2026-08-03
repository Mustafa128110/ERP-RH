// Quick-add is the "+" beside a dropdown inside a document form: you're writing
// a sale, the product isn't in the catalogue yet, so you add it without losing
// the sale you're halfway through.
//
// Every one of those buttons now opens the same batch dialog the master-data
// pages use, which means it can create several records at once. When it closes,
// the new records have to be folded into the dropdown the user was looking at —
// the options came from the server on page load and won't include them — and the
// first one selected, so the field is filled and the user carries on.
export function selectFirstCreated<T extends { id: string }>(
  created: T[] | undefined,
  appendOptions: (rows: T[]) => void,
  select: (id: string) => void,
) {
  if (!created || created.length === 0) return;
  appendOptions(created);
  select(created[0].id);
}
