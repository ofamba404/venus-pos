# 00 — POS v1 analysis: what to keep, what to change

Audit of `venus-pos` at commit `65bf74d` (Nov 2026). Line numbers refer to that commit. Paths are relative to `venus-pos/`.

## 1. What v1 is

- **Runtime:** vanilla ES-module PWA. No bundler, no TypeScript, no framework. Netlify static publish of the repo root (`netlify.toml` `publish = "."`).
- **Backend:** Supabase PostgREST (direct `fetch` via `js/api.js`), Supabase Realtime (supabase-js loaded from a CDN on demand), GoTrue auth via REST (`js/auth/client.js`), Netlify Functions under `netlify/functions/` for inventory writes, push, and cookie-partner settlement.
- **Users:** `pos_staff` (Home + Inventory only) and `pos_admin` (everything). Role comes from `app_metadata.role` in the JWT (`js/auth/client.js:125-129`).
- **Products sold:** joint packs (Scout, Pilot, Commander's Stash, Variety), Plain and Bangis singles, cookies (singles by flavour, Duet, Trio, Quartet, wholesale). Catalog in `js/config.js:182-231`.
- **Sibling:** the storefront `venus-store` writes `store_orders` that POS confirms, loads into a cart, and checks out. POS pushes confirm/cancel notifications to the storefront at `https://venus-store.netlify.app/api/push/notify`.

### Size of the codebase

| File | Lines | Notes |
|------|------:|-------|
| `css/main.css` | ~10,100 | One stylesheet for every screen, 235 KB unminified, render-blocking |
| `js/orders.js` | ~2,540 | Cart, product config, checkout, delivery, storefront review deck, success screen |
| `js/analytics.js` | ~1,630 | Overview, charts, stock insights, cookie partner, edit/void sale |
| `js/store-orders.js` | ~1,300 | Storefront order stack, realtime, poll fallback, push to store |
| `js/admin.js` | ~1,110 | Admin tabs, storefront users, hours, tools |
| Other 60+ JS files | ~9,000 | Feature modules, data layer, auth, PWA |

## 2. Scorecard

| Area | Grade | One-line verdict |
|------|:-----:|------------------|
| Data integrity (checkout, stock, credit) | **A-** | Careful: optimistic stock with rollback, in-flight guard, service-role inventory API, empty-response guard |
| Data layer and caching | **B+** | IDB hydrate, stale windows, request dedupe, slice subscriptions. Polling for inventory (20 s) lags the storefront |
| Realtime and push | **B+** | Store orders realtime with 4 s poll fallback, web push with deep links |
| Register UX (the core job) | **D** | Selling is not the first thing on screen. Mandatory client. No payment method. Two different ways to start a sale |
| Information architecture | **D+** | Mobile nav hidden in a speed-dial. Store orders in three places. Credit settlement buried in Analytics |
| Visual design and brand | **C-** | Generic jade/slate dashboard (Figtree). Unrelated to the Venus storefront. 44 font sizes, 59 shadows, 25 radii |
| Accessibility | **C** | Skip link and some labels. No focus traps, 32–36 px steppers, disabled primary looks enabled |
| Code structure | **D** | God modules, `innerHTML` string templates, circular imports, triplicated catalog rules, 54 `!important` |
| Performance | **C+** | Lazy page modules, but `app.js` eagerly imports orders, admin and store-orders (~400 KB JS) and 235 KB CSS on every route |
| Testing | **D** | Only `scripts/check-spa.mjs` (static structure check) and delivery-model QA scripts. No unit or E2E tests |

## 3. Keep — these are good and must survive

Do not "simplify" any of these away. Port the behaviour faithfully.

1. **Checkout pipeline** (`js/orders.js:2386-2578`): in-flight guard, `awaitInventoryReady`, local optimistic stock decrement with snapshot rollback on failure, sale POST with full fulfillment fields, async `persistSoldBreakdown`, optional `deliveries` row, storefront order `checked_out` PATCH.
2. **Inventory write authority**: `POST /api/inventory/write` with per-category queue; direct PostgREST fallback on 405/502; legacy `cookie` key normalised to `cookie_butterscotch` (`js/inventory.js:112-209`).
3. **Data store semantics** (`js/store/*`): IDB database `venus-pos` store `cache`; stale windows inventory 20 s, sales and deliveries 15 min, clients 30 min (`js/store/repository.js:7-12`); never replace cached data with an empty response (`js/store/data-store.js:185-196`); in-flight dedupe.
4. **Storefront order lifecycle**: `pending → confirmed → accepted → checked_out` or `cancelled` (+ `dismissed_at`); optimistic accept; realtime + 4 s poll + reconnect; customer push on confirm and cancel; staff-cancel toast suppression (`js/store-orders.js`).
5. **Compose-cart parking** while reviewing a storefront order, and the multi-order switcher (`js/orders.js:116-192`, `534-553`).
6. **Flavour config state preservation** across re-renders: scroll, focus and meter (`js/orders.js:2142-2182`).
7. **Pricing rules**: flavoured-cookie bulk (4+ chocolate/mint/strawberry → 6,500 each; packs repriced at 6,500 × flavoured count) (`js/flavored-cookie-pricing.js:28-129`).
8. **Credit**: FIFO settlement with cash / mobile / other methods, partial payments, "Full" button (`js/settle-credit.js`). Stacked-debt confirmation at checkout.
9. **Owner revenue recognition** with credit proration, and **cookie partner settlement** (every 25 cookies from 2026-08-12, 45 % owner profit share, wholesale 2,500 / 3,000) (`js/revenue.js`, `js/config.js:139-173`).
10. **SafeBoda delivery fee model** (OLS + Kampala periods, minimum 3,000) feeding checkout predictions; quote lab logging test routes (`js/delivery-fee-model.js`, `js/delivery-quote-lab.js`).
11. **Auth gate** that never white-screens: pre-paint redirect, reveal watchdog, transient network errors keep the local session (`js/auth/gate-boot.js`, `gate.js`, `client.js:354-371`).
12. **Service worker** push, notification-click routing (postMessage into the SPA for load-into-cart), update-and-reload flow, `META_CACHE` that survives version bumps (`sw.js`).
13. **Pending skeletons** for slow LTE (`js/pending.js`), **virtual lists** for long history and clients.
14. **Reduced-motion** handling throughout.

## 4. Change — ranked by impact on a cashier during a rush

| # | Problem | Evidence | v2 answer |
|---|---------|----------|-----------|
| 1 | Home is not a register: KPIs, a live busy-hours control and a stock glance come before the products | `js/pages/templates.js:4-151` | Sell screen opens straight to product tiles; today's numbers become a small pill; stock glance moves to Stock; busy control moves to Orders |
| 2 | Client name is mandatory for every sale, with no explanation when checkout is disabled | `js/orders.js:2396-2398`, `1384-1389` | Keep the rule by default (decision D2), but make it fast: recent-client chips, inline create, and a visible "Add a customer to continue" hint that focuses the field |
| 3 | No payment method at sale time; only a credit toggle | `js/orders.js:2476-2482` | Payment segment (Cash / MTN / Airtel / Credit) behind decision D1; until approved, a clear Paid / On credit segment that writes exactly what v1 writes |
| 4 | Two ways to start a sale with different first steps (home list opens config; FAB opens a picker) | `js/orders.js:2598-2605`, `1062-1067` | One way: tap a tile. The cart is always one tap away in a sticky bar |
| 5 | Store orders in three places: header bag, bottom FAB review, in-modal deck | `js/store-orders.js:712-726`, `js/layout.js:118-124` | One Orders tab. Loaded orders appear as tabs inside the cart |
| 6 | Mobile navigation hidden in a hamburger speed-dial; Inventory is two taps away | `js/layout.js:91-104` | Bottom nav: Sell, Orders, Stock, (Insights), More. Left rail on wide screens |
| 7 | Tapping the modal backdrop closes the sale mid-flow | `js/orders.js:2594-2596` | Sheets close only by explicit close, swipe-down on the handle, or Android back. The cart persists regardless |
| 8 | Touch targets of 32–36 px on steppers | `css/main.css:4935-4937`, `5048-5050` | 48 px minimum, 56 px on flavour steppers and stock steppers, 64 px for the Charge bar |
| 9 | Credit settlement only reachable from Analytics | `js/analytics.js`, `js/settle-credit.js` | Clients & credit page with Settle on each client row |
| 10 | Staff see KPI cards that link to admin pages and bounce them home | `js/home.js:64-68`, `js/bootstrap.js:97-101` | Today pill opens a sheet for everyone; only admins get the Insights link |
| 11 | Disabled checkout is styled like an enabled primary | `css/main.css:5153-5158` | Disabled state is visibly different, with helper text |
| 12 | Success screen animation runs ~1 s before the next customer can start | `js/animations.js:388-425` | 420 ms check draw that never blocks input; "New sale" is focused immediately |
| 13 | `animateModalContent` staggers on every cart re-render | `js/orders.js:872` | No entrance animation on re-render. Motion only on state changes |
| 14 | `window.alert` for iOS install instructions | `js/pwa.js:37-38` | Install sheet with real instructions |
| 15 | No focus traps on dialogs and banners | `js/layout.js:140-147`, `js/pwa.js:71-72` | Shared `Sheet` and `Dialog` with focus trap, `aria-modal`, return focus |
| 16 | Brand mismatch: jade dashboard vs storefront black editorial; `theme-color` differs between pages; manifest background black on a light app | `index.html:11`, `pages/inventory.html:11`, `manifest.webmanifest:11` | Store-aligned ink and paper, flavour colours as the only chroma, Geograph / Akkurat Mono / Self Modern |
| 17 | 235 KB CSS and ~400 KB JS parsed on cold start of the home page | `js/app.js:1-11` | Vite code-split per route; Sell route ≤ 60 KB JS gzip and ≤ 20 KB CSS gzip |
| 18 | Catalog and colours duplicated in `js/config.js`, `netlify/functions/inventory-write.mjs`, and the storefront | — | One `src/domain/catalog.ts` in POS; the function's copy is checked by a test that fails when they drift |
| 19 | Circular imports: orders ↔ inventory ↔ notifications ↔ store-orders; orders ↔ admin | — | Layered modules with lint-enforced boundaries |
| 20 | Inventory on POS polls every 20 s while the storefront uses realtime | `js/store/repository.js:7-12` | Subscribe to `inventory` realtime on POS too (read only, no write change), keep the 20 s stale window as fallback |
| 21 | Dead CSS and code: `.today-strip`, `.nav-wrap`, `.view`, `animatePageEntrance`, deprecated `COOKIE_COMMISSION_UGX`, `upsertInventoryStock`, `ensureInventoryCategories` | `css/main.css:450-558`, `js/animations.js:299`, `js/config.js:175-180`, `js/inventory.js:239-538` | Not ported |
| 22 | Hidden gestures: "double-tap for bulk, tap count to edit" | `js/pages/templates.js:154-156` | Visible "Set count" and "Adjust" actions that open a keypad |
| 23 | Settings scattered: notification prefs, install, push banner, debug | `js/pwa.js`, `js/notifications.js`, `js/debug.js` | One Settings screen under More |
| 24 | No receipts beyond the success screen | `js/orders.js:950-1019` | WhatsApp receipt link (decision D3); no backend needed |
| 25 | No regression tests | — | Full harness before any rebuild (`06-testing.md`) |

## 5. Security notes found during the audit

Do **not** fix these silently. They are listed as decisions in `08-decisions.md` (D13, D14).

- `/api/inventory/write` accepts any valid Supabase user JWT; it does not check for `pos_staff` / `pos_admin` (`netlify/functions/_shared/supabase-admin.mjs:33-59`). A storefront customer token could write stock.
- `/api/push/notify` secret is optional (`netlify/functions/push-notify.mjs:17-21`); the storefront embeds a shared secret in client JS.
- The Google Maps key is in client JS (`js/config.js:6`). Confirm it is HTTP-referrer restricted in Google Cloud.

## 6. Net assessment

The engineering underneath (data integrity, sync, offline cache, push) is better than the surface suggests. The problems are almost all in **how the work is presented to the cashier** and **how the code is organised**. So the overhaul is a **rebuild of the presentation and module structure on top of a faithfully ported domain and data layer**, verified by tests that compare v2's database writes against v1's. It is not a backend rewrite.
