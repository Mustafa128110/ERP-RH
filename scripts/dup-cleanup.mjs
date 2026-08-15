import postgres from "postgres";
import { createClient } from "@supabase/supabase-js";

const marker = process.argv[2];
const email = process.argv[3];
const sql = postgres(process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL, { max: 1 });

// 1. Exactly one expense must exist for this run's marker — the replay must
//    not have created a second one.
const rows = await sql`select id, notes, amount from expenses where notes like ${marker}`;
console.log(`expenses with marker "${marker}": ${rows.length}`);
for (const r of rows) console.log(`  id=${r.id} amount=${r.amount}`);
if (rows.length !== 1) {
  console.error(`FAIL: expected exactly 1 expense for the marker, found ${rows.length}`);
  process.exit(1);
}

// 2. Cleanup: every dup-test expense from any test run (including the run whose
//    save passed through before the stage-detection fix).
const deleted = await sql`delete from expenses where notes like 'dup-test-%' returning id`;
console.log(`deleted ${deleted.length} test expense(s)`);

// 3. Remove the throwaway user.
const [user] = await sql`select id, supabase_auth_id from users where email = ${email}`;
if (user) {
  await sql`delete from user_company_access where user_id = ${user.id}`;
  await sql`delete from user_roles where user_id = ${user.id}`;
  await sql`delete from users where id = ${user.id}`;
  const supabaseAdmin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error } = await supabaseAdmin.auth.admin.deleteUser(user.supabase_auth_id);
  if (error) throw new Error(error.message);
  console.log(`removed "${email}"`);
}
console.log("dup-test cleanup complete");
await sql.end();
