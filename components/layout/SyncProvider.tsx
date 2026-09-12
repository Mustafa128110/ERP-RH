"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, useSyncExternalStore, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useClientUserId, getClientUserId } from "@/lib/client-user";
import { addCommand, changeCommand, compactConfirmedCommands, listCommands, subscribeCommands } from "@/lib/command-store";
import { localWritesPending, queueBackgroundAction, setPendingCommandCount } from "@/lib/background-client";
import { encodeArgument, unresolved, type SavedCommand } from "@/lib/command-protocol";
import { canCancel, drainCommands, warnBeforeUnload, type CommandReply } from "@/lib/command-sync";
import { createLocalOutboxStore, type OutboxKind, type OutboxEntry } from "@/lib/outbox";
import { invalidateClientCache } from "@/lib/client-cache";
import { noteOfflineCacheInvalidated } from "@/lib/offline-readiness";
import { DRAFT_STATUS_EVENT, draftStorageFailures } from "@/lib/draft";

type Entry = Omit<OutboxEntry, "kind"> & { kind: string };
type Context = {
  online: boolean; entries: Entry[]; commands: SavedCommand[]; syncing: boolean;
  cancelled: (Entry & { cancelledAt: number })[]; storageWarning: string | null;
  enqueue: (kind: OutboxKind, label: string, payload: unknown) => Promise<{ persisted: boolean }>;
  retry: (id: string) => void; cancel: (id: string) => void; restore: (id: string) => void;
  deleteCancelled: (id: string) => void; syncNow: () => void;
};
const SyncContext = createContext<Context | null>(null);
const store = { list: listCommands, change: changeCommand };
function subscribeOnline(listener: () => void) {
  window.addEventListener("online", listener); window.addEventListener("offline", listener);
  return () => { window.removeEventListener("online", listener); window.removeEventListener("offline", listener); };
}
function onlineSnapshot() { return navigator.onLine; }
function serverOnline() { return true; }
function legacyArgs(kind: OutboxKind, payload: unknown, id: string): { action: string; args: unknown[] } {
  if (kind === "quotation") {
    const form = new FormData();
    for (const [key, value] of Object.entries(payload as Record<string, unknown>)) form.set(key, String(value ?? ""));
    form.set("operationId", id);
    return { action: "quotations.createQuotation", args: [null, form] };
  }
  return { action: kind === "expense" ? "expenses.createExpensesBatch" : "payments.createPaymentsBatch", args: [payload, id] };
}
function asEntry(command: SavedCommand): Entry {
  return { id: command.id, kind: command.action.split(".")[0], label: command.label, payload: command.args,
    createdAt: command.createdAt, attempts: command.attempts, status: command.status === "syncing" ? "syncing" : command.status === "failed" ? "failed" : "pending", lastError: command.error };
}
async function migrateLegacy(userId: string) {
  const old = createLocalOutboxStore(userId);
  const known = new Set((await listCommands(userId)).map(row => row.id));
  const cancelled = old.listCancelled();
  // Keep the original bytes as a recovery copy. Tombstones in IndexedDB stop
  // archived or confirmed entries being imported again on the next startup.
  for (const entry of [...old.list(), ...cancelled]) {
    if (known.has(entry.id)) continue;
    const { action, args } = legacyArgs(entry.kind, entry.payload, entry.id);
    await addCommand({ id: entry.id, userId, action, args: args.map(encodeArgument), path: "/", label: entry.label,
      version: 1, createdAt: entry.createdAt, updatedAt: Date.now(), attempts: entry.attempts,
      status: cancelled.some(row => row.id === entry.id) ? "cancelled" : entry.status === "syncing" ? "pending" : entry.status, error: entry.lastError });
    known.add(entry.id);
  }
  return old.corrupted?.() ? "Some older saved work could not be read. Its original copy has been retained in this browser." : null;
}

export function SyncProvider({ children }: { children: React.ReactNode }) {
  const userId = useClientUserId();
  const online = useSyncExternalStore(subscribeOnline, onlineSnapshot, serverOnline);
  const [commands, setCommands] = useState<SavedCommand[]>([]);
  const [queueWarning, setStorageWarning] = useState<string | null>(null);
  const [draftFailures, setDraftFailures] = useState<Record<string, boolean>>({});
  const storageWarning = queueWarning || (Object.values(draftFailures).some(Boolean) ? "This browser could not preserve a draft. Keep the form open; save it or download a copy before leaving." : null);
  const commandsRef = useRef<SavedCommand[]>([]);
  const running = useRef(false);
  const ready = useRef<string | null>(null);
  const router = useRouter();
  const [, startTransition] = useTransition();
  const warn = useCallback((error: unknown) => setStorageWarning(error instanceof Error ? error.message : "This browser could not preserve saved work. Keep this tab open."), []);
  const refresh = useCallback(async () => {
    if (!userId) return;
    const rows = await listCommands(userId);
    if (getClientUserId() !== userId) return;
    commandsRef.current = rows;
    setPendingCommandCount(rows.filter(unresolved).length);
    setCommands(rows);
  }, [userId]);
  const syncNow = useCallback(async () => {
    if (!userId || ready.current !== userId || running.current || !navigator.onLine || !commandsRef.current.some(row => row.status === "pending" || row.status === "syncing")) return;
    running.current = true;
    try {
      await drainCommands(store, userId, async command => {
        const response = await fetch("/api/commands", { method: "POST", headers: { "Content-Type": "application/json", "x-erp-command": "1" },
          body: JSON.stringify({ command }), signal: AbortSignal.timeout(30_000) });
        if (!response.ok) return { outcome: "unknown", result: { error: response.status === 401 ? "Sign in to continue syncing your saved work." : "The server could not confirm this save yet. It will be retried." } };
        const reply = await response.json() as CommandReply;
        if (!["confirmed", "refused", "unknown"].includes(reply.outcome) || !reply.result || typeof reply.result !== "object") throw new Error("Unrecognised save response");
        return reply;
      }, () => navigator.onLine && getClientUserId() === userId, () => {
        if (getClientUserId() !== userId) return;
        invalidateClientCache(); noteOfflineCacheInvalidated();
        startTransition(() => router.refresh());
      });
      await refresh();
    } catch (error) { warn(error); }
    finally { running.current = false; }
  }, [userId, refresh, router, warn]);
  useEffect(() => {
    let live = true;
    ready.current = null;
    void (async () => {
      commandsRef.current = [];
      setPendingCommandCount(0);
      setCommands([]);
      if (!userId) return;
      try {
        const migrationWarning = await migrateLegacy(userId);
        await compactConfirmedCommands(userId);
        if (!live) return;
        setStorageWarning(migrationWarning);
        ready.current = userId;
        await refresh();
        await syncNow();
      } catch (error) { if (live) warn(error); }
    })();
    return () => { live = false; ready.current = null; };
  }, [userId, refresh, syncNow, warn]);
  useEffect(() => {
    const changed = () => { void refresh().then(() => {
      if (commandsRef.current.some(row => row.status === "pending" && row.attempts === 0)) void syncNow();
    }).catch(warn); };
    const kick = () => { void syncNow(); };
    // Storage events update the UI immediately. Drain periodically as well so
    // a transient error cannot form a tight automatic retry loop.
    const unsubscribe = subscribeCommands(changed);
    window.addEventListener("online", kick); window.addEventListener("focus", kick);
    const timer = setInterval(kick, 5_000);
    const housekeeping = setInterval(() => {
      if (userId && ready.current === userId) void compactConfirmedCommands(userId).then(refresh).catch(warn);
    }, 24 * 60 * 60 * 1000);
    return () => { unsubscribe(); clearInterval(timer); clearInterval(housekeeping); window.removeEventListener("online", kick); window.removeEventListener("focus", kick); };
  }, [userId, refresh, syncNow, warn]);
  useEffect(() => {
    const draftStatus = (event: Event) => {
      const { key, failed } = (event as CustomEvent<{ key: string; failed: boolean }>).detail;
      setDraftFailures(old => old[key] === failed ? old : { ...old, [key]: failed });
    };
    window.addEventListener(DRAFT_STATUS_EVENT, draftStatus);
    // Child draft effects can run before this provider's subscription mounts.
    const failures = draftStorageFailures();
    if (failures.length) queueMicrotask(() => setDraftFailures(Object.fromEntries(failures.map(key => [key, true]))));
    return () => window.removeEventListener(DRAFT_STATUS_EVENT, draftStatus);
  }, []);
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => warnBeforeUnload(event, localWritesPending() || !!storageWarning || commandsRef.current.some(unresolved));
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [storageWarning]);
  const change = (id: string, fn: (entry: SavedCommand) => SavedCommand) => {
    if (userId) void changeCommand(userId, id, fn).then(refresh).catch(warn);
  };
  const active = commands.filter(unresolved);
  const value: Context = {
    online, commands, entries: active.map(asEntry), syncing: active.some(row => row.status === "syncing"), storageWarning,
    cancelled: commands.filter(row => row.status === "cancelled").map(row => ({ ...asEntry(row), cancelledAt: row.updatedAt })),
    enqueue: async (kind, _label, payload) => {
      const { action, args } = legacyArgs(kind, payload, crypto.randomUUID());
      const result = await queueBackgroundAction(action, args);
      if (result.error) warn(new Error(result.error));
      return { persisted: !!result.queued };
    },
    retry: id => change(id, row => row.status === "failed" ? { ...row, status: "pending", error: undefined, updatedAt: Date.now() } : row),
    cancel: id => change(id, row => canCancel(row) ? { ...row, status: "cancelled", updatedAt: Date.now() } : row),
    restore: id => change(id, row => row.status === "cancelled" ? { ...row, status: "pending", updatedAt: Date.now() } : row),
    deleteCancelled: id => change(id, row => row.status === "cancelled" ? { ...row, status: "discarded", args: [], label: "Deleted saved input", updatedAt: Date.now() } : row),
    syncNow: () => { void syncNow(); },
  };
  return <SyncContext.Provider value={value}>{children}</SyncContext.Provider>;
}
export function useSync(): Context {
  const value = useContext(SyncContext);
  if (!value) throw new Error("useSync must be used inside <SyncProvider>");
  return value;
}
