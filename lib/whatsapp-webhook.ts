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
