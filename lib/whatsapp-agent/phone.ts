const DEFAULT_COUNTRY_CODE = "92";

// Meta reports sender identifiers as international digits.  The Users screen
// accepts the locally-written Pakistani form too, but always stores the one
// canonical representation the webhook will later match.
export function normalizeWhatsAppNumber(raw: string, countryCode = process.env.WHATSAPP_COUNTRY_CODE?.trim() || DEFAULT_COUNTRY_CODE): string | null {
  const compact = raw.trim().replace(/[\s().-]/g, "");
  if (!compact) return null;

  let digits: string;
  if (compact.startsWith("+")) {
    digits = compact.slice(1);
  } else if (compact.startsWith("00")) {
    digits = compact.slice(2);
  } else if (/^\d+$/.test(compact) && compact.startsWith(countryCode)) {
    digits = compact;
  } else if (/^\d+$/.test(compact)) {
    const local = compact.replace(/^0+/, "");
    digits = `${countryCode}${local}`;
  } else {
    return null;
  }

  return /^\d{8,15}$/.test(digits) ? digits : null;
}

export function maskedWhatsAppNumber(phone: string | null | undefined): string {
  if (!phone) return "";
  return phone.length <= 4 ? "••••" : `••••${phone.slice(-4)}`;
}
