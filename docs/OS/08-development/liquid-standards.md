# Liquid Standards (the law; L6 liquid-guidelines is the manual)

## Structure
- `rh-` prefix on ALL custom files. Dawn files modified only with
  an RH-MOD marker comment (reason stated) so upstream upgrades
  diff cleanly.
- Snippet contract: header comment documenting purpose, accepted
  parameters (name, type, required/default), and emitted events if
  any. Explicit {% render %} parameters ONLY — outer-scope reliance
  is a defect.
- Sections obey the six-point section contract (L6 theme-standards):
  defaults, copy-as-settings, graceful degradation, bilingual,
  brand compliance (brass discipline), performance.

## Data
- Structure from metafields (product.metafields.royal.*), never
  parsed from description HTML. The metafield definitions in
  03-products/product-template.md are the schema; new fields go
  there first.
- Money via money filters exclusively. Dates via date filters with
  explicit formats.
- User-generated/external content: `| escape` always (reviews,
  search terms echoed, any customer text).

## Strings & Locales
- Every customer-visible string: {{ 'scope.key' | t }}. Keys named
  by surface: products.price.bulk_hint, cart.drawer.checkout.
- New keys land in en.default.json AND ur.json in the same PR —
  the CI missing-key report fails otherwise (L6 localization).
  Placeholder Urdu is permitted only as `⚠ UR-PENDING: …` and is
  release-blocking.

## Protected Logic (single homes — never re-implemented)
- Stock states → rh-stock-badge only.
- Warranty line → rh-spec-table only.
- Genuine badge → rh-badge-genuine only (renders nothing outside
  product context — the protection rule lives IN the snippet).
- Price + ladder hint → rh-price only.
Re-implementing any of these inline is a review-blocking defect —
it's how honesty rules decay.