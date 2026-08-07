"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setTheme, setZoom } from "@/lib/actions/preferences";
import { DEFAULT_SCALE, MAX_SCALE, MIN_SCALE, zoomIn, zoomOut, type ThemePreference } from "@/lib/preference-constants";

// The one card on the Settings page that is about the person rather than the
// company. It writes to users.ui_theme / users.ui_scale, so it follows the
// account onto any machine they sign in from — a shared counter terminal shows
// each person their own size.
//
// Every change is applied to the document first and saved second. The server
// already renders the right theme on a fresh load (app/layout.tsx); doing it
// here as well is what makes the button feel connected to the screen instead of
// waiting on a round trip to a database ~170ms away. If the save then fails,
// the message says so and a reload puts back what is actually stored.

const iconClass = "h-5 w-5";

function ZoomInIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden className={iconClass}>
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3.5-3.5M8 11h6M11 8v6" />
    </svg>
  );
}

function ZoomOutIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden className={iconClass}>
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3.5-3.5M8 11h6" />
    </svg>
  );
}

function SunIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden className={iconClass}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden className={iconClass}>
      <path d="M20 14.5A8.5 8.5 0 019.5 4a8.5 8.5 0 1010.5 10.5z" />
    </svg>
  );
}

// Square, because these are icon-only. Sized off rem like everything else, so
// the zoom controls grow with the thing they control.
const iconButtonClass =
  "flex h-11 w-11 shrink-0 items-center justify-center rounded border border-sand text-navy-800 hover:bg-ivory disabled:opacity-40 disabled:hover:bg-transparent";

export function AppearanceSettings({ theme: initialTheme, scale: initialScale }: { theme: ThemePreference; scale: number }) {
  const [theme, setThemeState] = useState(initialTheme);
  const [scale, setScaleState] = useState(initialScale);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function applyTheme(next: ThemePreference) {
    setThemeState(next);
    document.documentElement.dataset.theme = next;
    setError(null);
    startTransition(async () => {
      const result = await setTheme(next);
      if (result.error) return setError(result.error);
      // The server rendered the old value into the HTML of every route; this is
      // what stops a back-navigation restoring it.
      router.refresh();
    });
  }

  function applyScale(next: number) {
    if (next === scale) return;
    setScaleState(next);
    // Matches app/layout.tsx: 100% clears the attribute rather than setting it,
    // so the document is left exactly as a default render would leave it.
    document.documentElement.style.fontSize = next === DEFAULT_SCALE ? "" : `${next}%`;
    setError(null);
    startTransition(async () => {
      const result = await setZoom(next);
      if (result.error) return setError(result.error);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm font-medium text-ink">Text and icon size</p>
          <p className="text-xs text-steel">Scales the whole interface, not just the text.</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => applyScale(zoomOut(scale))}
            disabled={scale <= MIN_SCALE}
            className={iconButtonClass}
            aria-label="Make everything smaller"
            title="Smaller"
          >
            <ZoomOutIcon />
          </button>
          {/* tabular-nums so the row doesn't twitch sideways between 90% and 100%. */}
          <span className="w-14 text-center text-sm tabular-nums text-ink">{scale}%</span>
          <button
            type="button"
            onClick={() => applyScale(zoomIn(scale))}
            disabled={scale >= MAX_SCALE}
            className={iconButtonClass}
            aria-label="Make everything bigger"
            title="Bigger"
          >
            <ZoomInIcon />
          </button>
        </div>
      </div>

      <div className="flex items-center justify-between gap-4 border-t border-sand pt-5">
        <div className="min-w-0">
          <p className="text-sm font-medium text-ink">Dark mode</p>
          <p className="text-xs text-steel">Saved to your account, so it follows you to any machine.</p>
        </div>
        {/* Two buttons rather than a switch: a switch has to be read to know
            which way is on, whereas the lit one here is the one in use. */}
        <div className="flex shrink-0 items-center gap-2" role="group" aria-label="Theme">
          <button
            type="button"
            onClick={() => applyTheme("light")}
            aria-pressed={theme === "light"}
            className={`${iconButtonClass} ${theme === "light" ? "border-navy-800 bg-navy-800 text-white hover:bg-navy-700" : ""}`}
            title="Light"
          >
            <SunIcon />
            <span className="sr-only">Light</span>
          </button>
          <button
            type="button"
            onClick={() => applyTheme("dark")}
            aria-pressed={theme === "dark"}
            className={`${iconButtonClass} ${theme === "dark" ? "border-navy-800 bg-navy-800 text-white hover:bg-navy-700" : ""}`}
            title="Dark"
          >
            <MoonIcon />
            <span className="sr-only">Dark</span>
          </button>
        </div>
      </div>

      {error && <p className="text-sm text-error">{error}</p>}
      {pending && !error && <p className="text-xs text-steel">Saving…</p>}
    </div>
  );
}
