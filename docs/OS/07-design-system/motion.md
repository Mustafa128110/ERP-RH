# Design System — Motion ("precision machinery")

Motion carries the brand's calm: damped, deliberate, brief.
Implementation home: src/ts/motion.ts (the single GSAP/Lenis
gateway — no component imports GSAP directly).

## 1. Tokens

Durations: --motion-micro 150ms (hover, press) · --motion-standard
250ms (reveals, accordions, drawers) · --motion-large 350ms
(modals, page-level). Hard ceiling 400ms.
Easing: --ease-machined cubic-bezier(0.22, 1, 0.36, 1) — ALL
entrances/reveals · ease-in-out — movement/position changes ·
ease-out — micro states. One curve family so all motion feels
related.

## 2. The Complete Vocabulary (v1 — nothing else exists)

1. **Reveal** — fade 0→1 + translateY 20px→0, once per element,
   trigger 80% viewport, stagger 60ms in grids. The only scroll
   animation.
2. **Hover lift** — cards translateY(-2px) + border color, 250ms.
3. **Press** — buttons: ground-color shift only (no scale — scale
   reads playful, we read machined).
4. **Drawer** — slide in from inline-end (locale-aware), 350ms.
5. **Modal** — fade + rise 8px, 350ms; scrim fades 250ms.
6. **Accordion** — height auto-animate + chevron 180°, 250ms.
7. **Toast** — rise 12px + fade, 250ms in / 200ms out.
8. **Carousel** — Splide 350ms machined.

Forbidden in v1: pinning, scroll-scrubbing, parallax, marquees,
loops, bounces, spins, staggered letter effects, animated numbers.
Anything novel = decision log + this file updated first
(animation-engineer skill enforces).

## 3. Lenis

lerp 0.1 — weight, not float. Instantiated once in motion.ts.
Disabled: under reduced-motion · on any input-focus scroll · on
/ur if RTL interaction bugs appear (log the decision).

## 4. Reduced Motion (non-negotiable, launch-gated)

One global gate in motion.ts checks prefers-reduced-motion BEFORE
loading GSAP/Lenis: reveals render in final state · Lenis off ·
autoplay off · durations 0. CSS transitions degrade via media query.
Tested in the release checklist every time.

## 5. Performance Law

Animate transform and opacity ONLY. Layout-property animation
(height except accordions' FLIP-style, top/left, width) is rejected
in review. GSAP/Lenis load deferred, per-template, after
interactive; the page must be fully usable with JS blocked —
motion is decoration, never a dependency (06-shopify/performance).

## 6. Choreography Rules

- One reveal pass per viewport-entry; elements never re-animate.
- Grids stagger 60ms, max 6 items staggered (7+ appear as one).
- Hero may reveal on load (headline → support → CTA, 60ms stagger);
  everything else waits for scroll.
- Drawers/modals: content is present immediately — motion never
  delays reading.
- The trust microbar, prices, and stock badges NEVER animate:
  facts arrive still.