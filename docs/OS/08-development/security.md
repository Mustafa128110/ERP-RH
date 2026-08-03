# Security

## Platform Boundary (the biggest rule)
Shopify owns payments, PCI, checkout, and customer auth. We NEVER:
build custom payment handling · inject JS into checkout · proxy or
store payment data · roll our own auth. Full stop.

## Theme-Level Rules
- Escape all user-generated content in Liquid (`| escape`) —
  reviews, echoed search terms, any customer text.
- No customer PII in: localStorage, analytics payloads (typed
  event map makes it structurally impossible), console, URLs,
  or error messages.
- JSON state islands contain product/UI state only — never
  customer data.
- Admin API keys/tokens: never in theme code, never in the repo,
  never in client-side anything. Server-side needs (if any ever)
  get a decision log and a proper backend — not a workaround.
- Third-party scripts: allowlist only (L6 §4); each new script is
  an XSS surface and gets reviewed as one.
- Forms: Shopify-native endpoints; no custom collection of
  sensitive data on the theme.

## Account & Access Hygiene (8 staff — this matters)
- Per-person accounts, least privilege, on Shopify/Google/Meta/
  GitHub. Shared logins are forbidden.
- 2FA mandatory everywhere (19-recovery/access.md); recovery codes
  per the physical two-location rule.
- Staff offboarding: same-day access removal — a checklist item in
  the (future) HR SOP, referenced here so it isn't forgotten.
- Secrets live in the password manager, period. A secret that
  touches git: rotate immediately, scrub history, log in
  mistakes.md.

## Data Minimalism
Collect only what fulfillment needs. The question log and tags
hold business context, not identity documents. When in doubt,
don't store it — trust positioning extends to data conduct.