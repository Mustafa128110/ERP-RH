# Deployment Discipline

The flow and laws live in 06-shopify/deployment.md. This file is
the operator's discipline layer:

- Releases ship when the owner is available for the following
  2 hours. Never Friday before closing; never inside a broadcast
  or campaign window; never the night before a container lands.
- Pre-flight: release checklist green (L6 theme-checklist) ·
  git-review skill pass · rollback tag verified publishable.
- Ship: merge → tag → GitHub integration publishes → live smoke
  (EN + UR: home, PDP, cart→COD start, WhatsApp CTA) → CHANGELOG.
- Watch: 30-minute eyes-on after publish — orders flowing,
  console clean, no CLS weirdness on the real Android.
- Rollback posture: publishing the previous tag is ALWAYS
  acceptable and never embarrassing. Roll back first, diagnose
  second, mistakes.md third.
- Cadence: small releases weekly beat big releases monthly —
  small diffs are the only diffs one owner can truly review.