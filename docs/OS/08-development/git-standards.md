# Git Standards

## Branches & Flow
main (live theme, protected) ← develop (staging theme) ←
feat/… fix/… chore/… docs/…
- main: no direct pushes (branch protection ON), PRs only, linear
  history preferred (squash-merge).
- One concern per PR. A PR mixing a feature and a refactor gets
  split.

## Commits (conventional — AI writes them, owner enforces)
type(scope): imperative summary ≤72 chars
  feat(pdp): add bulk ladder hint to rh-price
  fix(rtl): cart drawer slides from inline-end on /ur
  chore(tokens): regenerate tokens.css from colors.json v2
Types: feat · fix · chore · docs · perf · refactor · test.
Body when non-obvious: the WHY, links to the ROYAL-OS doc or
decision log.

## The PR Ritual (the quality system for a team of one)
1. Author (usually Claude Code) opens PR per 11-templates/pr.md:
   what · why (doc link) · screenshots before/after (both locales
   for UI) · performance note · EN/UR note · AI-authored: yes/no.
2. code-review skill runs the checklist (13-checklists/
   code-review.md) and the grep gates; blocks on violations.
3. Owner reads the EXPLANATION more than the diff — the forced
   explanation is where AI mistakes surface.
4. Merge to develop → test matrix → release per L6 deployment.

## Hygiene & Safety
- Never committed: API keys, .env, tokens, customer data, store
  exports, private financials. .gitignore covers all; a committed
  secret = immediate rotation + history scrub + mistakes.md entry.
- Tags = releases (L6 versioning). CHANGELOG entry per tag.
- settings_data.json content drift pulled back weekly (L6) as
  chore(theme) commits — content history is history too.
- git-review skill audits before each release: message quality,
  branch state, no secrets, no orphan WIP.