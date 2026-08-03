import "server-only";

// The provider adapter. One function that puts a text message on its way, and
// one that says whether that is possible at all.
//
// Meta's WhatsApp Cloud API, because that is the one you can use without a
// reseller: a phone number id and a permanent access token from the Meta app,
// both read from the environment. Nothing here is specific enough to Meta that
// swapping in Twilio would touch anything outside this file.
//
// Configuration lives in .env:
//
//   WHATSAPP_PHONE_NUMBER_ID   the sending number's id from the Meta dashboard
//   WHATSAPP_ACCESS_TOKEN      a permanent token for that app
//   WHATSAPP_API_VERSION       optional, defaults below
//   WHATSAPP_COUNTRY_CODE      optional, defaults to 92 (lib/whatsapp-templates.ts)
//
// With none of it set the app still works: messages are written to the log as
// `queued` and the page says plainly that no provider is connected, rather than
// pretending to send and reporting success.

const API_VERSION = process.env.WHATSAPP_API_VERSION ?? "v21.0";

// .env ships with named placeholders rather than blanks, so "is it set" is not
// the same question as "is it real" — and a Settings page reporting Connected
// against `replace-with-a-random-verify-token` is worse than one reporting
// nothing, because it sends people looking for the fault somewhere else.
function credential(name: string): string | null {
  const value = process.env[name]?.trim();
  if (!value) return null;
  return /^(replace|your|xxx|placeholder|change[-_]me|todo)/i.test(value) ? null : value;
}

const PHONE_NUMBER_ID = credential("WHATSAPP_PHONE_NUMBER_ID");
const ACCESS_TOKEN = credential("WHATSAPP_ACCESS_TOKEN");

export function isConfigured(): boolean {
  return Boolean(PHONE_NUMBER_ID && ACCESS_TOKEN);
}

export type SendResult = { ok: true; providerMessageId: string | null } | { ok: false; error: string };

// A hung request would hold a server action open for as long as the socket
// lasts; the shop would rather be told it failed.
const TIMEOUT_MS = 15_000;

export async function sendText(to: string, body: string): Promise<SendResult> {
  if (!isConfigured()) {
    return { ok: false, error: "No WhatsApp provider is connected. Set WHATSAPP_PHONE_NUMBER_ID and WHATSAPP_ACCESS_TOKEN." };
  }

  try {
    const response = await fetch(`https://graph.facebook.com/${API_VERSION}/${PHONE_NUMBER_ID}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${ACCESS_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to,
        type: "text",
        // preview_url off: a link in an invoice message is a reference, and a
        // link preview card pushes the numbers off the first screen.
        text: { preview_url: false, body },
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    const payload = (await response.json().catch(() => null)) as
      | { messages?: { id: string }[]; error?: { message?: string; error_user_msg?: string } }
      | null;

    if (!response.ok) {
      // Meta puts the message a human should read in error_user_msg when it has
      // one; `message` is the developer-facing version.
      const detail = payload?.error?.error_user_msg ?? payload?.error?.message ?? `HTTP ${response.status}`;
      return { ok: false, error: detail };
    }

    return { ok: true, providerMessageId: payload?.messages?.[0]?.id ?? null };
  } catch (e) {
    // A timeout or a DNS failure. The message row is already written, so it can
    // be retried from the log rather than retyped.
    const reason = e instanceof Error && e.name === "TimeoutError" ? "the provider didn't respond in time" : "the provider couldn't be reached";
    return { ok: false, error: `Couldn't send — ${reason}. The message is saved and can be retried.` };
  }
}
