import "server-only";
import { createClient } from "@supabase/supabase-js";

// Service-role client — bypasses RLS and Auth restrictions entirely. Only for
// the Admin API (createUser, Phase 7 §1.10) and background jobs (backup cron,
// WhatsApp webhook), never for a request scoped to an end user.
export function createAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}
