# Design System — Component Specifications

Every component: anatomy · sizes · states · rules. Built as rh-
snippets/sections (06-shopify/components.md is the code registry;
this file is the spec authority). New UI without a spec here is a
review-blocking defect — component-generator skill drafts the spec
first.

═══════════════════════════════════════════════════════════

## 1. Button

Sizes: 48px default · 40px compact (toolbars, cart rows) · 56px
hero CTA. Padding 16–24px horizontal; radius 4px; label Inter 600,
16px (14px compact); icon 20px, 8px gap.

| Variant | Ground | Text | Hover | Pressed | Use |
|---|---|---|---|---|---|
| Primary | navy-800 | white | navy-700 | navy-900 | main action per view |
| Secondary | white | navy-800 | ivory | sand ground | supporting actions |
|  | +1.5px navy-800 border | | | | |
| Accent | brass-600 | white | brass-400 | brass-700 | ADD TO CART + CHECKOUT ONLY — the transaction is the ceremony |
| Ghost | transparent | navy-800 | navy-100 ground | navy-200 | tertiary, inline |
| Destructive | error | white | darken 8% | darken 12% | admin only, never storefront |

States (all variants): focus = 2px navy ring, 2px offset · disabled
= 40% opacity, no pointer · loading = spinner replaces label, WIDTH
LOCKED (no jump). Icon-only requires aria-label. The accent button
counts as the view's brass moment — a view with an accent button
gets no other brass.

## 2. Inputs & Forms

Text input: 48px, white, 1px sand border, 4px radius, 16px text.
Label ABOVE, always visible (never placeholder-only); placeholder =
example, steel. Focus: navy-800 border + ring. Error: error border +
plain-language message below (EN/UR), error-tint ground optional.
Select: same box, chevron 20px steel. Textarea: min 96px.
Quantity stepper: 40px minimum tap targets on +/− (bulk buyers on
phones), value tabular. Search: icon-in-field, full-width drawer on
mobile. Checkbox/radio: 20px, navy-800 checked, 4px/50% radius.

## 3. Trust Microbar (signature)

Position: above header, full-width, white ground, 1px sand bottom
hairline. Content: "Genuine stock · Since 1990 · Nationwide COD" —
overline token, steel, interpuncts sand. Static. NEVER animated,
never dismissible, never carries promotions. On /ur: mirrored,
Naskh, same restraint.

## 4. Header / Navbar

White, L0 + bottom hairline → L1 shadow when stuck (scroll >0).
Desktop: monogram+wordmark left · category nav (taxonomy order) ·
search · EN/اردو toggle · cart (count badge navy) · WhatsApp icon.
Mobile: menu (drawer, left; RTL right) · logo center · search +
cart right. Active nav item: navy-800 + 2px navy underline offset
4px. Height 64/56px.

## 5. Hero (rh-hero)

Variant A — navy band: navy-800 ground, display-xl white, optional
brass-600 hairline under headline (THE brass moment), support line
navy-200, one primary-inverted or accent CTA. Variant B — white
photography-led: catalog-register image right/full-bleed, text
block left on white. Both: ≤70vh desktop, natural height mobile,
ONE headline + ONE support line + ONE CTA. The overline token may
kick the headline ("SINCE 1990").

## 6. Product Card

White, 1px sand, 6px radius, padding 12px. Anatomy top→down:
image (square, white, rh-image) → title (heading token, 2-line
clamp) → price (price token) + ladder hint small/steel if
bulk-available → stock badge → quick-add (secondary 40px, full
width). Hover: border→steel + translateY(-2px), 250ms machined.
Entire card clickable; quick-add its own hit area. Max TWO badges.
Grid: 2 cols mobile / 3 tablet / 4 desktop, 16–24px gap.

## 7. Badges

Base: 12px Inter 500, 4–8px padding, 4px radius.
- Stock: In stock (success-tint/success) · Low stock (warning-tint/
  warning — only when literally true) · Available to order — X days
  (ivory/steel).
- **Genuine badge (protected):** brass-100 ground, seal icon
  brass-600 16px, text navy-800. PRODUCT CONTEXTS ONLY — never on
  promotions, discounts, banners. Counts as the brass moment.
- Royal pick: navy-100 ground, navy-800 text.

## 8. Price Block (rh-price)

Price token (navy-800, tabular). Compare-at (real discounts only):
steel strikethrough BEFORE the price, discount never shouted.
Bulk ladder hint under price on consumables: small token, steel —
"piece / box / carton — trade rates on WhatsApp" → whatsapp_click.
Unit qualifiers explicit: "per foot", "box of 50".

## 9. Spec Table (rh-spec-table)

Fixed row order (product-template §5). Zebra: white/ivory rows,
sand hairlines. Label col: small token steel; value col: body ink,
numerals tabular with units. Warranty row is the trust row — value
rendered honestly from royal.warranty_source, localized. Mobile:
same table, no horizontal scroll (labels stack if needed).

## 10. Accordion (rh-faq-accordion)

Rows: 1px sand dividers, question subhead ink, chevron 20px steel
rotating 180° / 250ms machined. Mobile one-open; desktop multiple.
FAQPage JSON-LD emitted. Content: body token, may contain links
(navy, underlined on hover).

## 11. Modal & Drawer

Modal: max 560px, 12px radius, L2, scrim ink@50%. Header subhead +
24px close (44px hit area). Cart drawer: right (RTL left), 420px
max, L2; footer pinned with subtotal (price token) + accent
checkout button. Both: focus-trapped, Esc closes, background scroll
locked, entrance 350ms machined (drawer slides, modal fades+rises
8px).

## 12. Alerts & Toasts

Alert (inline): semantic-tint ground, 4px radius, icon 20px + body
+ optional ghost action. Uses: delivery notices, stock warnings,
form-level errors. Toast: bottom-center mobile / bottom-right
desktop (RTL mirrored), white, L1, 4s auto-dismiss, one at a time
("Added to cart" + view-cart ghost action).

## 13. Breadcrumbs (rh-breadcrumbs)

small token: steel links · ink current · sand "/" separators.
Mirrors on RTL. BreadcrumbList schema.

## 14. Footer (rh-footer)

Navy-800 anchor band. Columns: Categories / Customer service
(delivery, returns, warranty — the trust pages) / Company (story,
institutional supply) / Contact (NAP matching GBP + schema, phone,
WhatsApp). Column headings: overline token brass-400 (the footer's
brass moment). Links navy-200 → white hover. Bottom strip: payment
+ COD marks (grayscale white), language toggle, legal links, seal
16px.

## 15. Carousel (Splide)

Exactly three uses: PDP gallery (thumbs below, pinch-zoom mobile) ·
related products · home featured. Arrows 40px ghost-on-white, dots
sand/navy active. 350ms machined. Autoplay only optional home hero:
6s, pause on hover, killed by reduced-motion. NEVER body content or
reviews. dir follows locale.

## 16. Wholesale Set (rh-wholesale-hero, rh-ladder-explainer)

Hero: Variant A navy with dispatch-proof photography inset. Ladder
explainer: three tiles (piece → box → carton) connected by sand
hairline arrows, each tile white/1px sand with icon 24px, the trade
tile carrying "quoted personally" + WhatsApp accent CTA (the view's
brass moment). Named-person promise line: body, ink. This set is
the Phase-2 ads landing target — it converts to conversations.