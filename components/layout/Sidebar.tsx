"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { navSections } from "@/lib/nav-config";
import { NavIcon } from "@/components/layout/NavIcon";
import { HoverCard } from "@/components/ui/HoverCard";
import type { ComponentProps } from "react";

// Fired by the Topbar's hamburger. An event rather than lifted state: the drawer
// is the only thing the two share, and threading a setter down through the
// server layout to reach it would be more wiring than it is worth — the same
// call the shortcut sheet makes.
export const NAV_EVENT = "erp:nav";
export const openNav = () => window.dispatchEvent(new Event(NAV_EVENT));

// Dynamic ERP routes normally prefetch only their loading shell. Once a pointer,
// keyboard focus, or finger shows intent, opt that one destination into a full
// prefetch so its cached read model and JavaScript are ready before the click.
// `null` preserves Next's inexpensive default while the link is merely visible.
function IntentLink({ onPointerEnter, onFocus, onTouchStart, ...props }: ComponentProps<typeof Link>) {
  const [intent, setIntent] = useState(false);
  const warm = () => setIntent(true);
  return (
    <Link
      {...props}
      prefetch={intent ? true : null}
      onPointerEnter={(event) => {
        warm();
        onPointerEnter?.(event);
      }}
      onFocus={(event) => {
        warm();
        onFocus?.(event);
      }}
      onTouchStart={(event) => {
        warm();
        onTouchStart?.(event);
      }}
    />
  );
}

export function Sidebar({ permissions }: { permissions: string[] }) {
  const pathname = usePathname();
  const allowed = new Set(permissions);
  const visibleSections = navSections
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => {
        if (!item.permission) return true;
        const required = Array.isArray(item.permission) ? item.permission : [item.permission];
        return required.some((permission) => allowed.has(permission));
      }),
    }))
    .filter((section) => section.items.length > 0);

  // Exactly one link lights up: the most specific one whose path we're under.
  //
  // The prefix match has to stay so a detail route (/sales/invoices/abc123)
  // still highlights Invoices — but on /sales/invoices that same rule also
  // matched /sales, and both lit up. Taking the longest match resolves the
  // nesting: /sales/invoices beats /sales, and /sales/abc123 (an edit page,
  // which has no nav entry of its own) still falls back to /sales.
  const activeHref = visibleSections
    .flatMap((section) => section.items.map((item) => item.href))
    .filter((href) => pathname === href || pathname.startsWith(href + "/"))
    .sort((a, b) => b.length - a.length)[0];

  const [collapsed, setCollapsed] = useState(false);
  // Phone only. Closed on every navigation — tapping a link on a phone should
  // land you on the page, not on the page behind a menu.
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    const open = () => setDrawerOpen(true);
    window.addEventListener(NAV_EVENT, open);
    return () => window.removeEventListener(NAV_EVENT, open);
  }, []);

  useEffect(() => {
    if (!drawerOpen) return;
    // Esc closes it, like every other layer in this app, and the page behind
    // must not scroll under it.
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setDrawerOpen(false);
    }
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", onKey);
    };
  }, [drawerOpen]);

  // Taller tap targets on a phone, the desktop density above it.
  const linkClass = (active: boolean) =>
    `rounded-md px-2 py-2.5 text-sm transition-colors md:py-1.5 ${
      active ? "bg-navy-800 text-white" : "text-steel hover:bg-ivory hover:text-navy-800"
    }`;

  // The full list of links, shared by the drawer and the expanded desktop rail
  // so the two can never offer different navigation.
  const sections = visibleSections.map((section) => (
    <div key={section.label}>
      <p className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wider text-brass-600">{section.label}</p>
      <div className="flex flex-col gap-0.5">
        {section.items.map((item) => (
          <IntentLink
            key={item.href}
            href={item.href}
            // Tapping a link on a phone should land you on the page, not on the
            // page behind a still-open menu. Done here rather than in an effect
            // watching the pathname: the tap is the event, and an effect would
            // be a slower way of saying the same thing.
            onClick={() => setDrawerOpen(false)}
            className={linkClass(item.href === activeHref)}
          >
            {item.label}
          </IntentLink>
        ))}
      </div>
    </div>
  ));

  const brand = (
    <div className="flex items-center gap-2">
      <div className="flex h-7 w-7 items-center justify-center rounded bg-navy-800 text-sm font-bold text-white">RH</div>
      <span className="text-sm font-semibold text-navy-800">Royal Hardware</span>
    </div>
  );

  return (
    <>
      {/* --- Phone: a drawer over the page. Below md the rail is hidden
              entirely, which is why this has to exist — without it a phone has
              no navigation at all. ----------------------------------------- */}
      {drawerOpen && (
        <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
          <div className="absolute inset-0 bg-scrim/60 backdrop-blur-sm" onClick={() => setDrawerOpen(false)} role="presentation" />
          {/* max-w-[85vw] so the page behind stays visible — a full-width menu
              reads as a navigation *page* and loses the sense of going back. */}
          <aside className="scroll-thin absolute inset-y-0 left-0 flex w-64 max-w-[85vw] flex-col overflow-y-auto border-r border-sand bg-white pb-[env(safe-area-inset-bottom)]">
            <div className="sticky top-0 z-10 flex h-14 shrink-0 items-center justify-between gap-2 border-b-2 border-brass-600 bg-white px-4">
              {brand}
              <button
                type="button"
                onClick={() => setDrawerOpen(false)}
                aria-label="Close navigation"
                className="flex h-11 w-11 items-center justify-center rounded-md text-steel hover:bg-ivory hover:text-navy-800"
              >
                ✕
              </button>
            </div>
            <nav className="flex flex-1 flex-col gap-4 px-2 py-4">{sections}</nav>
          </aside>
        </div>
      )}

      {/* --- Tablet and up: the rail, collapsed to icons or expanded -------- */}
      {collapsed ? (
        // Collapsed is a working nav, not a stub: every page the open sidebar
        // reaches is one click away here too, as an icon. The section names are
        // dropped — a 56px rail has no room — and a hairline between the groups
        // keeps Inventory from running into Purchases without spelling either out.
        <aside className="hidden w-14 shrink-0 flex-col items-center border-r border-sand bg-white py-3 md:flex">
          <button
            type="button"
            onClick={() => setCollapsed(false)}
            aria-label="Expand sidebar"
            className="rounded-md p-1.5 text-steel hover:bg-ivory hover:text-navy-800"
          >
            »
          </button>

          <nav className="scroll-thin flex flex-1 flex-col items-center gap-1 overflow-y-auto py-3">
            {visibleSections.map((section, i) => (
              <div key={section.label} className="flex w-full flex-col items-center gap-1">
                {i > 0 && <hr className="my-1 w-6 border-t border-sand" />}
                {section.items.map((item) => {
                  const active = item.href === activeHref;
                  return (
                    // The icon is the only thing naming the page here, so hovering
                    // it names it properly — the app's own hover panel beside the
                    // rail, not the browser's half-second grey tooltip. The
                    // section name rides along, since the rail drops the headings.
                    <HoverCard
                      key={item.href}
                      placement="right"
                      panelWidth={200}
                      estimatedHeight={54}
                      panelClassName="w-max px-3 py-2"
                      trigger={
                        <IntentLink
                          href={item.href}
                          aria-label={item.label}
                          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-md transition-colors ${
                            active ? "bg-navy-800 text-white" : "text-steel hover:bg-ivory hover:text-navy-800"
                          }`}
                        >
                          <NavIcon href={item.href} label={item.label} />
                        </IntentLink>
                      }
                    >
                      <p className="font-semibold text-navy-800">{item.label}</p>
                      <p className="text-xs text-steel">{section.label}</p>
                    </HoverCard>
                  );
                })}
              </div>
            ))}
          </nav>
        </aside>
      ) : (
        <aside className="hidden w-52 shrink-0 flex-col overflow-hidden border-r border-sand bg-white md:flex">
          <div className="flex h-14 shrink-0 items-center justify-between gap-2 border-b-2 border-brass-600 px-4">
            {brand}
            <button
              type="button"
              onClick={() => setCollapsed(true)}
              aria-label="Collapse sidebar"
              className="rounded-md p-1 text-steel hover:bg-ivory hover:text-navy-800"
            >
              «
            </button>
          </div>

          <nav className="scroll-thin flex flex-1 flex-col gap-4 overflow-y-auto px-2 py-4">{sections}</nav>
        </aside>
      )}
    </>
  );
}
