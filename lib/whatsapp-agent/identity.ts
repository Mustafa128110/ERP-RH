import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import { sessionByWhatsAppNumber } from "@/lib/db/session-query";
import type { AuthSession } from "@/lib/auth/session";

// Who the ERP thinks is talking, when the talking happens over WhatsApp.
//
// Every mutation in this codebase begins with `getSession()` and
// `requirePermission(...)`, and that is exactly what we want the agent to be
// subject to. But `getSession()` reads a Supabase cookie, and a webhook POST
// from Meta carries none. Rather than give the agent its own parallel set of
// write paths — which would be a second copy of stock movements, ledger
// entries, numbering and audit, guaranteed to drift from the real ones — the
// session itself is carried in an AsyncLocalStorage, and `getSession()` returns
// it when it is set. The agent then calls `createSale()` exactly like the sales
// page does.
//
// The security of this rests on three things, all of them here:
//
//  1. The store is only ever filled by `sessionForWhatsAppNumber()`, which
//     requires a row in `users.whatsapp_number` with status 'active'. There is
//     no way to construct an arbitrary session.
//  2. The resulting session is the real one — same roles, same companies, same
//     permission sets, from the same SQL. It is an authentication shortcut, not
//     an authorisation one; a salesman messaging the bot still cannot delete an
//     invoice.
//  3. `runAsUser` is scoped to one message. Nothing outside its callback sees it.
const store = new AsyncLocalStorage<AuthSession>();

// Read by lib/auth/session.ts and lib/auth/scope.ts, ahead of their per-request
// memoisation. Ahead of it deliberately: one webhook POST can carry messages
// from two different senders, and a memoised session would hand the second
// sender the first one's permissions.
export function agentSession(): AuthSession | null {
  return store.getStore() ?? null;
}

export function runAsUser<T>(session: AuthSession, run: () => Promise<T>): Promise<T> {
  return store.run(session, run);
}

// Null for an unknown or deactivated number. The caller replies with nothing at
// all in that case — this is a business number that strangers message, and even
// "you are not authorised" confirms there is something here to get into.
export async function sessionForWhatsAppNumber(phone: string): Promise<AuthSession | null> {
  const digits = phone.replace(/\D/g, "");
  if (!digits) return null;

  const [row] = await sessionByWhatsAppNumber(digits);
  if (!row || row.status !== "active") return null;

  const globalPermissions = new Set<string>();
  const permissionsByCompany = new Map<string, Set<string>>();
  for (const { companyId, key } of row.perms) {
    if (companyId === null) {
      globalPermissions.add(key);
    } else {
      const set = permissionsByCompany.get(companyId) ?? new Set<string>();
      set.add(key);
      permissionsByCompany.set(companyId, set);
    }
  }

  return {
    userId: row.id,
    supabaseAuthId: row.supabase_auth_id,
    name: row.name,
    email: row.email,
    roleNames: row.role_names,
    globalPermissions,
    permissionsByCompany,
    companyIds: row.company_ids,
    warehouseIds: row.warehouse_ids,
  };
}
