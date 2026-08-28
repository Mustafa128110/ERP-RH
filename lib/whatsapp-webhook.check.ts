import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { hasValidWhatsAppSignature, isWhatsAppWebhookVerification, isWebhookPayload, parseWhatsAppWebhook } from "@/lib/whatsapp-webhook";

const verifyToken = "verify-token";
const appSecret = "app-secret";
const body = JSON.stringify({ object: "whatsapp_business_account", entry: [] });
const signature = `sha256=${createHmac("sha256", appSecret).update(body).digest("hex")}`;

assert.equal(isWhatsAppWebhookVerification({ mode: "subscribe", token: verifyToken, challenge: "challenge", expectedToken: verifyToken }), true);
assert.equal(isWhatsAppWebhookVerification({ mode: "subscribe", token: verifyToken, challenge: "challenge", expectedToken: ` ${verifyToken}\n` }), true);
assert.equal(isWhatsAppWebhookVerification({ mode: "subscribe", token: "wrong", challenge: "challenge", expectedToken: verifyToken }), false);
assert.equal(isWhatsAppWebhookVerification({ mode: "unsubscribe", token: verifyToken, challenge: "challenge", expectedToken: verifyToken }), false);
assert.equal(hasValidWhatsAppSignature(body, signature, appSecret), true);
assert.equal(hasValidWhatsAppSignature(body, `sha256=${"0".repeat(64)}`, appSecret), false);
assert.equal(hasValidWhatsAppSignature(body, signature, undefined), false);
assert.equal(isWebhookPayload({ object: "whatsapp_business_account" }), true);
assert.equal(isWebhookPayload([]), false);
assert.equal(isWebhookPayload(null), false);
const events = parseWhatsAppWebhook({
  object: "whatsapp_business_account",
  entry: [{ changes: [{ field: "messages", value: {
    metadata: { phone_number_id: "phone-id" },
    messages: [{ id: "inbound-id", from: "923001234567", type: "text", text: { body: " stock cement " } }, { id: "image", from: "923001234567", type: "image" }],
    statuses: [{ id: "outbound-id", status: "delivered" }],
  } }] }],
});
assert.deepEqual(events.inbound, [{ id: "inbound-id", from: "923001234567", text: "stock cement", phoneNumberId: "phone-id" }]);
assert.deepEqual(events.statuses, [{ id: "outbound-id", status: "delivered", phoneNumberId: "phone-id" }]);
assert.ok(
  fs.readFileSync(path.join(process.cwd(), "proxy.ts"), "utf8").includes('request.nextUrl.pathname === "/api/whatsapp/webhook"'),
  "the public Meta callback must not be redirected to the ERP login page",
);

console.log("WhatsApp webhook checks passed");
