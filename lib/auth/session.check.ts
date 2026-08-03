import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users, userRoles, roles, rolePermissions, permissions, userCompanyAccess, userWarehouseAccess } from "@/lib/db/schema";
import { sessionQuery } from "@/lib/db/session-query";

// Equivalence check for the single-query session load. The old version issued a
// profile lookup plus four follow-ups; this asserts the one query that replaced
// them returns the same thing, for every user in the table.
//
//   npx tsx --conditions=react-server --env-file=.env lib/auth/session.check.ts
//
// (--conditions=react-server makes the `server-only` import resolve to a no-op
// outside Next, which is exactly what it is on the server.)

async function legacyLoad(userId: string) {
  const [roleRows, permissionRows, companyRows, warehouseRows] = await Promise.all([
    db.select({ name: roles.name }).from(userRoles).innerJoin(roles, eq(roles.id, userRoles.roleId)).where(eq(userRoles.userId, userId)),
    db
      .select({ companyId: userRoles.companyId, module: permissions.module, action: permissions.action })
      .from(userRoles)
      .innerJoin(rolePermissions, eq(rolePermissions.roleId, userRoles.roleId))
      .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
      .where(eq(userRoles.userId, userId)),
    db.select({ companyId: userCompanyAccess.companyId }).from(userCompanyAccess).where(eq(userCompanyAccess.userId, userId)),
    db.select({ locationId: userWarehouseAccess.locationId }).from(userWarehouseAccess).where(eq(userWarehouseAccess.userId, userId)),
  ]);

  const global = new Set<string>();
  const byCompany = new Map<string, Set<string>>();
  for (const r of permissionRows) {
    const key = `${r.module}.${r.action}`;
    if (r.companyId === null) global.add(key);
    else byCompany.set(r.companyId, (byCompany.get(r.companyId) ?? new Set()).add(key));
  }

  return {
    roleNames: [...new Set(roleRows.map((r) => r.name))].sort(),
    global: [...global].sort(),
    byCompany: [...byCompany.entries()].map(([c, s]) => [c, [...s].sort()] as const).sort(),
    companyIds: companyRows.map((c) => c.companyId).sort(),
    warehouseIds: warehouseRows.map((w) => w.locationId).sort(),
  };
}

async function fromSingleQuery(authId: string) {
  const [row] = await sessionQuery(authId);
  assert.ok(row, `sessionQuery returned no row for auth id ${authId}`);

  const global = new Set<string>();
  const byCompany = new Map<string, Set<string>>();
  for (const { companyId, key } of row.perms) {
    if (companyId === null) global.add(key);
    else byCompany.set(companyId, (byCompany.get(companyId) ?? new Set()).add(key));
  }

  return {
    row,
    shaped: {
      roleNames: [...new Set(row.role_names)].sort(),
      global: [...global].sort(),
      byCompany: [...byCompany.entries()].map(([c, s]) => [c, [...s].sort()] as const).sort(),
      companyIds: [...row.company_ids].sort(),
      warehouseIds: [...row.warehouse_ids].sort(),
    },
  };
}

async function main() {
  const allUsers = await db.select().from(users);
  assert.ok(allUsers.length > 0, "no users in the database to check against");

  for (const u of allUsers) {
    const { row, shaped } = await fromSingleQuery(u.supabaseAuthId);
    const legacy = await legacyLoad(u.id);

    assert.equal(row.id, u.id, "id mismatch");
    assert.equal(row.email, u.email, "email mismatch");
    assert.equal(row.status, u.status, "status mismatch");
    assert.deepEqual(shaped, legacy, `session data mismatch for ${u.email}`);

    console.log(
      `ok  ${u.email}  roles=${shaped.roleNames.length} global=${shaped.global.length} ` +
        `scoped=${shaped.byCompany.length} companies=${shaped.companyIds.length} warehouses=${shaped.warehouseIds.length}`,
    );
  }

  // An unknown auth id must produce no row, not throw and not leak someone else's.
  assert.equal((await sessionQuery("00000000-0000-0000-0000-000000000000")).length, 0, "unknown auth id returned a row");
  console.log("ok  unknown auth id returns no row");

  console.log(`\nall checks passed (${allUsers.length} user(s))`);
  process.exit(0);
}

main();
