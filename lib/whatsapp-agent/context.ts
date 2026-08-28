import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import type { AuthSession } from "@/lib/auth/session";

// A Meta webhook does not carry the Supabase browser cookie.  The resolved ERP
// session lives only for the one inbound message currently being handled, so
// ordinary Server Actions can apply their usual permission and audit rules.
const store = new AsyncLocalStorage<AuthSession>();

export function agentSession(): AuthSession | null {
  return store.getStore() ?? null;
}

export function runAsWhatsAppUser<T>(session: AuthSession, run: () => Promise<T>): Promise<T> {
  return store.run(session, run);
}
