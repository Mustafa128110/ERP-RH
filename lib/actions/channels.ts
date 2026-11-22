"use server";

import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { salesChannels } from "@/lib/db/schema";
import { getLiveSession } from "@/lib/auth/session";
import { requirePermission } from "@/lib/auth/permissions";
import { guard, DUPLICATE } from "@/lib/actions/guard";
import { recordAudit } from "@/lib/actions/audit";
import { CACHE, invalidateLookups, invalidateReads, READ_DOMAIN } from "@/lib/queries/lookups";
import { CHANNEL_COOKIE } from "@/lib/sale-constants";

export async function saveChannel(id: string | null, name: string) {
  return guard("Couldn't save the sales channel.", async () => {
    const session = await getLiveSession();
    requirePermission(session, "settings", "edit");
    const trimmed = name.trim();
    if (!trimmed || trimmed.length > 100) return { error: "Enter a channel name of 1–100 characters." };
    const channelId = id ?? `channel-${randomUUID()}`;
    if (id) await db.update(salesChannels).set({ name: trimmed }).where(eq(salesChannels.id, id));
    else await db.insert(salesChannels).values({ id: channelId, name: trimmed });
    await invalidateLookups(CACHE.salesChannels);
    await invalidateReads(READ_DOMAIN.sales, READ_DOMAIN.purchases, READ_DOMAIN.payments, READ_DOMAIN.expenses);
    revalidatePath("/", "layout");
    await recordAudit({ action: id ? "update" : "create", entity: "sales channel", summary: trimmed, detail: `Channel ID: ${channelId}` });
    return { success: true };
  }, { [DUPLICATE]: "A channel with that name already exists." });
}

export async function setChannelActive(id: string, isActive: boolean) {
  return guard("Couldn't change the sales channel.", async () => {
    const session = await getLiveSession();
    requirePermission(session, "settings", "edit");
    const result = await db.transaction(async (tx) => {
      const active = await tx.select({ id: salesChannels.id }).from(salesChannels).where(eq(salesChannels.isActive, true)).orderBy(salesChannels.id).for("update");
      if (!isActive && active.length <= 1 && active.some((channel) => channel.id === id)) return { error: "Keep at least one channel available for new entries." };
      await tx.update(salesChannels).set({ isActive }).where(eq(salesChannels.id, id));
      return { success: true };
    });
    if (result.error) return result;
    await invalidateLookups(CACHE.salesChannels);
    await invalidateReads(READ_DOMAIN.sales, READ_DOMAIN.purchases, READ_DOMAIN.payments, READ_DOMAIN.expenses);
    revalidatePath("/", "layout");
    await recordAudit({ action: "update", entity: "sales channel", detail: `Channel ID: ${id}`, summary: isActive ? "Channel restored" : "Channel removed from new entries; history preserved" });
    return { success: true };
  });
}

export async function setScopeChannel(id: string) {
  return guard("Couldn't change the channel filter.", async () => {
    const session = await getLiveSession();
    if (!session) return { error: "Not authenticated." };
    if (id !== "all") {
      const [channel] = await db.select({ id: salesChannels.id }).from(salesChannels).where(eq(salesChannels.id, id)).limit(1);
      if (!channel) return { error: "That channel no longer exists." };
    }
    (await cookies()).set(CHANNEL_COOKIE, id, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 31536000 });
    revalidatePath("/", "layout");
    return { success: true };
  });
}
