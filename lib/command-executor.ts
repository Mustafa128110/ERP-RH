import "server-only";
import { sql } from "drizzle-orm";
import { database } from "@/lib/db";
import { commandContext, type CommandContext } from "@/lib/db/command-context";
import { commandActions, commandReads } from "@/lib/command-registry";
import { decodeArgument, type SavedCommand, type CommandValue } from "@/lib/command-protocol";
import { withCommandReceipt, ReceiptConflict } from "@/lib/command-receipt";
import { tableForCommand } from "@/lib/command-tables";
import type { CommandReply } from "@/lib/command-sync";

type Result = { error?: string; success?: boolean; needsConfirmation?: boolean; [key: string]: unknown };
class Refused extends Error { constructor(public result: Result) { super(result.error ?? "Save refused"); } }
const uuid = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;
function idsIn(value: unknown, ids = new Set<string>()): Set<string> {
  if (Array.isArray(value)) for (const v of value) idsIn(v, ids);
  else if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (typeof record.id === "string" && uuid.test(record.id)) ids.add(record.id);
    for (const v of Object.values(record)) if (v && typeof v === "object") idsIn(v, ids);
  }
  return ids;
}
export async function executeRead(action: string, args: CommandValue[]) {
  if (!Object.hasOwn(commandReads, action)) throw new Error("Unknown read");
  const work = commandReads[action as keyof typeof commandReads] as (...args: unknown[]) => Promise<unknown>;
  return database.transaction(async (tx) => commandContext.run({ database: tx, afterCommit: [] }, async () => {
    const result = await work(...args.map(decodeArgument));
    const table = tableForCommand(action);
    const ids = [...idsIn(result)].slice(0, 2000);
    let revisions: Record<string, string> = {};
    if (table && ids.length) {
      const rows = await tx.execute<{ id: string; revision: string }>(sql`SELECT id, xmin::text AS revision FROM ${sql.identifier(table)} WHERE id IN (${sql.join(ids.map(id => sql`${id}::uuid`), sql`, `)})`);
      revisions = Object.fromEntries(rows.map(row => [`${table}:${row.id}`, row.revision]));
    }
    return { result, revisions };
  }), { isolationLevel: "repeatable read", accessMode: "read only" });
}
export async function executeCommand(command: SavedCommand, userId: string): Promise<CommandReply> {
  if (!Object.hasOwn(commandActions, command.action) || command.version !== 1 || !uuid.test(command.id)) return { outcome: "refused", result: { error: "This saved operation is not supported by this app version." } };
  if (command.userId !== userId) return { outcome: "unknown", result: { error: "Sign in as the account that saved this work before syncing it." } };
  const afterCommit: CommandContext["afterCommit"] = [];
  try {
    const result = await database.transaction(async (tx) => withCommandReceipt(tx, command, userId, async () => {
      // The claim, action writes, audit rows and canonical result commit together.
      const table = tableForCommand(command.action);
      const expected = Object.entries(command.revisions ?? {}).filter(([key]) => table && key.startsWith(`${table}:`));
      if (table && expected.length) {
        const ids = expected.map(([key]) => key.slice(table.length + 1));
        if (ids.some(id => !uuid.test(id))) throw new Refused({ error: "Invalid record revision." });
        const current = await tx.execute<{ id: string; revision: string }>(sql`SELECT id, xmin::text AS revision FROM ${sql.identifier(table)} WHERE id IN (${sql.join(ids.map(id => sql`${id}::uuid`), sql`, `)}) ORDER BY id FOR UPDATE`);
        const versions = new Map(current.map(row => [`${table}:${row.id}`, row.revision]));
        if (expected.some(([key, revision]) => versions.get(key) !== revision)) throw new Refused({ error: "This record changed after you opened it. Your input is preserved; open the latest record and review your changes." });
      }
      const work = commandActions[command.action as keyof typeof commandActions] as (...args: unknown[]) => Promise<Result>;
      const response = await commandContext.run({ database: tx, afterCommit }, () => work(...command.args.map(decodeArgument)));
      if (response?.error) {
        throw new Refused(response);
      }
      const canonical = response ?? { success: true };
      return canonical;
    }));
    await Promise.allSettled(afterCommit.map(work => work()));
    return { outcome: "confirmed", result };
  } catch (error) {
    if (error instanceof Refused) return { outcome: "refused", result: error.result };
    if (error instanceof ReceiptConflict) return { outcome: "refused", result: { error: error.message } };
    throw error;
  }
}
