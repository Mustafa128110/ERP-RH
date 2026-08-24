"use client";

import { useOptimistic, useState } from "react";

import { applyChange, type OptimisticState, type RecordChange } from "@/lib/optimistic-records";

// The one place a list keeps track of changes the server hasn't confirmed yet.
//
// A list screen holds two different kinds of not-yet-confirmed row, and they need
// opposite handling, which is why this hook is two mechanisms rather than one:
//
//   inserted — rows a batch dialog just created. These came back from the write
//     with real database ids, so they are *truth*, merely truth that arrived
//     before the route's next render did. They live in ordinary state and stay
//     until a fresh server list makes them redundant. (RecordManager has worked
//     this way for a while; the behaviour is lifted here unchanged.)
//
//   patched / removed — rows a write is currently in the air for. These are
//     guesses, so they last exactly as long as the write does: React replays them
//     over whatever the server last sent, and drops them the moment the action
//     settles. Success reconciles against the revalidated payload that arrives in
//     the same response; failure reveals the stored row again, with no rollback to
//     write and nothing left behind to leak.
//
// IMPORTANT: `patch` and `remove` must be called from inside a form action or a
// transition — React reverts an optimistic update made anywhere else on the frame
// it was applied. Wrap the action with `optimistically()` from
// lib/optimistic-records.ts rather than calling these from an event handler.
//
// `pending` is what an open edit dialog reads to decide whether to stand aside,
// so the same lifetime that fades a row also hides and re-shows the popup. See
// OptimisticState in lib/optimistic-records.ts for why that has to be optimistic
// state and not a useState alongside it.
//
// The reducer lives in lib/optimistic-records.ts, free of React, so
// lib/optimistic-records.check.ts can replay a session of changes against it.

const NOTHING_PENDING: readonly string[] = [];
const NOTHING_INSERTED: readonly never[] = [];

export type OptimisticRecords<T> = {
  records: T[];
  pending: readonly string[];
  insert: (created: T[]) => void;
  patch: (id: string, values?: Partial<T>) => void;
  remove: (id: string) => void;
};

export function useOptimisticRecords<T>(records: T[], idKey: keyof T & string): OptimisticRecords<T> {
  const [inserted, setInserted] = useState<readonly T[]>(NOTHING_INSERTED);

  // Reconciliation, the render-time way: a new `records` array means the server
  // has spoken since the insert, so the local copy steps aside. Cheaper and less
  // surprising than an effect, which would paint the merged list once first.
  const [lastServed, setLastServed] = useState(records);
  if (records !== lastServed) {
    setLastServed(records);
    if (inserted.length > 0) setInserted(NOTHING_INSERTED);
  }

  const base = inserted.length === 0 ? records : [...inserted, ...records];

  const [state, change] = useOptimistic<OptimisticState<T>, RecordChange<T>>(
    { records: base, pending: NOTHING_PENDING },
    (current, next) => applyChange(current, next, idKey),
  );

  return {
    records: state.records,
    pending: state.pending,
    // New rows go on top, where the person who just typed them is looking.
    insert: (created: T[]) => setInserted((prev) => [...created, ...prev]),
    // `values` is optional, and leaving it out is a real answer rather than a
    // shortcut: it says a write is in the air for this row without claiming to
    // know what the row will look like afterwards. The lists whose rows are
    // already-formatted money and dates (invoices, purchases, payments) use it
    // that way — the row is marked pending and nothing on it is guessed at.
    patch: (id: string, values?: Partial<T>) => change({ kind: "patch", id, values: values ?? {} }),
    // Deliberately not also dropping the row from `inserted`: that is real state,
    // and clearing it would make a *failed* delete look like a successful one
    // until the next navigation. A delete that works revalidates, which clears
    // `inserted` above; a delete that doesn't leaves the row where it was.
    remove: (id: string) => change({ kind: "remove", id }),
  };
}
