"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { logout } from "@/lib/auth/actions";
import { setScopeCompany } from "@/lib/actions/scope";
import { GlobalSearch } from "@/components/layout/GlobalSearch";
import { SyncStatus } from "@/components/layout/SyncStatus";
import { useSync } from "@/components/layout/SyncProvider";
import { setClientUserId } from "@/lib/client-user";
import { openShortcuts } from "@/components/layout/KeyboardShortcuts";
import { openNav } from "@/components/layout/Sidebar";

// The company selector is the scope control for the whole app: choosing a
// company filters every list to that company plus global data; "All" shows
// every company the user can access. The choice is saved server-side (a cookie),
// so it sticks across navigations and reloads.
//
// On a phone the bar carries four things at 360px: the menu button, the search
// box, and — behind one overflow button — the scope, the shortcut sheet and
// logging out. Search stays visible because it is the fastest way to anything;
// the rest are occasional and would each steal width from it.
// Logging out with queued or failed operations is not a silent decision: the
// work stays on this browser under this user (it is never lost, never handed
// to another account), but the user should know it is waiting before they go.
// The first click arms a confirm; the second logs out. The client-side user id
// is cleared with the session so nothing after this page keeps composing
// persistence keys under the old identity.
function LogoutButton({ className }: { className: string }) {
  const { entries } = useSync();
  const waiting = entries.filter((e) => e.status === "pending" || e.status === "failed").length;
  const [armed, setArmed] = useState(false);
  // Auto-disarm so an armed-but-unclicked button doesn't stay live forever.
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 10_000);
    return () => clearTimeout(t);
  }, [armed]);

  return (
    <form action={logout}>
      <button
        type="submit"
        onClick={(e) => {
          if (waiting > 0 && !armed) {
            e.preventDefault();
            setArmed(true);
            return;
          }
          // The session is ending — the client-side user id goes with it, so
          // no post-logout render composes drafts/outbox keys under the old
          // user.
          setClientUserId(null);
        }}
        title={waiting > 0 ? `${waiting} operation(s) waiting to sync — they stay on this browser and sync after you log back in.` : undefined}
        className={className}
      >
        {armed ? "Log out anyway?" : "Log out"}
      </button>
      {armed && (
        <span className="block pt-1 text-xs text-amber-900">
          {waiting} {waiting === 1 ? "operation is" : "operations are"} waiting to sync. They stay on this browser
          and sync when you log back in — nothing is lost.
        </span>
      )}
    </form>
  );
}

export function Topbar({
  username,
  companies,
  selected,
}: {
  username: string;
  companies: { id: string; name: string }[];
  selected: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  function onScopeChange(value: string) {
    startTransition(async () => {
      await setScopeCompany(value);
      router.refresh();
    });
  }

  // A click anywhere else, or Esc, closes the overflow menu.
  useEffect(() => {
    if (!menuOpen) return;
    function onDown(e: MouseEvent) {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setMenuOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  const scopeSelect = (className: string) => (
    <select
      value={selected}
      disabled={pending}
      onChange={(e) => onScopeChange(e.target.value)}
      className={className}
      aria-label="Company scope"
    >
      <option value="all">All companies</option>
      {companies.map((c) => (
        <option key={c.id} value={c.id}>
          {c.name}
        </option>
      ))}
    </select>
  );

  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b border-sand bg-white px-3 sm:gap-3 sm:px-4">
      {/* The only way to the sidebar below md, where the rail is hidden. */}
      <button
        type="button"
        onClick={openNav}
        aria-label="Open navigation"
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-steel hover:bg-ivory hover:text-navy-800 md:hidden"
      >
        {/* Three rules rather than an icon font — no dependency, scales cleanly. */}
        <span className="flex flex-col gap-[3px]" aria-hidden>
          <span className="block h-0.5 w-5 rounded bg-current" />
          <span className="block h-0.5 w-5 rounded bg-current" />
          <span className="block h-0.5 w-5 rounded bg-current" />
        </span>
      </button>

      {/* One company means no scope to choose — the selector only helps when
          there's more than one. Hidden on a phone; it moves into the menu. */}
      {companies.length > 1 &&
        scopeSelect(
          "hidden shrink-0 rounded-md border border-sand bg-transparent px-2 py-1.5 text-sm text-ink disabled:opacity-60 sm:block",
        )}

      <GlobalSearch />

      {/* The sync/offline pill — invisible when everything is fine. */}
      <SyncStatus />

      {/* Everything from here right is desktop-only; the phone gets the menu. */}
      <div className="hidden items-center gap-3 whitespace-nowrap sm:flex">
        {/* The app is keyboard-first — arrow navigation in every list, an Excel
            grid in every batch dialog — and none of that was discoverable. */}
        <button
          type="button"
          onClick={openShortcuts}
          title="Keyboard shortcuts (?)"
          aria-label="Keyboard shortcuts"
          className="flex h-7 w-7 items-center justify-center rounded border border-sand text-sm font-medium text-steel hover:bg-ivory hover:text-navy-800"
        >
          ?
        </button>
        <span className="hidden text-sm text-steel lg:inline">{username}</span>
        <LogoutButton className="rounded-md border border-sand px-3 py-1.5 text-sm font-medium text-steel hover:bg-ivory" />
      </div>

      <div ref={menuRef} className="relative shrink-0 sm:hidden">
        <button
          type="button"
          onClick={() => setMenuOpen((open) => !open)}
          aria-label="Account and settings"
          aria-expanded={menuOpen}
          className="flex h-10 w-10 items-center justify-center rounded-md text-lg leading-none text-steel hover:bg-ivory hover:text-navy-800"
        >
          ⋮
        </button>

        {menuOpen && (
          <div className="absolute right-0 top-full z-50 mt-1 w-60 rounded-md border border-sand bg-white p-3 shadow-xl">
            <p className="truncate pb-2 text-sm font-medium text-navy-800">{username}</p>

            {companies.length > 1 && (
              <label className="flex flex-col gap-1 pb-3 text-xs text-steel">
                Company scope
                {scopeSelect("h-11 w-full rounded-md border border-sand bg-transparent px-2 text-sm text-ink disabled:opacity-60")}
              </label>
            )}

            {/* The mobile menu unmounts when it closes, which also resets the
                armed confirm — a fresh menu always starts unarmed. */}
            <LogoutButton className="h-11 w-full rounded-md border border-sand text-sm font-medium text-steel hover:bg-ivory" />
          </div>
        )}
      </div>
    </header>
  );
}
