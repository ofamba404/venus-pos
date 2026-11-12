# Legacy quirks

Behaviour in v1 that looks odd but is replicated in v2 until the owner decides otherwise. One row per quirk.

| # | What v1 does | Where | Replicated in v2? | Owner decision |
|---|--------------|-------|-------------------|----------------|
| 1 | For a pack with no flavours selected yet, POS counts 0 flavoured cookies toward the bulk threshold; the storefront counts the pack's defaults immediately | `js/flavored-cookie-pricing.js:61-69` vs `venus-store/js/shared/flavored-cookie-pricing.js:72-76` | Yes (POS behaviour) | — |
| 2 | Joint / cookie-row low uses `qty < 5` (so 5 is **ok**); checklist wording said ≤5 | `legacy/js/inventory.js` `stockState` | Yes (`<`) | — |
| 3 | Cookie **aggregate** dial uses 30% of capacity 100 (`cookieStockLevel`); per-flavour rows still use the joint `< 5` rule | `legacy/js/inventory.js` | Domain `stockLevel` for cookie ids follows aggregate rule | — |
| 4 | `cookieStockLevel(-1)` returns `low` (only exact `0` is `out`); joint `stockState(-1)` returns `out` | `legacy/js/inventory.js` | Yes | — |
| 5 | Store-order cart lines set `stockDeferred: true`. **D16:** claimed units are already out of on-hand stock, so charge does not deduct them again. Older orders with no `stock_reservation` still deduct at charge | `store-order-reserve.mjs`, `orders.js`, `inventory-delta.ts` | Yes, with the D16 hold | **D16 — claim at place** (2026-11-12) |
| 6 | `legacy/js/orders.js` cannot load in Vitest (`location` at import); sale-payload dual-run uses source-mirrored oracles | `orders.js` | — | — |
| 7 | A double-tap on Charge posts **two** sales. `checkoutInFlight` is set only after `awaitInventoryReady()` (and after the stacked-debt confirm), so both clicks pass the guard. v2 keeps one sale | `legacy/js/orders.js` `checkout` | No — v2 guard is before the first await. Do not “fix” v1 unless the owner says so | — |
| 8 | Removing a cart line has no Undo control. v2 shows an Undo toast | `legacy/js/orders.js` `wireCartItemButtons` | No — v2 has undo | — |
| 9 | Deleting a client toasts "Client removed", not "deleted". A failed sale with no signal toasts "check connection", not "offline". A delivery edit toasts "Delivery updated", not "saved" | `legacy/js/clients.js`, `orders.js`, `delivery.js` | v2 copy differs | — |
| 10 | `loadInventory` clears `loadPromise` in `finally`, so overlapping callers share one `ensure` and the next caller posts another. The count depends on timing. Goldens drop `op: "ensure"` and the `admin_list_pos_labels` / `admin_list_users` reads | `legacy/js/inventory.js` `loadInventory` | — | — |
| 11 | Rename commits on Enter and on blur. Both call `finishRenameClient` before the name is updated, so one Enter can PATCH the client twice. The legacy driver blurs once | `legacy/js/clients.js` `startRenameClient` | — | — |
| 12 | Hours dial adds at most one calendar day when the chosen clock is not more than 30 seconds ahead. Exactly 30 seconds rolls (`<=`). Choosing 12:00 am during the last 30 seconds of the day can still land inside that window, because seconds and milliseconds are cleared and the function does not roll a second time | `legacy/js/hours-dial.js` `dialPartsToDate` | Yes | — |