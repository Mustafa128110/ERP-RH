import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { sessionQuery } from "@/lib/db/session-query";
import { createClient } from "@/lib/supabase/server";
import { cached, invalidate, MINUTE } from "@/lib/cache";

export interface AuthSession {
  userId: string;
  supabaseAuthId: string;
  name: string;
  email: string;
  roleNames: string[];
  // Roles assigned with no company (user_roles.company_id IS NULL) — apply in
  // every company the user has access to.
  globalPermissions: Set<string>;
  // Roles assigned for one specific company — apply only when acting in that
  // company. A user's effective permissions in company X are the union of
  // globalPermissions and permissionsByCompany.get(X) (docs/phase-8-authentication.md §3).
  permissionsByCompany: Map<string, Set<string>>;
  companyIds: string[];
  warehouseIds: string[];
  // How this person wants the app to look (lib/actions/preferences.ts). Carried
  // on the session because the root layout has to know both before it renders a
  // single element, and because they arrive free with the row it already reads.
  uiTheme: "light" | "dark";
  uiScale: number;
}

// A page's own queries can't start until getSession() resolves, so this sat in
// front of every render as a serial round trip to a database ~170ms away — the
// single biggest remaining cost once the five queries behind it became one.
// Roles, company access and account status change only through the mutations in
// lib/actions/users.ts, and every one of them calls invalidateSessions(), so
// this is a cache with explicit invalidation rather than a staleness window; the
// TTL is just a backstop for anything that learns to change permissions later.
//
// ponytail: in-process Map, so it is per server instance. Correct for the single
// instance this runs on; behind a load balancer, move it to Redis or drop the
// TTL to zero and take the round trip back.
const SESSION_TTL = MINUTE;
const SESSION_KEY = "session";

export function invalidateSessions() {
  invalidate(SESSION_KEY);
}

// Cached per-request (React `cache()`, resets on the next request) — not
// per-login — so a permission change takes effect on the user's next request,
// not their next login (docs/phase-8-authentication.md §3).
export async function getSession(): Promise<AuthSession | null> {
  return getCookieSession();
}

const getCookieSession = cache(async (): Promise<AuthSession | null> => {
  const supabase = await createClient();

  // getClaims() verifies the access token locally against the project's ES256
  // JWKS (fetched once, then cached in the client), so establishing "who" costs
  // no Auth-server round trip. getUser(), which this replaced, always called out
  // to Sydney. It still refreshes the session when the token nears expiry, and
  // still rejects a forged or expired token — the signature check is real, just
  // local.
  const { data } = await supabase.auth.getClaims();
  const authId = data?.claims?.sub;
  if (!authId) return null;

  const key = `${SESSION_KEY}:${authId}`;
  const session = await cached(key, SESSION_TTL, async () => {
    const [row] = await sessionQuery(authId);
    if (!row || row.status !== "active") return null;

    const globalPermissions = new Set<string>();
    const permissionsByCompany = new Map<string, Set<string>>();
    for (const { companyId, key: permission } of row.perms) {
      if (companyId === null) {
        globalPermissions.add(permission);
      } else {
        const set = permissionsByCompany.get(companyId) ?? new Set<string>();
        set.add(permission);
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
      uiTheme: row.ui_theme,
      uiScale: row.ui_scale,
    } satisfies AuthSession;
  });

  // Deliberately no negative caching: a user who was just created or
  // reactivated must be able to sign in immediately, not in up to a minute.
  // Concurrent callers still share the in-flight lookup, they just don't keep it.
  if (!session) invalidate(key);
  return session;
});

export async function requireSession(): Promise<AuthSession> {
  const session = await getSession();
  if (!session) redirect("/login");
  return session;
}
