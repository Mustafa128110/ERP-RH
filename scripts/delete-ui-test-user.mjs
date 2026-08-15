// Removes the throwaway admin user created for browser testing
// (scripts/ui-test.mjs) — app rows (users, user_roles, user_company_access) and
// the Supabase Auth identity.
// Usage: npx tsx --env-file=.env scripts/delete-ui-test-user.mjs <email>
import postgres from "postgres";
import { createClient } from "@supabase/supabase-js";

const email = process.argv[2];
if (!email) {
  console.error("Usage: npx tsx --env-file=.env scripts/delete-ui-test-user.mjs <email>");
  process.exit(1);
}

const sql = postgres(process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL, { max: 1 });
const supabaseAdmin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

try {
  const [row] = await sql`select id, supabase_auth_id from users where email = ${email}`;
  if (!row) {
    console.log(`no app user "${email}" — nothing to remove`);
  } else {
    await sql`delete from user_company_access where user_id = ${row.id}`;
    await sql`delete from user_roles where user_id = ${row.id}`;
    await sql`delete from users where id = ${row.id}`;
    const { error } = await supabaseAdmin.auth.admin.deleteUser(row.supabase_auth_id);
    if (error) throw new Error(error.message);
    console.log(`removed "${email}" (app rows + auth identity)`);
  }
} catch (e) {
  console.error("ERR", e.message);
  process.exit(1);
} finally {
  await sql.end();
}
