# Legacy quirks

Behaviour in v1 that looks odd but is replicated in v2 until the owner decides otherwise. One row per quirk.

| # | What v1 does | Where | Replicated in v2? | Owner decision |
|---|--------------|-------|-------------------|----------------|
| 1 | For a pack with no flavours selected yet, POS counts 0 flavoured cookies toward the bulk threshold; the storefront counts the pack's defaults immediately | `js/flavored-cookie-pricing.js:61-69` vs `venus-store/js/shared/flavored-cookie-pricing.js:72-76` | Yes (POS behaviour) | — |