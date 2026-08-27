"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { getLiveSession, invalidateSessions } from "@/lib/auth/session";
import { guard, type ActionResult } from "@/lib/actions/guard";
import { recordAudit } from "@/lib/actions/audit";
import { isTheme, nearestStep, type ThemePreference } from "@/lib/preference-constants";
import { invalidateReads, READ_DOMAIN } from "@/lib/queries/lookups";

// Display preferences — theme and zoom — for the person who is signed in.
//
// Deliberately not behind requirePermission(). Every other action in this
// folder asks whether you may change *the business's* data; this one changes
// how the app looks to you and nobody else, and a user who cannot see the
// Settings page still has eyes. A session is the whole of the authorisation:
// you may only ever write your own row, because the row is chosen from the
// session rather than from anything the browser sent.

async function writePrefs(patch: { uiTheme?: ThemePreference; uiScale?: number }, summary: string): Promise<ActionResult> {
  const session = await getLiveSession();
  if (!session) return { error: "You're signed out. Sign in again to change this." };

  await db.update(users).set(patch).where(eq(users.id, session.userId));

  // The session is cached for a minute and now carries these two columns, so
  // without this the theme would flip back on the next render and stay wrong
  // until the cache aged out (lib/auth/session.ts).
  await invalidateSessions();

  // The expense list names whoever entered each row, joined from this table. A
  // theme change cannot alter that name, but this writes the same row the join
  // reads and the coverage rule in lib/cache.check.ts can't tell the two columns
  // apart — one prefix drop on a preference change is the cheaper side of that.
  await invalidateReads(READ_DOMAIN.expenses);

  // Applied on <html> in the root layout, so every route's markup depends on
  // these values — not just the settings page the button was pressed on.
  revalidatePath("/", "layout");

  await recordAudit({ action: "update", entity: "preference", summary });
  return { success: true };
}

export async function setTheme(theme: ThemePreference): Promise<ActionResult> {
  return guard("Couldn't change the theme.", async () => {
    if (!isTheme(theme)) return { error: "That isn't a theme this app has." };
    return writePrefs({ uiTheme: theme }, `Theme set to ${theme}`);
  });
}

export async function setZoom(scale: number): Promise<ActionResult> {
  return guard("Couldn't change the zoom.", async () => {
    // Snapped rather than trusted: the value arrives from the browser, and the
    // column has a check constraint that would turn an out-of-range one into a
    // thrown error instead of a saved preference.
    const snapped = nearestStep(Number(scale));
    return writePrefs({ uiScale: snapped }, `Zoom set to ${snapped}%`);
  });
}
