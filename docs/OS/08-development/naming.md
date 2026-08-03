# Naming — one vocabulary across code, content, and commerce

## Files & Code
- Files: kebab-case (rh-product-card.liquid, bulk-pricing.ts).
- TS: camelCase values/functions · PascalCase types/interfaces ·
  UPPER_SNAKE constants.
- CSS: BEM with prefix — rh-card, rh-card__price, rh-card--featured.
  Utility classes: rh-u-* (rare; components over utilities).
- JS hooks: data-rh-* attributes exclusively (typescript-standards).
- Tokens: as defined in L7 foundations (--navy-800, --space-4,
  --text-overline, --motion-standard, --ease-machined).
- Locale keys: surface.component.purpose (cart.drawer.checkout).
- Events: snake_case matching the L6 analytics set (whatsapp_click).

## Commerce (shared with ops — one code everywhere)
- SKU: RH-{CAT}-{NNNN} — RH-DSC-0115, RH-SHV-0001, RH-CHN-0230.
  Category codes: DSC discs · SHV shovels · PWT power tools ·
  HND hand tools · CHN chains · LCK locks · SFT safety ·
  CNS construction. Registry of issued codes lives with inventory.
- Photos: {SKU}-{view}.{ext} — views: front, quarter, proof, scale
  (the v2 photography registers, L2).
- Metafields: namespace royal.* only (schema in L3).
- Collections/handles: mirror taxonomy.md; kebab-case; never
  renamed without a redirect entry (L6 seo).
- Branches/PRs reference SKUs or doc paths when relevant — the
  thread from commerce to code stays greppable.