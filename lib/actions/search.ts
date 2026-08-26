"use server";

import { getSession } from "@/lib/auth/session";
import { PermissionError } from "@/lib/auth/permissions";
import { getScopeCompanyIds } from "@/lib/auth/scope";
import { searchRows } from "@/lib/queries/search";
import { SEARCH_HREF, type SearchHit, type SearchKind } from "@/lib/search-constants";
import { parseGlobalSearch } from "@/lib/search-query";

// What the box in the top bar searches. It was a plain <input> that did nothing
// at all — the one control on every screen, wired to nothing.
//
// This file is only the session half: who is asking, which companies they can
// see, and whether they may be shown users and roles. The statement itself is
// in lib/queries/search.ts so it can be checked without a session, and the
// types and lookup tables are in lib/search-constants.ts because this module is
// "use server" and may export nothing but async functions.

export async function globalSearch(query: string): Promise<SearchHit[]> {
  const session = await getSession();
  if (!session) throw new PermissionError("Not authenticated");

  const parsed = parseGlobalSearch(query);
  const q = parsed.term;
  // One character matches most of the catalogue — that's a table scan rendered
  // as a dropdown, not a search.
  if (q.length < 2) return [];

  // Module-level gate for the administration branches. Deliberately the "in any
  // company they can act in" form: the top bar has no company selected, so this
  // is the same question the sidebar asks when deciding to show a link.
  const can = (moduleName: string, action: string) => {
    const key = `${moduleName}.${action}`;
    if (session.globalPermissions.has(key)) return true;
    for (const set of session.permissionsByCompany.values()) if (set.has(key)) return true;
    return false;
  };

  const scope = await getScopeCompanyIds();
  const rows = await searchRows(scope, q, { users: can("users", "view"), roles: can("roles", "view") }, parsed.kind);

  return rows.map((r) => {
    const kind = r.kind as SearchKind;
    return {
      kind,
      id: r.id,
      title: r.title,
      subtitle: r.subtitle ?? "",
      href: SEARCH_HREF[kind](r.id),
    };
  });
}
