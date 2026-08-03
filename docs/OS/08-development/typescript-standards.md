# TypeScript Standards

- strict: true. No `any` — use `unknown` + narrowing.
- ESLint + Prettier, near-default configs. Formatters decide; no
  bikeshedding.
- Module per feature: cart.ts, product-gallery.ts, bulk-pricing.ts.
  Each exports init() that guards for its DOM (absent element → do
  nothing) — this makes per-template loading safe.
- DOM access via typed helpers; no scattered querySelector casts.
- No frameworks in the theme. Vanilla TS + GSAP/Lenis/Splide only.
  Anything more requires a decision log first.