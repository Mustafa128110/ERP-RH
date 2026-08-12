import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
import { permissions, roles, rolePermissions } from "./schema";

// Standalone script (see seed-admin.ts for why this doesn't import lib/db/lib/auth).
// Seeds the fixed module.action permission catalog (FR-USER-002) and the two
// default roles (FR-USER-003): Admin (every permission) and Salesman (the
// exact matrix from FR-USER-003). Idempotent — safe to re-run.

const PERMISSION_CATALOG: Record<string, string[]> = {
  companies: ["view", "create", "edit", "delete"],
  products: ["view", "create", "edit", "delete"],
  categories: ["view", "create", "edit", "delete"],
  brands: ["view", "create", "edit", "delete"],
  locations: ["view", "create", "edit", "delete"],
  units: ["view", "create", "edit", "delete"],
  unit_conversions: ["view", "create", "edit", "delete"],
  taxes: ["view", "create", "edit", "delete"],
  accounts: ["view", "create", "edit", "delete"],
  cheques: ["view", "create", "edit", "delete"],
  payments: ["view", "create", "edit", "delete"],
  stock: ["view"],
  stock_adjustments: ["view", "create", "approve"],
  stock_transfers: ["view", "create", "approve"],
  purchases: ["view", "create", "edit", "delete"],
  suppliers: ["view", "create", "edit", "delete"],
  supplier_ledger: ["view"],
  sales: ["view", "create", "edit", "delete"],
  quotations: ["view", "create", "edit", "delete"],
  invoices: ["view", "create", "edit", "delete"],
  customers: ["view", "create", "edit", "delete"],
  customer_ledger: ["view"],
  expenses: ["view", "create", "edit", "delete"],
  reports: ["view", "export"],
  users: ["view", "create", "edit", "delete"],
  roles: ["view", "create", "edit"],
  settings: ["view", "edit"],
  backups: ["view", "create"],
  audit: ["view"],
};

// FR-USER-003: Create/View on Sales, Invoices, Quotations, Customers;
// View-only on Stock. Everything else (Purchases, Expenses, Supplier Ledger,
// Users/Roles, Settings) is denied by omission.
const SALESMAN_PERMISSIONS = [
  "sales.view",
  "sales.create",
  "invoices.view",
  "invoices.create",
  "quotations.view",
  "quotations.create",
  "customers.view",
  "customers.create",
  "stock.view",
];

async function upsertRole(db: ReturnType<typeof drizzle>, name: string): Promise<string> {
  await db.insert(roles).values({ name }).onConflictDoNothing();
  const [row] = await db.select().from(roles).where(eq(roles.name, name)).limit(1);
  return row.id;
}

async function main() {
  // Same connection preference as lib/db/index.ts: session mode, prepared
  // statements on (the `prepare: false` this used to carry was required by the
  // transaction pooler the app no longer connects through).
  const client = postgres(process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL!);
  const db = drizzle(client);

  const rows = Object.entries(PERMISSION_CATALOG).flatMap(([module, actions]) =>
    actions.map((action) => ({ module, action })),
  );
  await db.insert(permissions).values(rows).onConflictDoNothing();

  const allPermissions = await db.select().from(permissions);
  const permissionIds = new Map(allPermissions.map((p) => [`${p.module}.${p.action}`, p.id]));

  const adminRoleId = await upsertRole(db, "Admin");
  const salesmanRoleId = await upsertRole(db, "Salesman");

  await db.delete(rolePermissions).where(eq(rolePermissions.roleId, adminRoleId));
  await db
    .insert(rolePermissions)
    .values([...permissionIds.values()].map((permissionId) => ({ roleId: adminRoleId, permissionId })));

  await db.delete(rolePermissions).where(eq(rolePermissions.roleId, salesmanRoleId));
  await db.insert(rolePermissions).values(
    SALESMAN_PERMISSIONS.map((key) => ({
      roleId: salesmanRoleId,
      permissionId: permissionIds.get(key)!,
    })),
  );

  console.log(
    `Seeded ${permissionIds.size} permissions, Admin (all) and Salesman (${SALESMAN_PERMISSIONS.length}) roles.`,
  );
  await client.end();
}

main();
