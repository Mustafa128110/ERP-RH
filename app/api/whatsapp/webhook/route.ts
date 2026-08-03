import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { applyDeliveryStatuses } from "@/lib/actions/whatsapp-webhook";
import { handleMessage } from "@/lib/whatsapp-agent/agent";
import { PendingStore } from "@/lib/whatsapp-agent/pending";
import { sendText } from "@/lib/whatsapp";

// Both halves of a WhatsApp conversation arrive here.
//
// Outbound: sending sets a row to `sent`; whether it was actually delivered and
// read is something only Meta knows, and it tells you here. Without this the log
// would be permanently stuck at "sent", which answers the wrong question — "did
// it arrive" is what anyone chasing a customer wants to know.
//
// Inbound: a message from a number mapped to a user
// (lib/whatsapp-agent/identity.ts) is answered by the agent. Replying costs
// nothing — an inbound message opens a 24-hour customer-service window and
// service replies inside it are free under Meta's per-message pricing, which is
// the entire reason this feature can exist without a bill attached.
//
// Two verbs, both required by the Cloud API:
//
//   GET   the one-time subscription handshake — echo hub.challenge back if the
//         verify token matches the one configured in the Meta dashboard.
//   POST  status callbacks and inbound messages, signed with the app secret.

export const dynamic = "force-dynamic";

const VERIFY_TOKEN = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;
const APP_SECRET = process.env.WHATSAPP_APP_SECRET;

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const mode = params.get("hub.mode");
  const token = params.get("hub.verify_token");
  const challenge = params.get("hub.challenge");

  // No token configured means nothing may subscribe — an open handshake would
  // let anyone point their own app at this endpoint.
  if (!VERIFY_TOKEN) return new NextResponse("not configured", { status: 503 });
  if (mode !== "subscribe" || token !== VERIFY_TOKEN) return new NextResponse("forbidden", { status: 403 });

  // Meta expects the challenge echoed as plain text, not JSON.
  return new NextResponse(challenge ?? "", { status: 200, headers: { "content-type": "text/plain" } });
}

// The signature is over the exact bytes Meta sent, so the body has to be read as
// text and parsed afterwards — re-serialising a parsed object changes the bytes
// and the check would never pass.
function signatureMatches(raw: string, header: string | null): boolean {
  if (!APP_SECRET || !header?.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", APP_SECRET).update(raw).digest();
  const received = Buffer.from(header.slice("sha256=".length), "hex");
  // Lengths must match before timingSafeEqual, which throws on a mismatch.
  return received.length === expected.length && timingSafeEqual(received, expected);
}

type InboundMessage = { id?: string; from?: string; type?: string; text?: { body?: string } };

type WebhookPayload = {
  entry?: {
    changes?: {
      value?: {
        statuses?: { id?: string; status?: string; errors?: { title?: string; message?: string }[] }[];
        messages?: InboundMessage[];
      };
    }[];
  }[];
};

// Meta redelivers a webhook it didn't get a prompt 200 for, and the agent takes
// long enough (a database round trip, sometimes an LLM call) to make that a real
// possibility. Without this, a retry would post a second invoice for the same
// "yes". Keyed by Meta's message id, which is stable across retries.
//
// ponytail: in-memory and per instance, same trade as the pending-draft store —
// correct for the single instance this runs on. An hour is far longer than
// Meta's retry schedule.
const seen = new PendingStore<true>(60 * 60 * 1000);

async function handleInbound(messages: InboundMessage[]): Promise<void> {
  for (const message of messages) {
    // Voice notes, images, locations, reactions: nothing to parse, and
    // pretending otherwise would mean replying "I don't understand" to a photo
    // of an invoice, which is worse than saying nothing.
    if (message.type !== "text") continue;

    const id = message.id;
    const from = message.from;
    const body = message.text?.body;
    if (!id || !from || !body) continue;
    if (seen.has(id)) continue;
    seen.set(id, true);

    // Null means the number isn't mapped to a user — no reply at all. See
    // lib/whatsapp-agent/agent.ts for why silence rather than a refusal.
    const reply = await handleMessage(from, body);
    if (reply) await sendText(from, reply);
  }
}

export async function POST(request: NextRequest) {
  const raw = await request.text();

  if (!signatureMatches(raw, request.headers.get("x-hub-signature-256"))) {
    return new NextResponse("bad signature", { status: 401 });
  }

  let payload: WebhookPayload;
  try {
    payload = JSON.parse(raw);
  } catch {
    // Malformed, but acknowledged: a 4xx makes Meta retry the same bad payload
    // on a schedule, forever.
    return NextResponse.json({ ok: true });
  }

  const values = (payload.entry ?? []).flatMap((e) => e.changes ?? []).flatMap((c) => (c.value ? [c.value] : []));

  seen.sweep();
  try {
    await handleInbound(values.flatMap((v) => v.messages ?? []));
  } catch (e) {
    // The reply is lost, but the write it may have performed is not — every
    // mutation is committed and audited before a reply is composed. Acknowledged
    // so Meta doesn't redeliver and run it again.
    console.error("[whatsapp webhook] couldn't handle inbound message", e);
  }

  const updates = values
    .flatMap((v) => v.statuses ?? [])
    .flatMap((s) =>
      s.id && s.status
        ? [{ providerMessageId: s.id, status: s.status, error: s.errors?.[0]?.message ?? s.errors?.[0]?.title ?? null }]
        : [],
    );

  try {
    await applyDeliveryStatuses(updates);
  } catch (e) {
    // Acknowledged anyway. A retry storm on top of a database that is already
    // struggling makes it worse, and the message log being a status behind is
    // not worth that.
    console.error("[whatsapp webhook] couldn't apply statuses", e);
  }

  return NextResponse.json({ ok: true });
}
