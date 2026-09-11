import "server-only";
import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type * as schema from "./db/schema";
import { canonicalJson, type SavedCommand } from "./command-protocol";

export class ReceiptConflict extends Error {}
export async function withCommandReceipt<T extends object>(tx: PostgresJsDatabase<typeof schema>, command: Pick<SavedCommand, "id" | "action" | "args" | "revisions">, userId: string, work: () => Promise<T>): Promise<T> {
  const hash = createHash("sha256").update(canonicalJson({ action: command.action, args: command.args, revisions: command.revisions ?? {} })).digest("hex");
  const inserted = await tx.execute(sql`INSERT INTO command_receipts (id, user_id, action, payload_hash) VALUES (${command.id}::uuid, ${userId}::uuid, ${command.action}, ${hash}) ON CONFLICT DO NOTHING RETURNING id`);
  if (!inserted.length) {
    const [prior] = await tx.execute<{ user_id: string; payload_hash: string; result: T }>(sql`SELECT user_id, payload_hash, result FROM command_receipts WHERE id = ${command.id}::uuid`);
    if (!prior || prior.user_id !== userId || prior.payload_hash !== hash || prior.result === null) throw new ReceiptConflict("This save ID belongs to different input. Review the saved entry.");
    return prior.result;
  }
  const result = await work();
  await tx.execute(sql`UPDATE command_receipts SET result = ${JSON.stringify(result)}::jsonb WHERE id = ${command.id}::uuid`);
  return result;
}
