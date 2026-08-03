# Design System — Foundations

The bridge between 02-brand (the law) and 06-shopify (the build).
Everything here exists as a token in assets/tokens.css, generated
from 02-brand/colors.json v2 (06-shopify/architecture.md §2).
Raw values below are for reference; code consumes tokens only.

═══════════════════════════════════════════════════════════

## 1. Color Tokens

### Navy ramp (authority)
--navy-900  #0A1A2C   pressed states, deepest bands
--navy-800  #10263F   PRIMARY: buttons, headers, footer, price text
--navy-700  #1E3A5C   secondary panels, hover on 800
--navy-500  #3D5A7E   charts, subdued graphics
--navy-200  #C9D4E2   tints, table stripes
--navy-100  #E8EDF4   info grounds, hero tint blocks

### Brass ramp (the seal — ≤10% of any view)
--brass-700 #8F6E2C   brass text on ivory (large only), pressed
--brass-600 #B08A3C   PRIMARY ACCENT: seals, badges, rules,
                      add-to-cart
--brass-400 #C9A85C   brass on navy, hover on 600
--brass-100 #F5EEDD   genuine-badge ground, highlight tints

### Neutrals (the stage)
--white #FFFFFF · --ivory #F7F5F0 · --sand #E2DFD8 ·
--steel #5B6470 · --ink #1C1E21

### Semantic (+ tints)
--success #1E7A4D / --success-tint #E6F2EC
--warning #B4690E / --warning-tint #FBF1E3
--error   #B3261E / --error-tint   #FAEAE9
--info    #1E4E79 / --info-tint    #E8EDF4

### Usage laws (from 02-brand, enforced in review)
- 70/20/10: ~70% white/ivory · ~20% navy/ink/steel · ~10% brass +
  semantic combined.
- ONE brass moment per view (a badge, a rule, OR the seal — never
  several competing).
- brass-600 on white: large text & UI elements only, NEVER body.
- Semantic colors on white/tint grounds only, never on navy.
- Backgrounds: white default · ivory alternating sections · navy
  bands for hero/footer only · never full navy pages.

## 2. Typography Tokens

Families: --font-display (Fraunces 600) · --font-body (Inter
400/500/600) · --font-ur-display (Noto Nastaliq 400) ·
--font-ur-body (Noto Naskh 400/700).

Scale (desktop/mobile, 1.25 ratio, 4px-snapped):
--text-display-xl  44/32  Fraunces 600   one per page
--text-display     32/26  Fraunces 600   section titles
--text-heading     22/19  Inter 600      card/product titles
--text-subhead     18/17  Inter 500      standfirsts, nav
--text-body        16, lh 1.6  Inter 400
--text-small       13     Inter 400, steel
--text-price       20     Inter 600 tabular, navy-800
--text-overline    12, caps, +150 tracking, Inter 500  kickers

Urdu: +1 step vs EN equivalent; lh ≥1.9 (display ≥2.0); never
letter-spaced; numerals stay Western in prices/specs.
Rules: Fraunces never below 22px · hierarchy = size + ONE other cue
· measure 60–70ch EN body.

## 3. Spacing & Grid

--space-1…9: 4/8/12/16/24/32/48/64/96. Off-scale spacing = defect.
Section rhythm: 64–96px vertical. Grid: 12-col, max 1280px, gutter
24/16. Breakpoints: 480/768/1024/1280. Mobile-first always.
RTL: logical properties exclusively (inline-start/end) — the grid
mirrors for free on /ur.

## 4. Elevation (deliberately flat — "machined calm")

L0  flat; 1px sand hairlines separate            (default)
L1  0 2px 8px rgba(16,38,63,.08)                 dropdowns, sticky
                                                  header on scroll
L2  0 8px 32px rgba(16,38,63,.16)                modal, cart drawer

Nothing else casts shadows. Heavy borders and drop shadows are
admissions of failure (02-brand ui-style).

## 5. Shape & Borders

Radius: 4px controls · 6px cards · 12px modals/drawers. Nothing
rounder. Hairline: 1px sand (structure) · 1px brass-600 (the brass
moment, when it's a rule). Focus ring: 2px navy-800, 2px offset —
never removed.

## 6. Iconography Tokens

Tabler + custom set (02-brand iconography): 2px stroke, squared
joints, sizes 16/20/24/32 only. Color: steel default · navy-800
active · brass-600 exclusively on genuine/premium badges.

## 7. Dark Mode

Not built (decision log: light-mode-only). All values are tokens,
so a future dark theme is a remap, not a rebuild. No component may
assume a literal white background in logic — use tokens.