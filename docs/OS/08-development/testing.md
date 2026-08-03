# Testing — right-sized, honest, boring

No unit-test theater for a Liquid theme. The strategy: automate
what machines catch well, ritualize what humans catch well, and
log every escape.

## Layer 1 — CI (every PR, automatic)
theme-check (Liquid lint) · tsc --noEmit (strict) · ESLint ·
bundle-size gate · locale missing-key report (ur.json coverage) ·
grep gates (raw hex, physical CSS props, direct GSAP imports,
unlocalized strings, `any`) · Lighthouse CI on preview
(home/collection/product, both locales).

## Layer 2 — The Manual Test Matrix (before every main merge)
Devices: Chrome desktop · mid-range Android Chrome (real device) ·
iPhone Safari.
Locales: EN · UR (RTL — includes a keyboard walk-through).
Pages: home · collection (filters!) · product (gallery, qty
stepper, bulk hint, FAQs) · cart drawer · checkout-to-COD start.
Plus per-release: reduced-motion spot check · one schema
validation pass · analytics event spot-check (whatsapp_click,
bulk_cta_click firing with clean payloads).
Results recorded as a pass/fail table in the release PR.

## Layer 3 — Critical-Flow Discipline
The money paths get extra paranoia every release, no exceptions:
add-to-cart → drawer → checkout(COD) · WhatsApp CTA from PDP ·
language toggle mid-journey (cart survives locale switch) ·
stock-state rendering for all three honest states.

## Escapes
Any bug reaching production: reproduction note in 16-knowledge/
mistakes.md BEFORE the fix (bug-hunter skill procedure) — what
happened, root cause, which layer should have caught it, what
changed so it can't recur. Same bug twice = process failure, and
the process (this file) gets patched, not just the code.