"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { companies } from "@/lib/db/schema";
import { getLiveSession, getSession } from "@/lib/auth/session";
import { SCOPE_COOKIE } from "@/lib/auth/scope";
import { guard, type ActionResult } from "@/lib/actions/guard";

// The companies the Topbar selector offers — only those the signed-in user can
// access. A user who can see one company gets a one-item list; the "All" option
// is only meaningful when there's more than one.
export async function getAccessibleCompanies(): Promise<{ id: string; name: string }[]> {
  const session = await getSession();
  if (!session || session.companyIds.length === 0) return [];
  return db
    .select({ id: companies.id, name: companies.name })
    .from(companies)
    .where(inArray(companies.id, session.companyIds))
    .orderBy(companies.name);
}

// Sets the Topbar scope. Value is a company id, or "all". Rejects a company the
// user can't access rather than storing it — the read side intersects with the
// session anyway, but not writing it keeps the cookie honest.
export async function setScopeCompany(value: string): Promise<ActionResult> {
  return guard("Couldn't change the company scope.", async () => {
    const session = await getLiveSession();
    if (!session) return { error: "Not authenticated" };

    const ok = value === "all" || session.companyIds.includes(value);
    if (!ok) return { error: "That company isn't available to this account." };
    const store = await cookies();
    store.set(SCOPE_COOKIE, value, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
    });

    // Everything under the dashboard reads the scope, so refresh the whole tree.
    revalidatePath("/", "layout");
    return { success: true };
  });
}
