import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    // json/js added for the PWA shell: /manifest.json and /sw.js must be served
    // unauthenticated, or the middleware redirects them to /login and the
    // manifest fails to parse (and the service worker fails to register).
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|json|js)$).*)",
  ],
};
