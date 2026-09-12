import "server-only";
import { database } from "./index";
import { commandContext } from "./command-context";

// Detail reads invoked by server-rendered pages need the same consistency as
// /api/commands reads. Reuse an existing snapshot instead of nesting one.
export function withReadSnapshot<T>(read: () => Promise<T>): Promise<T> {
  if (commandContext.getStore()) return read();
  return database.transaction(tx => commandContext.run({ database: tx, afterCommit: [] }, read), { isolationLevel: "repeatable read", accessMode: "read only" });
}
