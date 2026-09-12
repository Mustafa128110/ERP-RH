"use client";
import { COMMAND_EVENT, canonicalJson, type SavedCommand } from "@/lib/command-protocol";
import { commandInputHash, compactionCandidates } from "@/lib/command-compaction";

const DATABASE = "erp-work-v1";
let opening: Promise<IDBDatabase> | undefined;
function open(): Promise<IDBDatabase> {
  return opening ??= new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") { reject(new Error("This browser cannot store work offline.")); return; }
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => {
      const commands = request.result.createObjectStore("commands", { keyPath: "id" });
      commands.createIndex("userId", "userId");
      request.result.createObjectStore("metadata");
    };
    request.onerror = () => { opening = undefined; reject(request.error); };
    request.onblocked = () => { opening = undefined; reject(new Error("Close older ERP tabs to open saved work.")); };
    request.onsuccess = () => {
      request.result.onversionchange = () => { request.result.close(); opening = undefined; };
      resolve(request.result);
    };
  });
}
async function transaction<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore, complete: (value: T) => void) => void): Promise<T> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("commands", mode, mode === "readwrite" ? { durability: "strict" } : undefined);
    let value: T;
    tx.oncomplete = () => { if (mode === "readwrite") changed(); resolve(value); };
    tx.onabort = () => reject(tx.error ?? new Error("The browser could not preserve this work."));
    tx.onerror = () => reject(tx.error ?? new Error("Storage is full or blocked."));
    try { run(tx.objectStore("commands"), (result) => { value = result; }); } catch (error) { tx.abort(); reject(error); }
  });
}
let channel: BroadcastChannel | undefined;
function changed() {
  window.dispatchEvent(new Event(COMMAND_EVENT));
  if (typeof BroadcastChannel !== "undefined") {
    channel ??= new BroadcastChannel("erp-work");
    channel.postMessage("changed");
  }
}
export function subscribeCommands(listener: () => void): () => void {
  window.addEventListener(COMMAND_EVENT, listener);
  const otherTabs = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("erp-work") : null;
  if (otherTabs) otherTabs.onmessage = listener;
  return () => { window.removeEventListener(COMMAND_EVENT, listener); otherTabs?.close(); };
}
export function listCommands(userId: string): Promise<SavedCommand[]> {
  return transaction("readonly", (store, done) => {
    const request = store.index("userId").getAll(userId);
    request.onsuccess = () => done((request.result as SavedCommand[]).sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id)));
  });
}
export async function addCommand(command: SavedCommand): Promise<void> {
  const inputHash = await commandInputHash(command.args);
  return transaction("readwrite", (store, done) => {
    const request = store.get(command.id);
    request.onsuccess = () => {
      const prior = request.result as SavedCommand | undefined;
      if (!prior) store.add(command);
      else if (prior.userId !== command.userId || prior.action !== command.action || (prior.compactedAt ? prior.inputHash !== inputHash : canonicalJson(prior.args) !== canonicalJson(command.args))) {
        store.transaction.abort();
        return;
      }
      done(undefined);
    };
  });
}
export async function compactConfirmedCommands(userId: string, now = Date.now()): Promise<number> {
  const candidates = compactionCandidates(await listCommands(userId), now);
  if (!candidates.length) return 0;
  // Hash outside the IndexedDB transaction: awaiting WebCrypto inside it would
  // let the browser auto-commit before the compacted records were written.
  const hashes = await Promise.all(candidates.map(row => commandInputHash(row.args)));
  return transaction("readwrite", (store, done) => {
    let count = 0;
    candidates.forEach((candidate, index) => {
      const request = store.get(candidate.id);
      request.onsuccess = () => {
        const current = request.result as SavedCommand | undefined;
        if (current?.userId === userId && current.status === "confirmed" && !current.compactedAt && current.updatedAt === candidate.updatedAt && canonicalJson(current.args) === canonicalJson(candidate.args)) {
          store.put({ ...current, args: [], inputHash: hashes[index], compactedAt: now });
          count++;
        }
        done(count);
      };
    });
  });
}
export function changeCommand(userId: string, id: string, change: (entry: SavedCommand) => SavedCommand): Promise<SavedCommand | undefined> {
  return transaction("readwrite", (store, done) => {
    const read = store.get(id);
    read.onsuccess = () => {
      const entry = read.result as SavedCommand | undefined;
      if (entry?.userId !== userId) { done(undefined); return; }
      const next = change(entry);
      if (next !== entry) store.put(next);
      done(next);
    };
  });
}
export async function requestWorkPersistence(): Promise<void> {
  await navigator.storage?.persist?.().catch(() => false);
}
