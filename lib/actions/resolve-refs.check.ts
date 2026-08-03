import assert from "node:assert/strict";
import { resolveContactIds } from "./resolve-refs";

// resolveContactIds is what lets a batch grid accept a typed contact name
// without putting a per-row round trip inside the transaction. The three things
// that can go wrong silently — the wrong contact reused, a duplicate contact
// minted, ids landing on the wrong rows — are what's asserted here.
//
//   npx tsx --conditions=react-server lib/actions/resolve-refs.check.ts

const royal = "royal-id";
const m52 = "m52-id";

type ContactRow = { id: string; companyId: string | null; displayName: string };

// A stand-in for the drizzle transaction: it records the statements it was asked
// for, answers the SELECT from a fixed table, and hands the INSERT back rows the
// way `.returning()` would.
function fakeTx(table: ContactRow[]) {
  const selects: number[] = [];
  const inserted: { companyId: string; displayName: string }[][] = [];
  let nextId = 100;
  const tx = {
    select: () => ({
      from: () => ({
        // The real WHERE narrows by name and company; the assertions below only
        // care which row wins, so the fake hands back the whole table and lets
        // resolveContactIds do the choosing.
        where: async () => {
          selects.push(1);
          return table;
        },
      }),
    }),
    insert: () => ({
      values: (rows: { companyId: string; displayName: string }[]) => ({
        returning: async () => {
          inserted.push(rows);
          return rows.map((r) => ({ id: `new-${nextId++}`, companyId: r.companyId, displayName: r.displayName }));
        },
      }),
    }),
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { tx: tx as any, selects, inserted };
}

async function main() {
  // --- An already-picked id wins over anything typed ---
  {
    const { tx, selects, inserted } = fakeTx([]);
    const ids = await resolveContactIds(tx, [{ companyId: royal, contactId: "picked", contactName: "Ignored" }]);
    assert.deepEqual(ids, ["picked"]);
    assert.equal(selects.length, 0, "nothing to look up, so no round trip at all");
    assert.equal(inserted.length, 0);
  }

  // --- Blank rows resolve to null, not to a contact named "" ---
  {
    const { tx, inserted } = fakeTx([]);
    const ids = await resolveContactIds(tx, [
      { companyId: royal, contactId: null, contactName: null },
      { companyId: royal, contactId: null, contactName: "   " },
    ]);
    assert.deepEqual(ids, [null, null]);
    assert.equal(inserted.length, 0, "whitespace is not a contact");
  }

  // --- The company's own contact is preferred; a global one is the fallback ---
  {
    const { tx } = fakeTx([
      { id: "global-acme", companyId: null, displayName: "Acme" },
      { id: "royal-acme", companyId: royal, displayName: "Acme" },
      { id: "global-widgets", companyId: null, displayName: "Widgets" },
    ]);
    const ids = await resolveContactIds(tx, [
      { companyId: royal, contactId: null, contactName: "Acme" },
      { companyId: royal, contactId: null, contactName: "Widgets" },
    ]);
    assert.deepEqual(ids, ["royal-acme", "global-widgets"]);
  }

  // --- One name repeated across rows creates one contact, not one per row ---
  {
    const { tx, selects, inserted } = fakeTx([]);
    const ids = await resolveContactIds(tx, [
      { companyId: royal, contactId: null, contactName: "New Supplier" },
      { companyId: royal, contactId: null, contactName: "New Supplier" },
      { companyId: royal, contactId: null, contactName: " New Supplier " },
    ]);
    assert.equal(new Set(ids).size, 1, "all three rows point at the same new contact");
    assert.equal(inserted.length, 1, "one INSERT statement");
    assert.equal(inserted[0].length, 1, "carrying one row");
    assert.equal(selects.length, 1, "one SELECT, whatever the row count");
  }

  // --- The same name under two companies is two contacts ---
  {
    const { tx, inserted } = fakeTx([]);
    const ids = await resolveContactIds(tx, [
      { companyId: royal, contactId: null, contactName: "Shared Name" },
      { companyId: m52, contactId: null, contactName: "Shared Name" },
    ]);
    assert.equal(inserted[0].length, 2, "a contact belongs to one company");
    assert.notEqual(ids[0], ids[1]);
  }

  // --- Ids come back aligned with the rows they were asked for ---
  {
    const { tx } = fakeTx([{ id: "existing-b", companyId: royal, displayName: "B" }]);
    const ids = await resolveContactIds(tx, [
      { companyId: royal, contactId: null, contactName: "A" },
      { companyId: royal, contactId: "picked-id", contactName: null },
      { companyId: royal, contactId: null, contactName: "B" },
      { companyId: royal, contactId: null, contactName: null },
    ]);
    assert.equal(ids.length, 4);
    assert.equal(ids[1], "picked-id");
    assert.equal(ids[2], "existing-b");
    assert.equal(ids[3], null);
    assert.notEqual(ids[0], null, "the typed name got a freshly created id");
  }

  console.log("resolve-refs checks passed");
}

void main();
