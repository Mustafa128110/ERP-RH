// The list-side half of instant CRUD.
//
// Saving used to mean: freeze the dialog, wait for the write, wait for the route
// to re-render on the server (its own queries, against a database ~170ms away),
// and only then move the row. Nothing about it was wrong — it was half a second
// of nothing happening, several times a minute, all day.
//
// What moves the row now is this reducer, replayed by React's useOptimistic over
// whatever the server last sent. Two rules are what make showing a row the
// database hasn't confirmed yet safe rather than a lie:
//
//   - the change is only ever what the user typed. Nothing is computed here, so
//     a total, a document number or a balance is never guessed at.
//   - the server list wins the moment it lands, so a rejected write leaves
//     nothing behind — there is no state to roll back by hand.
//
// Deliberately free of React, so lib/optimistic-records.check.ts can replay a
// whole session of changes over a base list with node:assert.

// Insert is not here. Created rows come back from the batch dialogs with real
// database ids (`onDone(created)`), so the list can hold the truth rather than a
// placeholder — see useOptimisticRecords. Only edits and deletes have to show
// something before the server has spoken.
export type RecordChange<T> =
  | { kind: "patch"; id: string; values: Partial<T> }
  | { kind: "remove"; id: string };

// `pending` is the ids whose write is still in the air, whichever kind of write
// it is. It has two readers, and both need it to mean exactly that:
//   - DataTable fades those rows, so "saved" and "saving" don't look identical.
//   - the edit dialog hides itself while its own record is in there, and comes
//     back when it isn't. That second one is why this lives in the optimistic
//     state rather than in a useState beside it: React defers an ordinary state
//     update made inside an action until the action finishes, which is the one
//     moment a dialog that wanted to close early must not wait for. Optimistic
//     state is applied at once and reverted when the action settles — the exact
//     lifetime "hidden while saving" needs, including the revert on failure.
export type OptimisticState<T> = { records: T[]; pending: readonly string[] };

function withPending(pending: readonly string[], id: string): readonly string[] {
  return pending.includes(id) ? pending : [...pending, id];
}

export function applyChange<T>(
  state: OptimisticState<T>,
  change: RecordChange<T>,
  idKey: keyof T & string,
): OptimisticState<T> {
  // A change for a row this list doesn't hold is not an error: a filter can
  // narrow a row out from under an open dialog, and a redelivered delete can
  // confirm twice. Nothing to show, so nothing to do.
  const held = state.records.some((record) => String(record[idKey]) === change.id);
  if (!held) return state;

  if (change.kind === "remove") {
    // The row leaves at once, and stays marked pending even though there is
    // nothing left on screen to fade: the deletion is still in the air, and the
    // dialog it was pressed in reads this to know whether to stand aside.
    return {
      records: state.records.filter((record) => String(record[idKey]) !== change.id),
      pending: withPending(state.pending, change.id),
    };
  }

  return {
    records: state.records.map((record) => {
      if (String(record[idKey]) !== change.id) return record;
      const merged = { ...record, ...change.values };
      // The id is put back last, deliberately. A form is free to post a hidden
      // `id`, and the values arrive here as a plain object, so without this a
      // stray field could rename a row out from under its own React key and
      // every id lookup that follows it.
      merged[idKey] = record[idKey];
      return merged;
    }),
    pending: withPending(state.pending, change.id),
  };
}

// What the user typed, as a patch for the row they typed it on.
//
// Every edit form in this app is a plain uncontrolled <form> whose input names
// are the record's own field names, so the submitted FormData already *is* the
// patch — there is no per-screen mapping table to write and keep in step.
//
// Three things are skipped, and each one is the same rule stated again: only
// fields this row already renders as text are touched.
//   - a key the record doesn't have (hidden ids, confirmAllocations, a file)
//   - a field the record holds as a number or a boolean, because replacing it
//     with the raw form string would change what the cell *is*
//   - nothing else: the value goes in verbatim, untrimmed and unparsed, because
//     the moment this module starts predicting what the server will store it
//     stops being the user's own input.
export function patchFromFormData<T extends object>(record: T, formData: FormData): Partial<T> {
  const patch: Record<string, unknown> = {};
  for (const [key, value] of formData.entries()) {
    if (typeof value !== "string") continue;
    if (!(key in record)) continue;
    const current = (record as Record<string, unknown>)[key];
    if (current !== null && typeof current !== "string") continue;
    patch[key] = value;
  }
  return patch as Partial<T>;
}

// The form-side half, and the reason it has to exist: React only accepts an
// optimistic update made inside an action or a transition. Anything that runs
// earlier — a submit handler, a capture-phase listener on a wrapper element —
// lands outside one, and React reverts it on the same frame it was applied.
//
// So the update has to travel *with* the action. This wraps the function a form
// hands to useActionState, and React calls that wrapper from inside the
// transition it starts for the submit, which is the one place the setter is
// legal. Each edit form's diff is an import and a call; with no `apply` passed
// down it returns the action untouched, so a form still works on its own.
//
// Two type parameters rather than one, and the difference is load-bearing. Every
// action in this app is `(prev: ActionResult | undefined, formData) => Promise<
// ActionResult>`: React passes undefined on the first call, and no action ever
// returns it. A single `S` spanning both positions resolves to the return type,
// and the wrapper then refuses the undefined useActionState is contractually
// going to hand it — at every one of the twenty-three call sites.
export function optimistically<In, Out>(
  action: (state: In, formData: FormData) => Promise<Out>,
  apply: ((formData: FormData) => void) | undefined,
): (state: In, formData: FormData) => Promise<Out> {
  if (!apply) return action;
  return (state, formData) => {
    apply(formData);
    return action(state, formData);
  };
}
