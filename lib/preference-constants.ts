// Lives outside lib/actions/preferences.ts because that file is "use server",
// and such a module may only export async functions — same reason
// lib/setting-constants.ts and lib/sale-constants.ts exist.
//
// These are display preferences: per user, not per company. Two people share a
// counter and a company's settings, but not their eyesight.

export type ThemePreference = "light" | "dark";

export const THEMES: ThemePreference[] = ["light", "dark"];

export function isTheme(value: unknown): value is ThemePreference {
  return value === "light" || value === "dark";
}

// Root font size as a percentage. Tailwind sizes text, padding and icons in
// rem, so this one number scales the whole interface together rather than the
// text drifting out of its buttons.
//
// An explicit list rather than a min/max/step: the steps have to land exactly
// on 100 (the size everything was designed at), and arithmetic from 75 in tens
// never does. Bounded by the ui_scale_range check constraint in the database,
// which is what stops a hand-written UPDATE leaving someone at 10000% with no
// readable way back to this screen.
export const ZOOM_STEPS = [75, 90, 100, 110, 125, 150, 175] as const;

export const DEFAULT_SCALE = 100;
export const MIN_SCALE = ZOOM_STEPS[0];
export const MAX_SCALE = ZOOM_STEPS[ZOOM_STEPS.length - 1];

// Snaps to the nearest step rather than rejecting: a value that predates a
// change to this list (or arrives from a stale form) should land on the closest
// size that exists now, not throw the person back to 100%.
export function nearestStep(scale: number): number {
  if (!Number.isFinite(scale)) return DEFAULT_SCALE;
  return ZOOM_STEPS.reduce((best, step) => (Math.abs(step - scale) < Math.abs(best - scale) ? step : best), ZOOM_STEPS[0]);
}

// One step bigger / smaller, stopping at the ends. Returns the same value at
// the limit so the caller can disable the button by comparing.
export function zoomIn(scale: number): number {
  const i = ZOOM_STEPS.indexOf(nearestStep(scale) as (typeof ZOOM_STEPS)[number]);
  return ZOOM_STEPS[Math.min(i + 1, ZOOM_STEPS.length - 1)];
}

export function zoomOut(scale: number): number {
  const i = ZOOM_STEPS.indexOf(nearestStep(scale) as (typeof ZOOM_STEPS)[number]);
  return ZOOM_STEPS[Math.max(i - 1, 0)];
}
