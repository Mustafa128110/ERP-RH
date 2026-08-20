// Reset both test users' passwords via the service-role admin API, then verify.
import { createClient } from "@supabase/supabase-js";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PW = "V3rify#Pass!2026";

const sb = createClient(URL, KEY, { auth: { autoRefreshToken: false, persistSession: false } });

const users = await sb.auth.admin.listUsers();
for (const u of users.data.users) {
  if (!u.email.startsWith("verify")) continue;
  const r = await sb.auth.admin.updateUserById(u.id, { password: PW });
  if (r.error) { console.log(u.email, "RESET FAIL:", r.error.message); continue; }
  const v = await sb.auth.signInWithPassword({ email: u.email, password: PW });
  console.log(u.email, v.error ? "VERIFY FAIL: " + v.error.message : "OK");
}
process.exit(0);
