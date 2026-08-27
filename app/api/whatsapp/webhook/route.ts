import { type NextRequest, NextResponse } from "next/server";
import { hasValidWhatsAppSignature, isWhatsAppWebhookVerification, isWebhookPayload } from "@/lib/whatsapp-webhook";

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

  if (isWhatsAppWebhookVerification({
    mode: searchParams.get("hub.mode"),
    token: searchParams.get("hub.verify_token"),
    challenge,
    expectedToken: process.env.WHATSAPP_VERIFY_TOKEN,
  })) {
    return textResponse(challenge!, 200);
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

    if (!isWebhookPayload(JSON.parse(body))) return textResponse("Invalid payload", 400);

    // This endpoint deliberately only authenticates and acknowledges provider
    // events. Inbound command handling must go through the existing confirmed,
    // audited ERP action flow rather than becoming a second write path here.
    return NextResponse.json({ received: true }, { headers: noStore });
  } catch {
    return textResponse("Invalid payload", 400);
  }
}
