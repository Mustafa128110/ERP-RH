import "server-only";

const API_VERSION = process.env.WHATSAPP_API_VERSION?.trim() || "v25.0";
const TIMEOUT_MS = 10_000;

function credential(name: string): string | null {
  const value = process.env[name]?.trim();
  return value && !/^(replace|your|xxx|placeholder|change[-_]me|todo)/i.test(value) ? value : null;
}

export function whatsappProviderConfigured() {
  return Boolean(credential("WHATSAPP_PHONE_NUMBER_ID") && credential("WHATSAPP_ACCESS_TOKEN"));
}

export async function sendWhatsAppText(to: string, body: string): Promise<{ ok: true; providerMessageId: string | null } | { ok: false; error: string }> {
  const phoneNumberId = credential("WHATSAPP_PHONE_NUMBER_ID");
  const accessToken = credential("WHATSAPP_ACCESS_TOKEN");
  if (!phoneNumberId || !accessToken) return { ok: false, error: "The WhatsApp provider is not configured." };
  try {
    const response = await fetch(`https://graph.facebook.com/${API_VERSION}/${phoneNumberId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", to, type: "text", text: { preview_url: false, body: body.slice(0, 4000) } }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const payload = await response.json().catch(() => null) as { messages?: { id?: string }[]; error?: { message?: string; error_user_msg?: string } } | null;
    if (!response.ok) return { ok: false, error: payload?.error?.error_user_msg ?? payload?.error?.message ?? "WhatsApp could not send the reply." };
    return { ok: true, providerMessageId: payload?.messages?.[0]?.id ?? null };
  } catch {
    return { ok: false, error: "WhatsApp could not be reached." };
  }
}
