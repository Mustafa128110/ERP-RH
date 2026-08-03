# JavaScript Standards (compiled output + unavoidable plain JS)

All first-party code is authored as TypeScript. This file governs
what ships and the rare exceptions:

- Output: ES2019 target (mid-range Android reality), ES modules,
  defer-loaded, per-template.
- No window globals except the single documented entry per bundle.
- Inline <script> in Liquid: forbidden, except (a) JSON state
  islands (application/json — not executable) and (b) JSON-LD
  schema blocks. Nothing else.
- Third-party scripts: only from the app allowlist (L6 §4); each
  audited quarterly for weight and main-thread cost; loaded with
  defer/consented patterns, never document.write.
- Checkout and payment surfaces: NEVER touched by custom JS.
  Shopify owns them (security.md).
- Feature detection over UA sniffing; the site must degrade to
  fully-functional HTML with all JS blocked.