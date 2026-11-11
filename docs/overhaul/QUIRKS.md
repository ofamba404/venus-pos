# Legacy quirks

Behaviour in v1 that looks odd but is replicated in v2 until the owner decides otherwise. One row per quirk.

| # | What v1 does | Where | Replicated in v2? | Owner decision |
|---|--------------|-------|-------------------|----------------|
| 1 | For a pack with no flavours selected yet, POS counts 0 flavoured cookies toward the bulk threshold; the storefront counts the pack's defaults immediately | `js/flavored-cookie-pricing.js:61-69` vs `venus-store/js/shared/flavored-cookie-pricing.js:72-76` | Yes (POS behaviour) | — |
| 2 | Joint / cookie-row low uses `qty < 5` (so 5 is **ok**); checklist wording said ≤5 | `legacy/js/inventory.js` `stockState` | Yes (`<`) | — |
| 3 | Cookie **aggregate** dial uses 30% of capacity 100 (`cookieStockLevel`); per-flavour rows still use the joint `< 5` rule | `legacy/js/inventory.js` | Domain `stockLevel` for cookie ids follows aggregate rule | — |
| 4 | `cookieStockLevel(-1)` returns `low` (only exact `0` is `out`); joint `stockState(-1)` returns `out` | `legacy/js/inventory.js` | Yes | — |
| 5 | Store-order cart lines set `stockDeferred: true` (skip draft reservation) but checkout **still** deducts them via `mergedBreakdown` | `store-orders.js` / `orders.js` | Yes | — |
| 6 | `legacy/js/orders.js` cannot load in Vitest (`location` at import); sale-payload dual-run uses source-mirrored oracles | `orders.js` | — | — |