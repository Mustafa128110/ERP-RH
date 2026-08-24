import assert from "node:assert/strict";
import { applyChange, optimistically, patchFromFormData, type OptimisticState, type RecordChange } from "./optimistic-records";

// The rules a list screen shows a row under before the database has agreed to it.
// Getting these wrong doesn't crash anything — it quietly shows someone a number
// that was never saved, which is worse. So: what a change does, what it declines
// to touch, and above all what happens when the server's answer lands while a
// change is still in the air.
//
//   npx tsx lib/optimistic-records.check.ts

type Brand = { id: string; name: string; symbol: string | null; itemCount: number; active: boolean };

const brand = (over: Partial<Brand> & { id: string }): Brand => ({
  name: "Royal",
  symbol: "R",
  itemCount: 4,
  active: true,
  ...over,
});

// A list as the server last sent it, with nothing in flight.
const served = (records: Brand[]): OptimisticState<Brand> => ({ records, pending: [] });

// What React does with the reducer: replay every pending change over that list.
const replay = (state: OptimisticState<Brand>, ...changes: RecordChange<Brand>[]) =>
  changes.reduce((current, change) => applyChange(current, change, "id"), state);

async function main() {
  // --- A patch replaces only what it names, and says the row is in flight ---

  {
    const next = replay(served([brand({ id: "a" }), brand({ id: "b", name: "M52" })]), {
      kind: "patch",
      id: "b",
      values: { name: "M52 Traders" },
    });
    assert.deepEqual(next.records.map((r) => r.name), ["Royal", "M52 Traders"]);
    assert.equal(next.records[1].symbol, "R", "a field the patch didn't name is left alone");
    assert.deepEqual(next.pending, ["b"], "the row is marked in flight so the table can fade it");
  }

  // --- A removed row leaves at once, and stays in flight until the write answers ---

  {
    const next = replay(served([brand({ id: "a" }), brand({ id: "b" })]), { kind: "remove", id: "a" });
    assert.deepEqual(next.records.map((r) => r.id), ["b"]);
    // Nothing left on screen to fade, but the dialog the delete was pressed in
    // reads this to know whether to stand aside — so a deletion in the air has to
    // say so even though its row has gone.
    assert.deepEqual(next.pending, ["a"], "the deletion is still in the air");
  }

  // --- A change for a row this list doesn't hold is a no-op, not a crash ---

  // A filter can narrow a row out from under an open dialog, and a redelivered
  // delete can confirm a row that has already gone.
  {
    const start = served([brand({ id: "a" })]);
    assert.equal(replay(start, { kind: "remove", id: "ghost" }), start, "nothing to show, so the same state comes back");
    assert.equal(replay(start, { kind: "patch", id: "ghost", values: { name: "X" } }), start);
  }

  // --- Editing the same row twice doesn't queue it as pending twice ---

  {
    const next = replay(
      served([brand({ id: "a" })]),
      { kind: "patch", id: "a", values: { name: "One" } },
      { kind: "patch", id: "a", values: { name: "Two" } },
    );
    assert.deepEqual(next.pending, ["a"]);
    assert.equal(next.records[0].name, "Two", "the later edit wins");
  }

  // --- A patch with no values says "in flight" and guesses nothing ---

  // What the invoice, purchase and payment lists do. Their rows are already
  // formatted money, dates and status pills, and the edit form posts ids and line
  // items — so there is nothing honest to put in a cell until the server answers.
  // The row fades and the popup stands aside; not one number moves.
  {
    const stored = brand({ id: "a", name: "Royal", itemCount: 4 });
    const next = replay(served([stored]), { kind: "patch", id: "a", values: {} });
    assert.deepEqual(next.pending, ["a"], "the row is in flight");
    assert.deepEqual(next.records[0], stored, "and shows exactly what the server last sent");
  }

  // --- Two rows in flight at once are both tracked ---

  {
    const next = replay(
      served([brand({ id: "a" }), brand({ id: "b" }), brand({ id: "c" })]),
      { kind: "patch", id: "a", values: { name: "One" } },
      { kind: "remove", id: "c" },
    );
    assert.deepEqual(next.pending, ["a", "c"]);
    assert.deepEqual(next.records.map((r) => r.id), ["a", "b"]);
  }

  // --- A patch can never change which row it is ---

  // Several forms post a hidden `id`, and the values reach the reducer as a plain
  // object. If one of them could land on the id, the row would lose its React key
  // and every lookup after it.
  {
    const next = replay(served([brand({ id: "a", name: "Royal" })]), {
      kind: "patch",
      id: "a",
      values: { id: "tampered", name: "Royal Hardware" } as Partial<Brand>,
    });
    assert.equal(next.records[0].id, "a", "the row keeps its identity whatever the patch carried");
    assert.equal(next.records[0].name, "Royal Hardware");
  }

  // --- The stored row is what shows when nothing is in flight ---

  // The whole safety argument in one line: React replays pending changes over
  // whatever the server last sent, so a rejected write leaves nothing behind.
  // Replaying nothing over the stored row *is* the rollback.
  {
    const stored = served([brand({ id: "a", name: "Royal Hardware" })]);
    assert.equal(replay(stored).records[0].name, "Royal Hardware");
    assert.deepEqual(replay(stored).pending, []);
  }

  // --- A change in flight sits on top of fresh data, not underneath it ---

  // The case a plain value can't survive and a reducer can: the list refreshes
  // while an edit is still in the air. Replayed against the new base, the edit
  // keeps the field it changed and picks up every field it didn't.
  {
    const edit: RecordChange<Brand> = { kind: "patch", id: "b", values: { name: "M52 Traders" } };

    const overStale = replay(served([brand({ id: "b", name: "M52", itemCount: 4 })]), edit);
    assert.equal(overStale.records[0].itemCount, 4);

    const overFresh = replay(served([brand({ id: "b", name: "M52", itemCount: 9 })]), edit);
    assert.equal(overFresh.records[0].name, "M52 Traders", "the pending edit survives the refresh");
    assert.equal(overFresh.records[0].itemCount, 9, "and the freshly-counted items come through with it");
  }

  // --- A removal replayed over a list that already dropped the row is harmless ---

  {
    const next = replay(served([brand({ id: "a" })]), { kind: "remove", id: "gone" });
    assert.deepEqual(next.records.map((r) => r.id), ["a"], "the delete landed; replaying it changes nothing");
  }

  // -------------------------------------------------------------------------
  // patchFromFormData — what the user typed, and nothing else
  // -------------------------------------------------------------------------

  // Every edit form here is a plain uncontrolled <form> whose input names are the
  // record's own field names, so the submitted FormData already is the patch. What
  // matters is what it declines to carry across.

  {
    const record = brand({ id: "a", name: "Royal", symbol: null });
    const formData = new FormData();
    formData.set("name", "  Royal Hardware  ");
    formData.set("symbol", "RH");
    formData.set("itemCount", "999");
    formData.set("active", "on");
    formData.set("confirmAllocations", "1");
    formData.set("logo", new Blob(["x"]), "logo.png");

    const patch = patchFromFormData(record, formData);

    assert.equal(patch.name, "  Royal Hardware  ", "the value goes in verbatim — trimming here would be a guess at what the server stores");
    assert.equal(patch.symbol, "RH", "a field the record holds as null is still a text field, so it comes through");
    assert.ok(!("itemCount" in patch), "a number field is skipped — '999' would change what the cell is");
    assert.ok(!("active" in patch), "so is a boolean: 'on' is not true");
    assert.ok(!("confirmAllocations" in patch), "a key the record doesn't have is not part of the record");
    assert.ok(!("logo" in patch), "a file is not a cell value");

    assert.deepEqual(record, brand({ id: "a", name: "Royal", symbol: null }), "the record itself is never mutated");
  }

  {
    assert.deepEqual(patchFromFormData(brand({ id: "a" }), new FormData()), {}, "an empty submission patches nothing");

    // Emptying a field is an edit like any other, so it has to survive.
    const cleared = new FormData();
    cleared.set("symbol", "");
    assert.equal(patchFromFormData(brand({ id: "a", symbol: "R" }), cleared).symbol, "", "clearing a field is not the same as not sending it");
  }

  // -------------------------------------------------------------------------
  // optimistically — the update has to travel with the action
  // -------------------------------------------------------------------------

  // React only accepts an optimistic update made inside an action, so the update
  // is applied by the wrapper React itself calls. The order is the point: the
  // screen changes first, then the write goes out.
  {
    const order: string[] = [];
    const action = async (state: number, formData: FormData) => {
      order.push(`action:${String(formData.get("name"))}`);
      return state + 1;
    };

    const wrapped = optimistically(action, (formData) => order.push(`apply:${String(formData.get("name"))}`));
    const formData = new FormData();
    formData.set("name", "Royal");

    assert.equal(await wrapped(41, formData), 42, "the action's own result passes straight through");
    assert.deepEqual(order, ["apply:Royal", "action:Royal"], "the screen changed before the write was sent, not after it answered");
  }

  {
    // A form used without a manager passing an update down must come back
    // untouched rather than wrapped in a no-op — that is what lets these forms
    // go on working standalone.
    const action = async (state: number) => state;
    assert.equal(optimistically(action, undefined), action);
  }

  console.log("optimistic-records checks passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
