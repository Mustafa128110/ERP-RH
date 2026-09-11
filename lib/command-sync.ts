import { type SavedCommand, type CommandValue } from "./command-protocol";

export type CommandReply = { outcome: "confirmed" | "refused" | "unknown"; result: { error?: string; needsConfirmation?: boolean; [key: string]: unknown } };
export interface CommandStore {
  list(userId: string): Promise<SavedCommand[]>;
  change(userId: string, id: string, change: (entry: SavedCommand) => SavedCommand): Promise<SavedCommand | undefined>;
}
export const SYNC_LEASE_MS = 60_000;
export function canCancel(command: SavedCommand): boolean {
  // A timeout can hide a committed save. Only a definitive refusal or an
  // operation never sent can be cancelled safely.
  return command.status === "failed" || command.status === "pending" && command.attempts === 0;
}
export function warnBeforeUnload(event: BeforeUnloadEvent, pending: boolean): void {
  if (!pending) return;
  event.preventDefault();
  event.returnValue = "";
}
export async function drainCommands(store: CommandStore, userId: string, send: (entry: SavedCommand) => Promise<CommandReply>, online: () => boolean, confirmed: () => void, now = Date.now): Promise<void> {
  for (;;) {
    if (!online()) return;
    const entries = await store.list(userId);
    // Preserve submission order across tabs. A live lease blocks later work.
    const entry = entries.find(row => row.status === "pending" || row.status === "syncing");
    if (!entry || entry.status === "syncing" && now() - entry.updatedAt < SYNC_LEASE_MS) return;
    const lease = now();
    let claimed = false;
    const current = await store.change(userId, entry.id, row => {
      if (row.status !== "pending" && !(row.status === "syncing" && lease - row.updatedAt >= SYNC_LEASE_MS)) return row;
      claimed = true;
      return { ...row, status: "syncing", updatedAt: lease, attempts: row.attempts + 1 };
    });
    if (!claimed || !current) return;
    let reply: CommandReply;
    try { reply = await send(current); }
    catch { reply = { outcome: "unknown", result: { error: "Waiting for a connection to confirm this save." } }; }
    await store.change(userId, current.id, row => {
      // A newer lease owns this record now. Never undo another tab's result.
      if (row.status !== "syncing" || row.updatedAt !== lease) return row;
      return {
        ...row, updatedAt: now(),
        status: reply.outcome === "confirmed" ? "confirmed" : reply.outcome === "refused" ? "failed" : "pending",
        error: reply.result.error, needsConfirmation: reply.result.needsConfirmation,
        result: reply.outcome === "confirmed" ? reply.result as CommandValue : undefined,
      };
    });
    if (reply.outcome === "confirmed") confirmed();
    if (reply.outcome === "unknown") return;
  }
}
