import "server-only";
import { sql } from "drizzle-orm";
import { db } from "./index";

// Drizzle's direct Postgres connection authenticates as a role with BYPASSRLS
// (Supabase's `postgres` role) — RLS policies against auth.uid() have zero
// effect on it. This assumes the non-bypass `app_user` role for one transaction
// so `current_setting('app.user_id', true)` resolves inside RLS policies
// (docs/phase-8-authentication.md §4). Reverts automatically at commit/rollback.
export async function withUserContext<T>(
  userId: string,
  fn: (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`set local role app_user`);
    await tx.execute(sql`select set_config('app.user_id', ${userId}, true)`);
    return fn(tx);
  });
}
