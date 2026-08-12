"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { users, userRoles, roles, companies } from "@/lib/db/schema";
import { getSession, invalidateSessions } from "@/lib/auth/session";
import { requirePermission } from "@/lib/auth/permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { guard, describeDbError, type ActionResult } from "@/lib/actions/guard";
import { recordAudit } from "@/lib/actions/audit";

export interface UserListItem {
  id: string;
  name: string;
  email: string;
  status: string;
  roleAssignments: { roleName: string; companyName: string | null }[];
}

export async function listUsers(): Promise<UserListItem[]> {
  const session = await getSession();
  requirePermission(session, "users", "view");

  const [userRows, assignmentRows] = await Promise.all([
    db.select().from(users),
    db
      .select({ userId: userRoles.userId, roleName: roles.name, companyName: companies.name })
      .from(userRoles)
      .innerJoin(roles, eq(roles.id, userRoles.roleId))
      .leftJoin(companies, eq(companies.id, userRoles.companyId)),
  ]);

  return userRows.map((u) => ({
    id: u.id,
    name: u.name,
    email: u.email,
    status: u.status,
    roleAssignments: assignmentRows
      .filter((a) => a.userId === u.id)
      .map((a) => ({ roleName: a.roleName, companyName: a.companyName })),
  }));
}

export async function getUserDetail(userId: string) {
  const session = await getSession();
  requirePermission(session, "users", "view");

  const [[user], assignments] = await Promise.all([
    db.select().from(users).where(eq(users.id, userId)).limit(1),
    db
      .select({ id: userRoles.id, roleId: userRoles.roleId, roleName: roles.name, companyId: userRoles.companyId, companyName: companies.name })
      .from(userRoles)
      .innerJoin(roles, eq(roles.id, userRoles.roleId))
      .leftJoin(companies, eq(companies.id, userRoles.companyId))
      .where(eq(userRoles.userId, userId)),
  ]);
  if (!user) return null;

  return { user, assignments };
}

export interface UserBatchRow {
  name: string;
  email: string;
  password: string;
  roleId: string;
  companyId: string | null;
}

// Each row needs its own Supabase Auth account — unlike every other batch
// action here, this can't collapse into one bulk INSERT, so rows are created
// independently and a row's failure (e.g. duplicate email) doesn't block the
// rest of the batch.
export async function createUsersBatch(rows: UserBatchRow[]): Promise<ActionResult> {
  return guard("Couldn't create the users.", async () => {
    const session = await getSession();
    requirePermission(session, "users", "create");

    const valid = rows.filter((r) => r.name.trim() && r.email.trim() && r.password && r.roleId);
    if (valid.length === 0) return { error: "Add at least one user with a name, email, password, and role." };

    const admin = createAdminClient();
    const failures: string[] = [];
    let created = 0;

    await Promise.all(
      valid.map(async (r) => {
        const { data, error } = await admin.auth.admin.createUser({ email: r.email, password: r.password, email_confirm: true });
        if (error || !data.user) {
          failures.push(`${r.email}: ${error?.message ?? "failed"}`);
          return;
        }
        try {
          // Profile and role assignment in one transaction. Written as two bare
          // statements (which is how this was), a failure on the second left a
          // user who could sign in and then see nothing at all — no role, no
          // company, no way to tell from the users list that anything was wrong.
          await db.transaction(async (tx) => {
            const [profile] = await tx.insert(users).values({ supabaseAuthId: data.user.id, name: r.name, email: r.email }).returning();
            await tx.insert(userRoles).values({ userId: profile.id, roleId: r.roleId, companyId: r.companyId });
          });
          created += 1;
        } catch (e) {
          // The Supabase account exists but its profile doesn't, and a login
          // with no profile is rejected by getSession(). Remove the account so
          // the row can simply be retried rather than half-existing forever.
          await admin.auth.admin.deleteUser(data.user.id).catch(() => {});
          failures.push(`${r.email}: ${describeDbError(e, "couldn't be saved")}`);
        }
      }),
    );

    revalidatePath("/users");
    // Reported per row on purpose: each user is independent, so one duplicate
    // email must not throw away the other nineteen that were fine.
    if (failures.length > 0) {
      return { error: `${created} of ${valid.length} created. Failed: ${failures.join("; ")}` };
    }
    return { success: true };
  });
}

export async function updateUser(userId: string, _prevState: ActionResult | undefined, formData: FormData): Promise<ActionResult> {
  return guard("Couldn't save the user.", async () => {
    const session = await getSession();
    requirePermission(session, "users", "edit");

    const name = String(formData.get("name") ?? "").trim();
    const status = String(formData.get("status") ?? "active") as "active" | "inactive" | "locked";
    if (!name) return { error: "Name is required." };

    await db.update(users).set({ name, status }).where(eq(users.id, userId));
    // Status is what getSession() gates on, so a deactivation has to drop the
    // cached session rather than wait out its TTL.
    invalidateSessions();
    revalidatePath("/users");
    await recordAudit({ action: "update", entity: "user", entityId: userId, summary: name, detail: `Status ${status}` });
    return { success: true };
  });
}

export async function addUserRole(userId: string, _prevState: ActionResult | undefined, formData: FormData): Promise<ActionResult> {
  return guard("Couldn't add that role.", async () => {
    const session = await getSession();
    requirePermission(session, "users", "edit");

    const roleId = String(formData.get("roleId") ?? "");
    const companyIdRaw = String(formData.get("companyId") ?? "");
    const companyId = companyIdRaw === "" || companyIdRaw === "global" ? null : companyIdRaw;
    if (!roleId) return { error: "Pick a role." };

    await db.insert(userRoles).values({ userId, roleId, companyId }).onConflictDoNothing();
    invalidateSessions();
    revalidatePath("/users");
    await recordAudit({ action: "update", entity: "user role", entityId: userId, summary: `Role granted`, companyId });
    return { success: true };
  });
}

export async function removeUserRole(formData: FormData): Promise<ActionResult> {
  return guard("Couldn't remove that role.", async () => {
    const session = await getSession();
    requirePermission(session, "users", "edit");

    const assignmentId = String(formData.get("assignmentId") ?? "");
    await db.delete(userRoles).where(eq(userRoles.id, assignmentId));
    invalidateSessions();
    revalidatePath("/users");
    await recordAudit({ action: "delete", entity: "user role", summary: `Role assignment removed` });
    return { success: true };
  });
}

export async function deleteUser(_prevState: ActionResult | undefined, formData: FormData): Promise<ActionResult> {
  return guard("Couldn't delete this user — it may still be referenced elsewhere.", async () => {
    const session = await getSession();
    requirePermission(session, "users", "delete");

    const userId = String(formData.get("userId") ?? "");
    if (userId === session.userId) {
      return { error: "You can't delete your own account." };
    }

    const [target] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (target) {
      // Profile row first. The reverse order — which is how this ran — deletes
      // the Supabase account and then discovers the profile can't go because a
      // document still references it, leaving a profile whose identity is gone:
      // unable to sign in, and undeletable through this same path ever after.
      await db.delete(users).where(eq(users.id, userId));
      const admin = createAdminClient();
      await admin.auth.admin.deleteUser(target.supabaseAuthId);
    }

    invalidateSessions();
    revalidatePath("/users");
    await recordAudit({ action: "delete", entity: "user", entityId: userId, summary: target?.name ?? userId, detail: target?.email });
    return { success: true };
  });
}
