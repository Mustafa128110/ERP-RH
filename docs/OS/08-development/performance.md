# Performance Practice

Budgets live in L6 (Lighthouse ≥85, LCP <2.5s, CLS <0.1, INP
<200ms, JS <200KB total / <60KB per template, hero image <200KB).
This file is the PRACTICE that keeps them:

## Every PR
- Bundle-size delta stated in the PR performance note; CI fails
  hard over budget.
- New/changed images: through rh-image, weights checked, LCP image
  eager+preloaded, everything else lazy.
- UI changes: tested on throttled mid-range Android profile
  (DevTools: 4x CPU, Fast 3G) — our median customer, not our dev
  machine.

## Every Release
- Lighthouse CI on home/collection/product for BOTH locales —
  /ur pays the Nastaliq font tax; it gets measured, not assumed
  (subsetting per L6 performance).
- CLS audit: any layout shift traced to a missing dimension or an
  unguarded font swap and fixed at source.

## Standing Rules
- Fonts: only the L2 §2 weight set; subset; swap. Urdu fonts served
  on /ur routes only.
- Third-party scripts: >30KB or >100ms main-thread = decision log
  to stay (quarterly app audit, L6 §4).
- Motion is free or it's gone: transform/opacity only (L7 motion
  law); GSAP/Lenis load deferred behind the reduced-motion gate.
- Perf regressions found in production → 16-knowledge/mistakes.md
  with root cause, like any bug.