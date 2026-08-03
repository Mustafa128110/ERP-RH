# Folder Standards

Authoritative tree: 06-shopify/folder-structure.md. This file adds
the placement laws:

- Compiled/generated output ONLY in assets/, each generated file
  carrying a header comment naming its source and build command
  (tokens.css names colors.json; bundles name their src module).
- One feature = one module = one obvious home. If a file's location
  needs explaining, the location is wrong.
- src/tokens/ holds the colors.json→tokens.css build script; it is
  the ONLY code allowed to contain raw hex.
- docs/ contains pointers into ROYAL-OS, never copies — duplication
  is drift (coding-standards law 4).
- No junk drawers: utils.ts is forbidden; helpers live with their
  feature or earn a named module (dom.ts, format.ts) with a stated
  scope.
- Test/fixture files (if any) sit beside their module: cart.ts,
  cart.fixtures.ts.