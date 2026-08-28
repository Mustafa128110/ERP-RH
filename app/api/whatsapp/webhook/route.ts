import { type NextRequest, NextResponse } from "next/server";
import { handleInboundMessage } from "@/lib/whatsapp-agent/agent";
import { sendWhatsAppText } from "@/lib/whatsapp";
import { hasValidWhatsAppSignature, isWhatsAppWebhookVerification, isWebhookPayload, parseWhatsAppWebhook } from "@/lib/whatsapp-webhook";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_WEBHOOK_BYTES = 1_000_000;
const noStore = { "Cache-Control": "no-store" };

function textResponse(body: string, status: number) {
  return new NextResponse(body, { status, headers: noStore });
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const challenge = searchParams.get("hub.challenge");
  const mode = searchParams.get("hub.mode");
  const expectedToken = process.env.WHATSAPP_VERIFY_TOKEN;

  if (isWhatsAppWebhookVerification({
    mode,
    token: searchParams.get("hub.verify_token"),
    challenge,
    expectedToken,
  })) {
    return textResponse(challenge!, 200);
  }

  // Safe operational signal for Vercel logs. It never records the callback
  // token, challenge, request body, sender, or message content.
  if (mode === "subscribe") {
    console.warn("WhatsApp webhook verification rejected.", {
      hasChallenge: Boolean(challenge),
      verifyTokenConfigured: Boolean(expectedToken?.trim()),
    });
  }

  return textResponse("Forbidden", 403);
}

export async function POST(request: NextRequest) {
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_WEBHOOK_BYTES) return textResponse("Payload too large", 413);
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) return textResponse("Unsupported media type", 415);

  try {
    const body = await request.text();
    if (new TextEncoder().encode(body).byteLength > MAX_WEBHOOK_BYTES) return textResponse("Payload too large", 413);
    if (!hasValidWhatsAppSignature(body, request.headers.get("x-hub-signature-256"), process.env.WHATSAPP_APP_SECRET)) {
      return textResponse("Unauthorized", 401);
    }

    const payload = JSON.parse(body);
    if (!isWebhookPayload(payload)) return textResponse("Invalid payload", 400);
    const { inbound } = parseWhatsAppWebhook(payload);
    const configuredPhoneId = process.env.WHATSAPP_PHONE_NUMBER_ID?.trim();
    const messages = configuredPhoneId ? inbound.filter((message) => message.phoneNumberId === configuredPhoneId) : [];
    const results = await Promise.all(messages.map(async (message) => {
      const outcome = await handleInboundMessage(message);
      if (outcome.reply) await sendWhatsAppText(message.from, outcome.reply);
      return outcome;
    }));
    if (results.some((result) => result.retry)) return textResponse("Service unavailable", 503);
    return NextResponse.json({ received: true }, { headers: noStore });
  } catch {
    return textResponse("Invalid payload", 400);
  }
}
