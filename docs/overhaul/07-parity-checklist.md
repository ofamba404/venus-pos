# 07 — Parity checklist (must not break)

Every v1 capability, with its source and the test that proves v2 keeps it. Tick `[x]` only when the named test passes (or, for `manual`, when the check is logged in `PARALLEL-RUN.md`). Line numbers refer to `v1-baseline`.

Legend: **S** = staff and admin, **A** = admin only.

## 1. Selling

| ✓ | Capability | Role | v1 source | Proof |
|---|-----------|:----:|-----------|-------|
| [ ] | Product catalog and prices (packs 8,000 / 15,000 / 35,000 / 50,000; cookie packs 15,000 / 21,000 / 25,000; Plain and Bangis 5,000; cookies butterscotch 5,000, chocolate/mint/strawberry 8,000; wholesale manual) | S | `js/config.js:18-23`, `182-231` | dual-run catalog, S01–S09 |
| [ ] | Pack flavour rules: `choose_any`, `choose_variety`, Quartet fixed butterscotch, cookie choice pool excludes butterscotch | S | `js/config.js:118-124`, `js/product-config.js` | dual-run pack-config, S03, S09 |
| [ ] | Flavoured cookie bulk pricing (≥ 4 → 6,500; packs repriced) | S | `js/flavored-cookie-pricing.js:28-129` | dual-run, S04, S05 |
| [ ] | Wholesale cookies with custom unit price | S | `js/product-config.js` | S06 |
| [ ] | Draft stock shown in config; counter lines cap at refreshed on-hand stock (D16). A badge still does not block opening the product | S | `js/orders.js` `draftStock`, `SellPage` | S01, L4 |
| [ ] | Edit a cart line with preserved config state | S | `js/orders.js:2142-2182` | S16 |
| [ ] | Client autocomplete with "owes" hint | S | `js/client-autocomplete.js` | S01, S12 |
| [ ] | Create client inline | S | `js/clients.js:212-216` | S10 |
| [ ] | Client required to check out (unless D2 approved) | S | `js/orders.js:2396-2398` | L4: Charge disabled without a client, and no writes |
| [ ] | Credit sale (`is_credit`, `amount_paid_ugx = 0`) | S | `js/orders.js:2476-2482` | S11 |
| [ ] | Stacked-debt confirmation | S | `js/orders.js:2410-2417` | S12, S13 |
| [ ] | Delivery: GPS pickup with stale-generation guard, Places drop-off, predicted fee (range high end), manual fee → `fee_was_edited`, deliver-at, phone | S | `js/orders.js:1101-1125`, `1208-1228`, `pickupLocateGen` | S14, S15 |
| [ ] | `BASE_ORIGIN` pickup for store-order carts | S | `js/orders.js` | S21 (delivery variant) |
| [ ] | Checkout in-flight guard | S | `js/orders.js` `checkoutInFlight` | S19 |
| [ ] | `awaitInventoryReady` before checkout | S | `js/orders.js` | L1 checkout |
| [ ] | Optimistic stock decrement + rollback on failure | S | `js/orders.js:2567-2575` | S18 |
| [ ] | Sale POST body identical (§7) | S | `js/orders.js:2454-2485`, `298-334` | all selling goldens |
| [ ] | `persistSoldBreakdown` deltas; legacy `cookie` → `cookie_butterscotch` | S | `js/inventory.js`, `netlify/functions/inventory-write.mjs` | S01–S09 goldens |
| [ ] | `deliveries` row after a delivery sale | S | `js/orders.js:2268-2283`, `2514-2547` | S14 |
| [ ] | Success: totals, badges, delivery summary with "Saving delivery…" pending, Done / New order / Next store order | S | `js/orders.js:950-1030` | L4 + visual |
| [ ] | Reward lines (`is_reward`, `reward_key`, `points_cost`) | S | `js/orders.js:2235-2243` | S20 |
| [ ] | Cart persists across reload (`venus-pos-cart`, `venus-pos-order-meta`) | S | `js/state.js:72-114` | L4 reload test |
| [ ] | Today numbers: owner revenue, joints, cookies | S | `js/home.js` `updateTodayStrip` | S50 |

## 2. Storefront orders

| ✓ | Capability | Role | v1 source | Proof |
|---|-----------|:----:|-----------|-------|
| [ ] | Waiting count badge (pending + confirmed, excl. dismissed) | S | `js/store-orders.js` | S26 |
| [ ] | Realtime + 4 s poll fallback + reconnect refetch | S | `js/store-orders.js:28-29`, `621-643`, `1398-1403` | L1 feed, S26 |
| [ ] | Session paint cache `venus-pos-store-orders-v1` (90 s) | S | `js/store-orders.js:31-139` | L1 |
| [ ] | Load into cart (optimistic `accepted` PATCH), mapping storefront ids | S | `js/store-orders.js:1191-1203`, `applyStorefrontOrderToCart` | dual-run map, S21 |
| [ ] | Confirm for customer → `confirmed_at` + push to storefront | S | `js/store-orders.js:47-93` | S21 |
| [ ] | Cancel → status + push; duplicate toast suppressed | S | `staffCancelledIds` | S22 |
| [ ] | Dismiss cancelled (`dismissed_at`) | S | `js/store-orders.js` | S23 |
| [ ] | Multiple loaded orders + switcher | S | `.cart-order-switcher`, `js/orders.js:2646-2734` | S24 |
| [ ] | Compose cart parking and restore | S | `js/orders.js:116-192`, `534-553` | S25 |
| [ ] | Checkout links sale (`store_order_id`) and PATCHes `checked_out` + `sale_id`. **D16:** if `delivery.stock_reservation` is `held` or `consumed`, charge does not deduct those units again | S | `js/store-orders.js`, `/api/store-order/reserve` | S21 |
| [ ] | Release order from cart | S | `__venusReleaseStoreOrderFromCart` | L4 |
| [ ] | Cancelled-while-in-cart banner (`store-order:cancelled`) | S | `js/orders.js:2618` | L4 |
| [ ] | Deep link `#load-store-order=<id>` and `#store-orders` | S | `js/store-orders.js:1413-1416`, `sw.js:263-331` | S27, L4 |
| [ ] | POS display labels for customers (`admin_list_pos_labels`, 5 min stale) | S | `js/pos-labels.js` | S21 (label shown) |
| [ ] | New-order push to POS devices (unchanged functions) | S | `netlify/functions/push-*.mjs` | manual |

## 3. Store status / hours

| ✓ | Capability | Role | v1 source | Proof |
|---|-----------|:----:|-----------|-------|
| [ ] | Busy-until quick controls (staff) | S | `js/hours-widget.js` | S28 |
| [ ] | Full hours: open/close, busy, suggest window | A | `js/admin.js:643-717`, `js/fulfillment.js` | S41 |
| [ ] | Offline snapshot `venus.pos.fulfillment` | S | `js/fulfillment.js:14-92` | L1 |

## 4. Stock

| ✓ | Capability | Role | v1 source | Proof |
|---|-----------|:----:|-----------|-------|
| [ ] | Boot `ensure` call | S | `js/bootstrap.js:217-218`, `js/inventory.js:471-487` | all goldens (first write) |
| [ ] | +/− steppers with per-category queue | S | `js/inventory.js:112-209` | S29 |
| [ ] | Exact count edit | S | `js/inventory.js` | S30 |
| [ ] | Bulk adjust | S | `#amountModal` | S31 |
| [ ] | 405/502 → direct PATCH fallback | S | `js/inventory.js:138-176` | S32 |
| [ ] | Low (≤ 5) / out; cookie low < 30 % of 100 | S | `js/config.js:139-142` | dual-run stock-state |
| [ ] | Stock crossing notifications with dedupe (`venus.notif.stock.v1`) | S | `notifyStockCrossing` | S33 |
| [ ] | Home stock glance content (now on Stock) | S | `js/pages/templates.js:29-43` | visual |

## 5. Clients and credit

| ✓ | Capability | Role | v1 source | Proof |
|---|-----------|:----:|-----------|-------|
| [ ] | Clients list, search, add, rename, delete (sales kept) | A | `js/clients.js` | S39 |
| [ ] | Owes per client | A | `js/clients.js:115-117` | S50 |
| [ ] | Settle: amount, method cash/mobile/other, note, Full, FIFO, `credit_payments` + sales PATCH | A | `js/settle-credit.js:14-203` | S34, S35 |
| [ ] | Merge duplicate names in credit view | A | analytics credit panel | dual-run credit |
| [ ] | Virtual list ≥ 48 rows | A | `js/virtual-list.js` | L4 |

## 6. History, Insights, Delivery, Reviews, Store, Debug

| ✓ | Capability | Role | v1 source | Proof |
|---|-----------|:----:|-----------|-------|
| [ ] | History tree (today / week / 4 weeks / months), tags, fulfilment meta | A | `js/order-history.js` | dual-run groups, S50 |
| [ ] | Edit sale (items, stock delta) | A | `js/analytics.js:1659-1798` | S36 |
| [ ] | Void sale (+ delivery cascade, stock return) | A | `js/analytics.js` | S37 |
| [ ] | Overview stats, revenue chart ranges, patterns, heatmap, product/flavour ranks, Pareto, stock insights | A | `js/analytics.js`, `js/analytics-chart.js` | dual-run analytics, visual |
| [ ] | Period persistence (`venus_chart_range`, `venus_insight_period`) | A | `js/analytics-chart.js:29-47` | L4 |
| [ ] | Cookie partner: progress, batches, copy text, settle API, local progress key, baseline, corruption sanitise | A | `js/revenue.js`, `js/analytics.js:718-863` | dual-run partner, S38 |
| [ ] | Delivery log, edit trip, fee model scatter/periods, quote lab presets, test tagging | A | `js/delivery*.js` | S42, S43, dual-run fee |
| [ ] | Reviews list (100), refresh, realtime INSERT notification | A | `js/reviews.js:128-163` | S44 |
| [ ] | Storefront users: list, display name, verify, delete | A | `js/admin.js:122-155`, `836-943` | S40 |
| [ ] | Admin tools (copy lists, links) | A | `js/admin.js:1029+` | manual |
| [ ] | Debug log capture, copy, recover from server | A | `js/debug.js` | L4 |

## 7. Write contract: the sale POST body

v2's `sale-payload.ts` must produce exactly these fields with v1's values for the same input (`js/orders.js:2454-2485`, `buildSaleFulfillmentFields` `298-334`):

`items[]` (`product_id`, `product_name`, `detail`, `line_total`, `breakdown`, optional `is_reward`, `reward_key`, `points_cost`, `wholesale_unit_price`), `total_ugx`, `client_id`, `is_credit`, `credit_cleared`, `amount_paid_ugx`, `cleared_at`, `client_phone`, `delivery_enabled`, `delivery` (`mode`, `label`, `deliverAt`), `location_label`, `location_lat`, `location_lng`, `delivery_fee_ugx`, `delivery_distance_km`, `delivery_duration_min`, `store_order_id`.

Delivery row: `client_id`, `client_name`, `sale_id`, origin/destination lat/lng/labels, `distance_km`, `duration_min`, `fee_ugx`, `predicted_fee_ugx`, `fee_was_edited`.

Approved additions (D1, D4) are appended, never replacing a field.

## 8. Platform

| ✓ | Capability | Role | v1 source | Proof |
|---|-----------|:----:|-----------|-------|
| [ ] | Auth: sign in, role check, refresh, transient tolerance, invalid → re-login, `next` | S | `js/auth/*` | S49, L1 |
| [ ] | Staff page restrictions | S | `js/auth/client.js:190-194` | S46 |
| [ ] | Pre-paint gate (no flash of app when signed out) | S | `js/auth/gate-boot.js` | L4 |
| [ ] | IDB cache reused (`venus-pos` / `cache`) | S | `js/store/idb.js` | Phase 3 test |
| [ ] | Stale windows, dedupe, empty guard | S | `js/store/*` | L1 |
| [ ] | Push subscribe/unsubscribe, prefs (`venus.notif.prefs.v1`), schedules tick (30 s), fired dedupe | S | `js/notifications.js` | S45, L1 |
| [ ] | SW at `/sw.js` scope `/`; push handler; notification click → postMessage / openWindow; display-mode ping; `META_CACHE` | S | `sw.js` | L1 (handler unit tests), manual |
| [ ] | Existing push subscriptions survive cutover | S | — | manual (Phase 10) |
| [ ] | Update flow (60 s checks, skip-waiting message) — v2 defers reload while a cart exists | S | `js/sw-register.js` | L4 |
| [ ] | Install prompt (Android) and iOS instructions | S | `js/pwa.js` | L4 + manual |
| [ ] | Manifest identity unchanged (`id: "/"`), shortcuts work | S | `manifest.webmanifest` | manual |
| [ ] | Legacy URLs and hashes (`02-product-spec.md §2`) | S | — | L4 |
| [ ] | Netlify functions unchanged and reachable | S | `netlify/functions/*` | Phase 1/9 smoke |
| [ ] | UGX formatting identical | S | `js/utils.js:1-3` | dual-run format |
| [ ] | Reduced motion respected | S | `js/animations.js` guards | L4 (emulated) |

## 9. Intentionally not ported (dead or replaced)

Confirm each with a search before dropping; list the evidence in the commit message.

- `.today-strip`, `.nav-wrap`, `.view` CSS (unused) — `css/main.css:450-558`.
- `animatePageEntrance` (never called) — `js/animations.js:299`.
- `COOKIE_COMMISSION_UGX` (deprecated) — `js/config.js:175-180`.
- `upsertInventoryStock`, `ensureInventoryCategories` (deprecated) — `js/inventory.js:239-242`, `536-538`.
- `js/cache.js` (deprecated wrapper) and the `venus-pos-cache:*` session migration.
- `venus-pos-stock-highlight` handoff (replaced by `/stock?filter=`).
- `venus-sw-purge-v21` one-time purge (already ran on every device; v2's activate cleans old caches).
- Speed-dial FAB menu, bottom FAB stack, header bag panel (replaced by nav and Orders).
- `window.__venus*` globals (replaced by module imports), unless a remaining consumer is found.
