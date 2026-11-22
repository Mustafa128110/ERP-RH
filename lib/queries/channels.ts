import "server-only";
import { cookies } from "next/headers";
import { eq, sql, type Column } from "drizzle-orm";
import { db } from "@/lib/db";
import { documents, salesChannels } from "@/lib/db/schema";
import { getLiveSession, getSession } from "@/lib/auth/session";
import { PermissionError } from "@/lib/auth/permissions";
import { cached, MINUTE } from "@/lib/cache";
import { CACHE } from "@/lib/cache-keys";
import { CHANNEL_COOKIE, DEFAULT_SALE_TYPE, entryChannel } from "@/lib/sale-constants";
import { agentSession } from "@/lib/whatsapp-agent/context";

export async function getChannels() {
  if (!await getSession()) return [];
  return cached(CACHE.salesChannels, 5 * MINUTE, () => db.select().from(salesChannels).orderBy(salesChannels.createdAt, salesChannels.name));
}

export async function getSelectedChannel() {
  if (agentSession()) return "all";
  const selected = (await cookies()).get(CHANNEL_COOKIE)?.value;
  if (!selected || selected === "all") return "all";
  return (await getChannels()).some((channel) => channel.id === selected) ? selected : "all";
}

export async function channelInScope(column: Column) {
  const selected = await getSelectedChannel();
  return selected === "all" ? undefined : sql`coalesce(${column}, ${DEFAULT_SALE_TYPE}) = ${selected}`;
}

export async function resolveChannel(value: unknown, existingDocumentId?: string, existingChannel?: string | null) {
  if (!await getLiveSession()) throw new PermissionError("Not authenticated");
  const [existing] = existingDocumentId ? await db.select({ saleType: documents.saleType }).from(documents).where(eq(documents.id, existingDocumentId)).limit(1) : [];
  const previous = existing?.saleType ?? existingChannel;
  const id = String(value || previous || entryChannel(await db.select().from(salesChannels).orderBy(salesChannels.createdAt), "all"));
  const [channel] = await db.select().from(salesChannels).where(eq(salesChannels.id, id)).limit(1);
  if (!channel || (!channel.isActive && id !== previous)) throw new Error("Select an available sales channel.");
  return id;
}
