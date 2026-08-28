import { createHmac, timingSafeEqual } from "node:crypto";

const SIGNATURE_PREFIX = "sha256=";

function sameSecret(left: string, right: string) {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

export function isWhatsAppWebhookVerification(values: {
  mode: string | null;
  token: string | null;
  challenge: string | null;
  expectedToken: string | undefined;
}) {
  const expectedToken = values.expectedToken?.trim();
  return Boolean(
    values.challenge
      && values.mode === "subscribe"
      && values.token
      && expectedToken
      && sameSecret(values.token, expectedToken),
  );
}

export function hasValidWhatsAppSignature(body: string, signature: string | null, appSecret: string | undefined) {
  if (!signature?.startsWith(SIGNATURE_PREFIX) || !appSecret) return false;
  const received = signature.slice(SIGNATURE_PREFIX.length);
  const expected = createHmac("sha256", appSecret).update(body).digest("hex");
  return sameSecret(received, expected);
}

export function isWebhookPayload(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export interface WhatsAppInboundMessage {
  id: string;
  from: string;
  text: string;
  phoneNumberId: string;
}

export interface WhatsAppDeliveryStatus {
  id: string;
  status: string;
  phoneNumberId: string;
}

function entries(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isWebhookPayload) : [];
}

// The Cloud API may batch several entries and status callbacks with inbound
// messages. Reduce its untrusted JSON to the tiny data shape the app needs.
export function parseWhatsAppWebhook(value: Record<string, unknown>) {
  const inbound: WhatsAppInboundMessage[] = [];
  const statuses: WhatsAppDeliveryStatus[] = [];
  if (value.object !== "whatsapp_business_account") return { inbound, statuses };
  for (const entry of entries(value.entry)) {
    for (const change of entries(entry.changes)) {
      if (change.field !== "messages" || !isWebhookPayload(change.value)) continue;
      const payload = change.value;
      const metadata = isWebhookPayload(payload.metadata) ? payload.metadata : null;
      const phoneNumberId = typeof metadata?.phone_number_id === "string" ? metadata.phone_number_id : "";
      if (!phoneNumberId) continue;
      for (const message of entries(payload.messages)) {
        const text = isWebhookPayload(message.text) && typeof message.text.body === "string" ? message.text.body.trim() : "";
        if (typeof message.id === "string" && typeof message.from === "string" && message.type === "text" && text) {
          inbound.push({ id: message.id, from: message.from, text, phoneNumberId });
        }
      }
      for (const status of entries(payload.statuses)) {
        if (typeof status.id === "string" && typeof status.status === "string") statuses.push({ id: status.id, status: status.status, phoneNumberId });
      }
    }
  }
  return { inbound, statuses };
}
