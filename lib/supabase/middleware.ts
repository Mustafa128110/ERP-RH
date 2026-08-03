import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// Refreshes the session cookie on every request so it never silently expires
// mid-session (docs/phase-8-authentication.md §2). The actual permission
// decision happens per-action, not here — proxy only knows "who."
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  // getClaims() verifies the token locally against the project's cached ES256
  // JWKS instead of asking the Auth server, which getUser() did on every single
  // request — including each RSC prefetch. Same guarantee (the signature and
  // exp are still checked), no round trip to Sydney. It still refreshes the
  // session when the token nears expiry, which is the reason this runs here:
  // Server Components can't write cookies, the proxy can.
  const { data } = await supabase.auth.getClaims();
  const user = data?.claims;

  // (dashboard) is a route group — its pages have no shared URL prefix — so
  // every path is protected except the login page itself.
  if (!user && request.nextUrl.pathname !== "/login") {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  if (user && request.nextUrl.pathname === "/login") {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    return NextResponse.redirect(url);
  }

  return response;
}
