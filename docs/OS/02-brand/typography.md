# Brand Book, Part III: Typography

## 1. The Pairing & Why
- **Fraunces** (display serif): weight and character of engraved
  plates and old ledgers — heritage that still feels sharpened.
  Use its "soft" optical axis low; we want machined, not syrupy.
- **Inter** (text/UI): the neutral instrument — tabular figures for
  prices, superb small-size legibility for specs on mid-range Androids.
- **Noto Nastaliq Urdu** (Urdu display): the dignified script the
  headline deserves.
- **Noto Naskh Arabic** (Urdu text/UI): endurance at small sizes;
  Nastaliq tires below ~18px.
All Google Fonts — zero licensing risk. Load only used weights,
font-display: swap, subset where possible (Nastaliq is heavy).

## 2. Weights (complete set — nothing else loads)
Fraunces 600 (SemiBold). Inter 400 / 500 / 600.
Naskh 400 / 700. Nastaliq 400.
Never: faux-bold, faux-italic, any letter-spacing on Urdu.

## 3. Type Scale (desktop / mobile) — 1.25 ratio, 4px-snapped

| Token | Size | Face | Use |
|---|---|---|---|
| display-xl | 44/32 | Fraunces 600 | Hero headline (one per page) |
| display    | 32/26 | Fraunces 600 | Section titles |
| heading    | 22/19 | Inter 600 | Card/product titles, H3 |
| subhead    | 18/17 | Inter 500 | Standfirsts, nav |
| body       | 16, lh 1.6 | Inter 400 | Paragraphs |
| small      | 13 | Inter 400, steel | Captions, meta |
| price      | 20 | Inter 600 tabular, navy | Prices everywhere |
| overline   | 12, caps, +150 tracking | Inter 500 | Kickers ("SINCE 1990") |

Urdu: +1 step vs EN equivalent, line-height ≥1.9 (Nastaliq display
≥2.0). Fully mirrored RTL; logical CSS properties from day one.

## 4. Composition Rules
- Measure: 60–70 chars EN body; Urdu measure slightly narrower.
- Hierarchy = size + ONE other cue (weight or color), never three.
- Sentence case in UI; caps only in overlines and the wordmark.
- Numbers carry units always ("115mm", "13,300 RPM", "1.5kg");
  tabular figures in any column of numbers.
- Fraunces never below 22px; below that, Inter takes over.
- One display-xl per page. Scarcity is what makes it premium.