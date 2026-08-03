import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { createClient } from "@supabase/supabase-js";
import { eq } from "drizzle-orm";
import { users, roles, userRoles, userCompanyAccess, companies } from "./schema";

// Standalone script (run via tsx, not through Next's build) — creates the
// Supabase Auth identity via the Admin API, then the linked `users` profile
// row, an Admin role assignment, and access to every existing company.
// Run npm run db:seed-rbac first so the Admin role exists.

async function main() {
  const email = process.argv[2];
  const password = process.argv[3];
  const name = process.argv[4] ?? email;
  if (!email || !password) {
    console.error("Usage: npx tsx --env-file=.env lib/db/seed-admin.ts <email> <password> [name]");
    process.exit(1);
  }

  const supabaseAdmin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data, error } = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error || !data.user) {
    console.error("Failed to create Supabase Auth user:", error?.message);
    process.exit(1);
  }

  // Same connection preference as lib/db/index.ts — see the note in seed-rbac.ts.
  const client = postgres(process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL!);
  const db = drizzle(client);

  const [adminRole] = await db.select().from(roles).where(eq(roles.name, "Admin")).limit(1);
  if (!adminRole) {
    console.error('Admin role not found — run "npm run db:seed-rbac" first.');
    process.exit(1);
  }

  const [profile] = await db
    .insert(users)
    .values({ supabaseAuthId: data.user.id, name, email, status: "active" })
    .returning();

  await db.insert(userRoles).values({ userId: profile.id, roleId: adminRole.id });

  const allCompanies = await db.select().from(companies);
  if (allCompanies.length > 0) {
    await db
      .insert(userCompanyAccess)
      .values(allCompanies.map((c) => ({ userId: profile.id, companyId: c.id })));
  }

  console.log(`Created Admin user "${email}" with access to ${allCompanies.length} company(ies).`);
  await client.end();
}

main();
