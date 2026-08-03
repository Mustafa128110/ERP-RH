import "server-only";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

// Bound to the current request's cookies — every requirePermission() call
// resolves its session from this client (docs/phase-8-authentication.md §2).
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Called from a Server Component — middleware refreshes the
            // session cookie on the next request instead.
          }
        },
      },
    },
  );
}
