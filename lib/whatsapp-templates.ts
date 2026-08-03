// The messages the shop sends, and the phone-number rules they're sent under.
// Pure functions on purpose — no database, no network — so both the server
// action and lib/whatsapp-templates.check.ts can exercise them, and so the
// wording lives in one file rather than being assembled at three call sites.

// Pakistan. Numbers are written locally ("0300-1234567") and WhatsApp wants
// them in full international form with no punctuation and no leading plus.
const DEFAULT_COUNTRY_CODE = process.env.WHATSAPP_COUNTRY_CODE ?? "92";

// "0300-1234567" -> "923001234567". Returns null for anything that can't be a
// phone number, so a message is never sent to a mangled address — the caller
// reports it as a bad number rather than the provider silently swallowing it.
export function normalizePhone(raw: string, countryCode = DEFAULT_COUNTRY_CODE): string | null {
  const digits = raw.replace(/[^\d+]/g, "");
  if (!digits) return null;

  // Already international: +92300…, or 0092300…
  let national = digits.startsWith("+") ? digits.slice(1) : digits.startsWith("00") ? digits.slice(2) : null;
  if (national !== null) {
    return national.length >= 8 && national.length <= 15 ? national : null;
  }

  // Local form: a single leading 0 is the trunk prefix and is dropped.
  national = digits.replace(/^0+/, "");
  if (national.length < 7 || national.length > 13) return null;
  // Already carries the country code without a plus (923001234567).
  if (digits.startsWith(countryCode) && digits.length >= countryCode.length + 9) return digits;
  return countryCode + national;
}

// A click-to-chat link: opens WhatsApp — the desktop app, or web, or the phone —
// with the conversation open and the message already typed, ready to send.
//
// This is the free path, and the one with no ban risk attached. Meta charges per
// message on the Cloud API and forbids the unofficial libraries outright; wa.me
// is Meta's own documented link format, sends from the user's own account, and
// costs nothing. The trade is one tap: the ERP writes the message, a person
// sends it.
//
// Returns null for a number that can't be normalised, same contract as
// normalizePhone — a link to a mangled number opens an empty chat with nobody.
export function waMeLink(rawPhone: string, body: string): string | null {
  const phone = normalizePhone(rawPhone);
  if (!phone) return null;
  // encodeURIComponent, not URLSearchParams: the latter encodes spaces as "+",
  // which WhatsApp renders literally in the message box.
  return `https://wa.me/${phone}?text=${encodeURIComponent(body)}`;
}

export type TemplateKey = "invoice" | "quotation" | "payment_received" | "outstanding_reminder" | "custom";

export const TEMPLATE_LABELS: Record<TemplateKey, string> = {
  invoice: "Invoice",
  quotation: "Quotation",
  payment_received: "Payment Received",
  outstanding_reminder: "Outstanding Reminder",
  custom: "Custom Message",
};

export type TemplateInput = {
  companyName: string;
  recipientName: string;
  documentNumber?: string;
  amount?: string;
  balance?: string;
  date?: string;
  validUntil?: string;
  // Only for "custom", where the whole body is typed.
  body?: string;
};

// Plain text, not WhatsApp's approved-template format. A business-initiated
// message outside a 24-hour customer window needs a template the provider has
// approved; these are what goes out inside that window, and what the preview
// shows either way. Nothing here is HTML — WhatsApp renders *bold* itself.
export function renderTemplate(key: TemplateKey, input: TemplateInput): string {
  const { companyName, recipientName, documentNumber, amount, balance, date, validUntil } = input;
  const hello = `Assalam-o-Alaikum ${recipientName},`;
  const signoff = `\n\n— ${companyName}`;

  switch (key) {
    case "invoice":
      return (
        `${hello}\n\nYour invoice *${documentNumber}* dated ${date} is ready.\n` +
        `Total: *${amount}*` +
        (balance && Number(balance.replace(/[^\d.-]/g, "")) > 0 ? `\nBalance outstanding: *${balance}*` : `\nPaid in full — thank you.`) +
        signoff
      );

    case "quotation":
      return (
        `${hello}\n\nHere is quotation *${documentNumber}* dated ${date}.\n` +
        `Total: *${amount}*` +
        (validUntil ? `\nValid until: ${validUntil}` : "") +
        `\n\nLet us know if you would like to go ahead.` +
        signoff
      );

    case "payment_received":
      return `${hello}\n\nWe have received your payment of *${amount}*${documentNumber ? ` against ${documentNumber}` : ""}.\nThank you.${signoff}`;

    case "outstanding_reminder":
      return `${hello}\n\nA friendly reminder that *${balance}* is outstanding on your account.\nPlease get in touch if anything looks wrong.${signoff}`;

    case "custom":
      return (input.body ?? "").trim();
  }
}
