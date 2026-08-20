import type { Metadata, Viewport } from "next";
import { getSession } from "@/lib/auth/session";
import { DEFAULT_SCALE, nearestStep } from "@/lib/preference-constants";
import { ServiceWorkerRegister } from "@/components/layout/ServiceWorkerRegister";
import { SpeedInsights } from "@vercel/speed-insights/next";
import "@fontsource/fraunces/600.css";
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/source-code-pro/400.css";
import "@fontsource/source-code-pro/500.css";
import "@fontsource/source-code-pro/600.css";
import "./globals.css";

// Brand pairing (docs/OS/02-brand/typography.md): Fraunces 600 for
// display/headings, Inter 400/500/600 for body/UI. The font files are bundled
// from @fontsource so production builds never depend on Google Fonts being up
// or reachable from a restricted deployment network.

export const metadata: Metadata = {
  title: "Royal Hardware ERP",
  description: "Inventory, sales, purchases and ledgers for Royal Hardware and M52.",
  // The PWA shell (public/manifest.json + public/sw.js): repeat visits load from
  // cache, and the app keeps working offline for pages already visited.
  manifest: "/manifest.json",
  icons: { icon: "/icon.svg" },
};

// Spelled out rather than left to the framework default, for the two settings
// that matter on a phone in a shop:
//
//   maximumScale is deliberately absent — capping zoom on a data-dense app is
//   an accessibility failure, and someone reading a 12px SKU in bad light needs
//   to pinch in.
//
//   viewportFit "cover" lets the layout reach under a notch; the safe-area
//   padding in globals.css keeps content clear of it.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#10263f",
};

// Theme and zoom are read here, on the server, from the row the session query
// already fetched (lib/db/session-query.ts) — not from localStorage in an effect.
// A client-side theme means the first paint is the wrong one and then jumps,
// which on a dark theme is a white flash in a dim shop at 6am. Rendering the
// attribute into the HTML means there is no first paint in the wrong theme at
// all, and no blocking inline script to arrange it.
//
// getSession() returns null rather than redirecting when nobody is signed in, so
// the login screen renders on the defaults instead of failing. It is
// React-cached per request, so the dashboard layout below re-reads it for free.
export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const session = await getSession();
  const theme = session?.uiTheme ?? "light";
  // Snapped on the way out as well as on the way in: a value written before the
  // ladder last changed should still land on a size that exists.
  const scale = session ? nearestStep(session.uiScale) : DEFAULT_SCALE;

  return (
    <html
      lang="en"
      data-theme={theme}
      data-scroll-behavior="smooth"
      // Everything in this app is sized in rem, so the root font size is the
      // zoom: text, padding, gaps and the stroked icons all scale together
      // rather than the type growing out of its buttons.
      style={scale === DEFAULT_SCALE ? undefined : { fontSize: `${scale}%` }}
      className="h-full antialiased"
    >
      {/*
        Grammarly (and password managers, and translation extensions) write
        their own attributes onto <body> before React hydrates —
        data-gr-ext-installed, data-new-gr-c-s-check-loaded — which React then
        reports as a server/client mismatch on every page load.
        suppressHydrationWarning covers this element's OWN attributes and one
        level of text, and nothing else: a real mismatch anywhere inside the
        tree is still reported. Narrow enough to be worth silencing noise the
        app cannot control and did not cause.
      */}
      <body suppressHydrationWarning className="min-h-full flex flex-col">
        {children}
        <ServiceWorkerRegister />
        {/*
          Web-vitals beacon to Vercel Speed Insights. Renders nothing; injects
          its script after hydration (a client component), so it costs nothing
          on the first paint. Dev builds don't send data.
        */}
        <SpeedInsights />
      </body>
    </html>
  );
}
