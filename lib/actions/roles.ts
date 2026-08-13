"use server";

import { eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { roles, permissions, rolePermissions, userRoles } from "@/lib/db/schema";
import { getSession, invalidateSessions } from "@/lib/auth/session";
import { requirePermission } from "@/lib/auth/permissions";
import { guard, DUPLICATE, type ActionResult } from "@/lib/actions/guard";
import { recordAudit } from "@/lib/actions/audit";

export interface RoleListItem {
  id: string;
  name: string;
  permissionCount: number;
  userCount: number;
}

export async function listRoles(): Promise<RoleListItem[]> {
  const session = await getSession();
  requirePermission(session, "roles", "view");

  // One query: each role with how many permissions it grants and how many users
  // hold it. Left joins so a role with neither still shows up as zero.
  const rows = await db
    .select({
      id: roles.id,
      name: roles.name,
      permissionCount: sql<number>`count(distinct ${rolePermissions.permissionId})::int`,
      userCount: sql<number>`count(distinct ${userRoles.userId})::int`,
    })
    .from(roles)
    .leftJoin(rolePermissions, eq(rolePermissions.roleId, roles.id))
    .leftJoin(userRoles, eq(userRoles.roleId, roles.id))
    .groupBy(roles.id, roles.name)
    .orderBy(roles.name);

  return rows;
}

// The fixed module/action catalogue, grouped for the checkbox grid: one row per
// module, one column per action. Actions are ordered the way they read as a
// workflow (view before create before the rest) rather than alphabetically.
const ACTION_ORDER = ["view", "create", "edit", "delete", "approve", "export"];

export interface PermissionCatalog {
  // Every action that appears anywhere, in workflow order — the grid's columns.
  actions: string[];
  // One entry per module, with the set of actions that module actually supports
  // (not every module has approve/export), for the grid's rows.
  modules: { module: string; actions: string[] }[];
}

export async function getPermissionCatalog(): Promise<PermissionCatalog> {
  const session = await getSession();
  requirePermission(session, "roles", "view");

  const all = await db.select().from(permissions);

  const order = (a: string) => {
    const i = ACTION_ORDER.indexOf(a);
    return i === -1 ? ACTION_ORDER.length : i;
  };

  const byModule = new Map<string, Set<string>>();
  const actionSet = new Set<string>();
  for (const p of all) {
    actionSet.add(p.action);
    (byModule.get(p.module) ?? byModule.set(p.module, new Set()).get(p.module)!).add(p.action);
  }

  return {
    actions: [...actionSet].sort((a, b) => order(a) - order(b)),
    modules: [...byModule.entries()]
      .map(([module, actions]) => ({ module, actions: [...actions].sort((a, b) => order(a) - order(b)) }))
      .sort((a, b) => a.module.localeCompare(b.module)),
  };
}

// The permission keys ("module.action") a role currently grants — used to
// pre-tick the grid when editing.
export async function getRolePermissionKeys(roleId: string): Promise<string[]> {
  const session = await getSession();
  requirePermission(session, "roles", "view");

  const rows = await db
    .select({ module: permissions.module, action: permissions.action })
    .from(rolePermissions)
    .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
    .where(eq(rolePermissions.roleId, roleId));

  return rows.map((r) => `${r.module}.${r.action}`);
}

// The grid posts its ticked keys as a JSON array in a hidden field. A malformed
// one is a bad request, not a crash — JSON.parse throwing here used to take the
// whole role form down and lose every tick in it.
function readPermissionKeys(formData: FormData): string[] {
  try {
    const parsed = JSON.parse(String(formData.get("permissionKeys") ?? "[]"));
    return Array.isArray(parsed) ? parsed.filter((k): k is string => typeof k === "string") : [];
  } catch {
    return [];
  }
}

// Turns the ticked grid ("products.view", "sales.create", …) into the
// permission ids to store. Unknown keys are ignored rather than trusted.
async function idsForKeys(keys: string[]): Promise<string[]> {
  if (keys.length === 0) return [];
  const all = await db.select().from(permissions);
  const byKey = new Map(all.map((p) => [`${p.module}.${p.action}`, p.id]));
  return keys.map((k) => byKey.get(k)).filter((id): id is string => Boolean(id));
}

export async function createRole(_prevState: ActionResult | undefined, formData: FormData): Promise<ActionResult> {
  return guard(
    "Couldn't create the role.",
    async () => {
      const session = await getSession();
      requirePermission(session, "roles", "create");

      const name = String(formData.get("name") ?? "").trim();
      const keys = readPermissionKeys(formData);
      if (!name) return { error: "Role name is required." };

      const permissionIds = await idsForKeys(keys);

      await db.transaction(async (tx) => {
        const [role] = await tx.insert(roles).values({ name }).returning();
        if (permissionIds.length > 0) {
          await tx.insert(rolePermissions).values(permissionIds.map((permissionId) => ({ roleId: role.id, permissionId })));
        }
      });

      // A brand-new role changes nobody's permissions until it's assigned, but
      // keep the invalidation here too so the rule "any permission write clears
      // sessions" has no exceptions to reason about.
      invalidateSessions();
      revalidatePath("/roles");
      await recordAudit({ action: "create", entity: "role", summary: name, detail: `${permissionIds.length} permission(s)` });
      return { success: true };
    },
    { [DUPLICATE]: "Can't create — a role with this name already exists." },
  );
}

export async function updateRole(roleId: string, _prevState: ActionResult | undefined, formData: FormData): Promise<ActionResult> {
  return guard(
    "Couldn't save the role.",
    async () => {
      const session = await getSession();
      requirePermission(session, "roles", "edit");

      const name = String(formData.get("name") ?? "").trim();
      const keys = readPermissionKeys(formData);
      if (!name) return { error: "Role name is required." };

      const permissionIds = await idsForKeys(keys);

      await db.transaction(async (tx) => {
        await tx.update(roles).set({ name }).where(eq(roles.id, roleId));
        // Replace the whole set rather than diffing — the grid submits the full
        // desired state, so delete-all + insert is simpler and can't drift.
        await tx.delete(rolePermissions).where(eq(rolePermissions.roleId, roleId));
        if (permissionIds.length > 0) {
          await tx.insert(rolePermissions).values(permissionIds.map((permissionId) => ({ roleId, permissionId })));
        }
      });

      // Permissions changed for everyone holding this role — drop cached
      // sessions so the change takes effect on their next request, not their
      // next login.
      invalidateSessions();
      revalidatePath("/roles");
      await recordAudit({ action: "update", entity: "role", entityId: roleId, summary: name, detail: `${permissionIds.length} permission(s)` });
      return { success: true };
    },
    { [DUPLICATE]: "Can't save — a role with this name already exists." },
  );
}

export async function deleteRole(_prevState: ActionResult | undefined, formData: FormData): Promise<ActionResult> {
  return guard("Couldn't delete the role.", async () => {
    const session = await getSession();
    requirePermission(session, "roles", "edit");

    const roleId = String(formData.get("roleId") ?? "");

    // Refuse if anyone still holds it — deleting would silently strip their
    // access. The user has to reassign those users first.
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(userRoles)
      .where(eq(userRoles.roleId, roleId));
    if (count > 0) return { error: `Can't delete — ${count} user(s) still have this role. Reassign them first.` };

    await db.transaction(async (tx) => {
      await tx.delete(rolePermissions).where(eq(rolePermissions.roleId, roleId));
      await tx.delete(roles).where(eq(roles.id, roleId));
    });

    invalidateSessions();
    revalidatePath("/roles");
    await recordAudit({ action: "delete", entity: "role", entityId: roleId, summary: roleId });
    return { success: true };
  });
}


