# Coding Standards — Prime Rules

This codebase has one owner and an AI pair. There is no senior
engineer to catch mistakes in review — THESE DOCUMENTS are the
senior engineer. Therefore:

## The Four Laws

1. **Boring beats clever.** Explicit, self-documenting code, always.
   If a construct needs explaining in chat, it needs rewriting in
   code.
2. **Every file understandable in isolation.** Claude Code reads
   files, not folklore. Header comments state purpose; snippet
   headers state inputs/outputs; modules state what page they serve.
3. **The docs are load-bearing.** A behavior change without a doc
   change is an incomplete task (09-ai/documentation-rules.md).
   Code review blocks on it.
4. **One source of truth per fact.** Colors live in colors.json →
   tokens.css. Specs live in metafields. Strings live in locales.
   Motion lives in motion.ts. Duplication is where drift is born.

## Hygiene
- Small files, single purpose; >200 lines → split.
- Non-obvious decisions get a one-line WHY comment (not what).
- Dead code deleted immediately — git is the archive; commented-out
  graveyards are forbidden.
- Nothing pasted from the internet without understanding; everything
  adapted to tokens and standards.
- TODOs carry an owner and a date or they don't merge:
  // TODO(owner, 2026-08): …

## The Grep Gates (run before every PR; CI mirrors them)
- Raw hex outside tokens source: `#[0-9a-fA-F]{3,6}` in
  sections/snippets/src → defect (tokens only, L7 foundations).
- Physical CSS properties: `margin-left|margin-right|padding-left|
  padding-right|left:|right:` → defect (logical properties only,
  RTL law, L6 localization).
- Direct animation imports: `from "gsap"|from "lenis"` outside
  motion.ts → defect (single gateway, L7 motion).
- Hardcoded UI strings in Liquid: text outside {{ '…' | t }} in
  customer-facing markup → defect (Urdu parity, L6).
- `any` in TS → defect (typescript-standards.md).