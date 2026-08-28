import "server-only";
import { Redis } from "@upstash/redis";

const PREFIX = "erp:whatsapp-agent:v1";
const INBOUND_TTL_SECONDS = 24 * 60 * 60;
const PROCESSING_TTL_SECONDS = 90;
const PENDING_TTL_SECONDS = 10 * 60;
const CONVERSATION_TTL_SECONDS = 30 * 60;
const CONVERSATION_TURNS = 10;

type Globals = { redis?: Redis | null };
const globals = globalThis as unknown as Globals;

function client(): Redis | null {
  const url = process.env.UPSTASH_REDIS_REST_URL?.trim();
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  if (!url || !token) return null;
  if (globals.redis === undefined) globals.redis = new Redis({ url, token });
  return globals.redis;
}

function inboundKey(messageId: string) { return `${PREFIX}:inbound:${messageId}`; }
function pendingKey(phone: string) { return `${PREFIX}:pending:${phone}`; }
function conversationKey(phone: string) { return `${PREFIX}:conversation:${phone}`; }

export type InboundClaim = "claimed" | "done" | "busy" | "unavailable";

// Meta retries deliveries.  A retry waits while the first request is still
// working, and sees `done` after it completes.  Redis being unavailable never
// turns into an in-process fallback because that could post a draft twice.
export async function claimInbound(messageId: string): Promise<InboundClaim> {
  const redis = client();
  if (!redis) return "unavailable";
  try {
    const key = inboundKey(messageId);
    const created = await redis.set(key, "processing", { nx: true, ex: PROCESSING_TTL_SECONDS });
    if (created === "OK") return "claimed";
    return (await redis.get<string>(key)) === "done" ? "done" : "busy";
  } catch {
    return "unavailable";
  }
}

export async function finishInbound(messageId: string): Promise<void> {
  const redis = client();
  if (!redis) return;
  try {
    await redis.set(inboundKey(messageId), "done", { ex: INBOUND_TTL_SECONDS });
  } catch {
    // The action's operation id remains a second line of defence if a provider
    // retry arrives after this best-effort final state could not be written.
  }
}

export async function releaseInbound(messageId: string): Promise<void> {
  const redis = client();
  if (!redis) return;
  try { await redis.del(inboundKey(messageId)); } catch { /* Meta can retry later. */ }
}

export interface PendingDraft {
  phone: string;
  userId: string;
  operationId: string;
  tool: string;
  fields: Record<string, string>;
  confirmation: string;
}

export async function savePending(draft: PendingDraft): Promise<boolean> {
  const redis = client();
  if (!redis) return false;
  try {
    await redis.set(pendingKey(draft.phone), draft, { ex: PENDING_TTL_SECONDS });
    return true;
  } catch {
    return false;
  }
}

export async function takePending(phone: string): Promise<PendingDraft | null> {
  const redis = client();
  if (!redis) return null;
  try { return await redis.getdel<PendingDraft>(pendingKey(phone)); } catch { return null; }
}

export async function hasPending(phone: string): Promise<boolean> {
  const redis = client();
  if (!redis) return false;
  try { return Boolean(await redis.exists(pendingKey(phone))); } catch { return false; }
}

export async function clearPending(phone: string): Promise<void> {
  const redis = client();
  if (!redis) return;
  try { await redis.del(pendingKey(phone)); } catch { /* Expiry is safe. */ }
}

export interface ConversationTurn {
  role: "user" | "assistant";
  text: string;
}

export async function getConversation(phone: string): Promise<ConversationTurn[]> {
  const redis = client();
  if (!redis) return [];
  try {
    const turns = await redis.get<ConversationTurn[]>(conversationKey(phone));
    return Array.isArray(turns) ? turns.slice(-CONVERSATION_TURNS) : [];
  } catch {
    return [];
  }
}

export async function appendConversation(phone: string, turns: ConversationTurn[]): Promise<void> {
  const redis = client();
  if (!redis) return;
  try {
    const current = await getConversation(phone);
    const next = [...current, ...turns]
      .map((turn) => ({ ...turn, text: turn.text.slice(0, 1_500) }))
      .slice(-CONVERSATION_TURNS);
    await redis.set(conversationKey(phone), next, { ex: CONVERSATION_TTL_SECONDS });
  } catch {
    // Conversation memory improves follow-ups but never gates an ERP action.
  }
}

export async function clearConversation(phone: string): Promise<void> {
  const redis = client();
  if (!redis) return;
  try { await redis.del(conversationKey(phone)); } catch { /* Expiry is safe. */ }
}
