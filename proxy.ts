import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    // `api/` is excluded because the one route under it is the WhatsApp delivery
    // webhook, which Meta calls with no session — this proxy would redirect it
    // to /login and every status callback would be lost. That route
    // authenticates itself instead, by verifying the request's HMAC signature
    // against WHATSAPP_APP_SECRET, which is stronger than a cookie anyway.
    "/((?!api/|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
