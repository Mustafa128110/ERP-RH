import assert from "node:assert/strict";
import { encodeCacheValue, decodeCacheValue } from "./cache-codec";
import { canonicalJson, confirmedArguments, decodeArgument, encodeArgument, unresolved, type SavedCommand } from "./command-protocol";
import { canCancel, drainCommands, SYNC_LEASE_MS, warnBeforeUnload, type CommandStore } from "./command-sync";
import { saveDraft, readDraft, clearDraft, draftOperationId } from "./draft";

const command = (id = crypto.randomUUID()): SavedCommand => ({ id, userId: "user-a", action: "sales.createSale", args: [{ quantity: 3 }], path: "/sales/invoices", label: "Sale", version: 1, status: "pending", attempts: 0, createdAt: 1, updatedAt: 1 });
function memory(initial: SavedCommand[]) {
  const records = new Map(initial.map(row => [row.id, structuredClone(row)]));
  const store: CommandStore = {
    list: async user => [...records.values()].filter(row => row.userId === user).map(row => structuredClone(row)),
    change: async (user, id, change) => {
      const old = records.get(id);
      if (!old || old.userId !== user) return undefined;
      const next = change(structuredClone(old)); records.set(id, next); return next;
    },
  };
  return { records, store };
}
async function main() {
  const data = { date: new Date("2026-09-10T10:00:00Z"), permissions: new Set(["sales.create"]), byCompany: new Map([["a", new Set(["read"])]]), missing: undefined, nested: [null, { $form: "literal" }] };
  assert.deepEqual(decodeCacheValue(encodeCacheValue(data)), data, "cache and HTTP transport preserve Dates, Sets, Maps and undefined");
  const fd = new FormData(); fd.append("line", "one"); fd.append("line", "two");
  assert.deepEqual([...(decodeArgument(encodeArgument(fd)) as FormData).entries()], [...fd.entries()]);
  assert.throws(() => encodeArgument(new Date()), /could not be stored/);
  assert.equal(canonicalJson({ b: 2, a: 1 }), canonicalJson({ a: 1, b: 2 }));

  const storage = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  } });
  storage.set("erp-draft:old", JSON.stringify({ savedAt: Date.now() - 90 * 86400_000, value: { lines: [1, 2] } }));
  assert.deepEqual(readDraft("old"), { lines: [1, 2] }, "unsubmitted work never expires");
  storage.set("erp-draft:broken", "original incomplete bytes");
  assert.equal(readDraft("broken"), null);
  assert.equal(storage.get("erp-draft:broken"), "original incomplete bytes", "corrupt input is preserved");
  assert.equal(saveDraft("broken", { lines: [] }), false, "autosave cannot replace unreadable original input");
  assert.equal(storage.get("erp-draft:broken"), "original incomplete bytes");
  assert.equal(saveDraft("sale", { qty: 1 }), true);
  const identity = draftOperationId("sale");
  saveDraft("sale", { qty: 2 });
  assert.equal(draftOperationId("sale"), identity, "editing a draft retains its submission identity");
  clearDraft("sale"); saveDraft("sale", { qty: 2 });
  assert.notEqual(draftOperationId("sale"), identity, "the next sale gets a different identity");

  assert.deepEqual(confirmedArguments("ledger.deleteLedgerRow", ["document", false]), ["document", true]);
  const confirmedForm = confirmedArguments("sales.updateSale", [null, { $form: [["confirmAllocations", "0"], ["amount", "5"]] }]);
  assert.equal((decodeArgument(confirmedForm[1]) as FormData).get("confirmAllocations"), "1");
  assert.equal((decodeArgument(confirmedForm[1]) as FormData).get("amount"), "5");
  const row = command();
  const { store, records } = memory([row, { ...command(), userId: "user-b" }]);
  let writes = 0;
  let confirmations = 0;
  const receipts = new Map<string, { success: boolean }>();
  const send = async (entry: SavedCommand) => {
    if (!receipts.has(entry.id)) { writes++; receipts.set(entry.id, { success: true }); throw new Error("lost response after commit"); }
    return { outcome: "confirmed" as const, result: receipts.get(entry.id)! };
  };
  await drainCommands(store, "user-a", send, () => true, () => confirmations++);
  assert.equal(records.get(row.id)!.status, "pending");
  assert.equal(canCancel(records.get(row.id)!), false, "a lost response cannot be treated as a cancelled save");
  await drainCommands(store, "user-a", send, () => true, () => confirmations++);
  assert.equal(writes, 1); assert.equal(confirmations, 1);
  assert.equal(records.get(row.id)!.status, "confirmed");
  assert.deepEqual(records.get(row.id)!.args, row.args, "confirmation retains recovery input");
  assert.equal([...records.values()].find(row => row.userId === "user-b")!.attempts, 0, "another account is never synced");

  const failed = command(); const next = command();
  const failure = memory([failed, next]);
  await drainCommands(failure.store, "user-a", async entry => entry.id === failed.id ? { outcome: "refused", result: { error: "Insufficient stock" } } : { outcome: "confirmed", result: { success: true } }, () => true, () => {});
  assert.equal(failure.records.get(failed.id)!.status, "failed");
  assert.equal(failure.records.get(next.id)!.status, "confirmed");
  assert.equal(unresolved(failure.records.get(failed.id)!), true);
  assert.equal(canCancel(failure.records.get(failed.id)!), true);

  const leased = { ...command(), status: "syncing" as const, updatedAt: 100, attempts: 1 };
  const crash = memory([leased, command()]);
  let calls = 0;
  const confirmed = async () => { calls++; return { outcome: "confirmed" as const, result: { success: true } }; };
  await drainCommands(crash.store, "user-a", confirmed, () => true, () => {}, () => 101);
  assert.equal(calls, 0, "a second tab respects an active lease and FIFO order");
  await drainCommands(crash.store, "user-a", confirmed, () => true, () => {}, () => 101 + SYNC_LEASE_MS);
  assert.equal(calls, 2, "a reopened tab recovers an abandoned lease");

  const broken = memory([command()]);
  broken.store.change = async () => { throw new Error("Disk full"); };
  await assert.rejects(drainCommands(broken.store, "user-a", confirmed, () => true, () => {}), /Disk full/);
  assert.equal(calls, 2, "no network write starts when the durable transition fails");
  let prevented = false;
  const event = { preventDefault: () => { prevented = true; }, returnValue: "unchanged" } as unknown as BeforeUnloadEvent;
  warnBeforeUnload(event, false); assert.equal(prevented, false);
  warnBeforeUnload(event, true); assert.equal(prevented, true); assert.equal(event.returnValue, "");
  console.log("durable work checks passed: transport types, permanent drafts, replay identity, lost response, account isolation, refusal recovery, lease recovery, storage failure and unload warning");
}
void main();
