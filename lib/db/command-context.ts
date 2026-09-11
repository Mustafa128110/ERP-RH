import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type * as schema from "./schema";
export type CommandContext = { database: PostgresJsDatabase<typeof schema>; afterCommit: (() => Promise<unknown>)[] };
export const commandContext = new AsyncLocalStorage<CommandContext>();
export function deferUntilCommit(work: () => Promise<unknown>): boolean {
  const context = commandContext.getStore();
  if (!context) return false;
  context.afterCommit.push(work);
  return true;
}
