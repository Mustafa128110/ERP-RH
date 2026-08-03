import "server-only";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { whatsappMessages } from "@/lib/db/schema";

// Applies delivery statuses arriving from Meta's webhook.
//
// Not "use server" and no session check, deliberately: the caller is
// app/api/whatsapp/webhook/route.ts, which has already verified the request's
// HMAC signature against WHATSAPP_APP_SECRET. That signature *is* the
// authentication — there is no user here, and a permission check against a
// session that doesn't exist would just reject every real callback.

type Update = { providerMessageId: string; status: string; error: string | null };

// Meta reports sent / delivered / read / failed. Anything else (a status they
// add later) is ignored rather than written, so an unknown string can't end up
// in a column the app switches on.
const KNOWN = new Set(["sent", "delivered", "read", "failed"]);

// Status only ever moves forwards. Callbacks can arrive out of order — `read`
// before `delivered` is common — and applying them in arrival order would walk
// a message backwards from read to delivered.
// `handoff` sits level with `sent` — the message left the building either way.
// A handoff row has no provider message id, so no callback can match it and this
// is only ever a guard against a status arriving for a row it shouldn't.
const RANK: Record<string, number> = { queued: 0, sent: 1, handoff: 1, delivered: 2, read: 3, failed: 4 };

export async function applyDeliveryStatuses(updates: Update[]): Promise<void> {
  const valid = updates.filter((u) => KNOWN.has(u.status));
  if (valid.length === 0) return;

  // One read for the batch rather than one per update: a webhook delivery
  // carries several statuses at a time.
  const rows = await db
    .select({ id: whatsappMessages.id, providerMessageId: whatsappMessages.providerMessageId, status: whatsappMessages.status })
    .from(whatsappMessages)
    .where(inArray(whatsappMessages.providerMessageId, valid.map((u) => u.providerMessageId)));

  const byProviderId = new Map(rows.map((r) => [r.providerMessageId, r]));

  // Collapse duplicates within the batch to the furthest-along status, so a
  // payload carrying both `delivered` and `read` writes once.
  const best = new Map<string, Update>();
  for (const update of valid) {
    const current = best.get(update.providerMessageId);
    if (!current || RANK[update.status] > RANK[current.status]) best.set(update.providerMessageId, update);
  }

  for (const update of best.values()) {
    const row = byProviderId.get(update.providerMessageId);
    // A status for a message this app didn't send — another app on the same
    // number, or a row that has since been deleted.
    if (!row) continue;
    if (RANK[update.status] <= RANK[row.status]) continue;

    await db
      .update(whatsappMessages)
      .set({ status: update.status as "sent" | "delivered" | "read" | "failed", error: update.error, updatedAt: new Date() })
      .where(eq(whatsappMessages.id, row.id));
  }
}
