import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function proxy(request: NextRequest) {
  // Meta cannot carry an ERP browser session when it verifies or posts an
  // event. The webhook authenticates itself with its verify token/signature.
  if (request.nextUrl.pathname === "/api/whatsapp/webhook") return NextResponse.next();
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
