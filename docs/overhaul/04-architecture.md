# 04 — Architecture

## 1. Stack

| Concern | Choice | Why |
|---------|--------|-----|
| Build | **Vite** (latest stable at install time; pin exact versions in `package.json`) | Code splitting, hashed assets, CSS per chunk, dev server |
| Language | **TypeScript**, `strict: true`, `noUncheckedIndexedAccess: true` | Money, stock and order shapes must be typed |
| UI | **Preact** + **@preact/signals** | ~5 KB + ~4 KB gzip vs ~45 KB for React. JSX idioms are familiar. `preact/compat` is aliased so React-style references (Her Voice) port easily |
| Styling | Plain CSS with cascade layers, co-located per component, tokens in one file | Matches Her Voice; no framework lock-in; per-route CSS via Vite |
| Router | Small custom history router (`src/app/router.ts`, ≤ 200 lines) modelled on Her Voice `packages/shared/router.tsx` | Lazy routes, history-backed sheets, role guards, no dependency |
| Supabase REST | Keep a thin `fetch` wrapper (port `js/api.js`) | Smaller than supabase-js, same behaviour |
| Supabase Realtime | `@supabase/realtime-js` from npm (fall back to `@supabase/supabase-js` only if `realtime-js` can't do `setAuth`), **lazy chunk** loaded after first paint | Removes the CDN dependency and failure mode |
| Auth | Port `js/auth/client.js` (GoTrue REST) to TS; same storage key `venus-pos-auth` | Existing sessions keep working at cutover |
| Maps | Google Maps JS loaded on demand (port `js/places-autocomplete.js` loader) | Only when Delivery is selected |
| Tests | Vitest (unit + dual-run), Playwright (E2E, visual, a11y via `@axe-core/playwright`), fast-check (property tests) | See `06-testing.md` |
| Lint/format | ESLint (typescript-eslint), Prettier, Stylelint | Enforce boundaries and token use |
| Node | 22.x (installed: v22.17.0). Add `"engines": { "node": ">=22" }` | |

**Do not add:** React, a CSS framework, a component library, a chart library, a state library beyond signals, GSAP, Lenis, Lottie, Moment/date-fns (use `Intl.DateTimeFormat` with `timeZone: 'Africa/Kampala'` and port v1 date helpers).

## 2. Repository layout (end state)

```
venus-pos/
├─ DESIGN.md                    # from 03-design-system.md (Phase 4)
├─ index.html                   # app entry (Vite)
├─ auth.html                    # sign-in entry (Vite)
├─ src/
│  ├─ main.tsx                  # boot: auth check, hydrate, render <App/>
│  ├─ auth-main.tsx             # sign-in page boot
│  ├─ copy.ts                   # every user-facing string
│  ├─ env.ts                    # typed constants (Supabase URL, publishable key, Maps key, store push URL)
│  ├─ app/
│  │  ├─ App.tsx                # shell: TopBar, NavBar/Rail, <RouteView/>, SheetHost, ToastHost, DialogHost
│  │  ├─ router.ts              # history router, lazy routes, guards, legacy hash/URL handling
│  │  ├─ routes.ts              # route table: path, chunk loader, minRole, title
│  │  └─ shell/                 # TopBar, NavBar, Rail, CartBar, TodayPill, SyncChip, AccountMenu
│  ├─ domain/                   # PURE TS. No DOM, no fetch, no signals, no Date.now() (inject clock)
│  │  ├─ catalog.ts             # PRODUCTS, CATEGORIES, CAT_MAP, pools, thresholds, partner constants
│  │  ├─ format.ts              # formatUGX, phone display, Kampala date helpers
│  │  ├─ pricing/flavored-bulk.ts
│  │  ├─ pricing/pack-config.ts # rules from product-config.js: validity, breakdown, line total
│  │  ├─ cart.ts                # cart line model + pure reducer
│  │  ├─ sale-payload.ts        # builds the exact sales POST body + fulfillment fields
│  │  ├─ inventory-delta.ts     # sold breakdown → per-category deltas; cookie → cookie_butterscotch
│  │  ├─ stock-state.ts         # low/out rules, capacity
│  │  ├─ credit.ts              # owed per client, FIFO allocation
│  │  ├─ revenue.ts             # owner-recognised revenue, credit proration
│  │  ├─ partner.ts             # cookie partner progress, batches, share text
│  │  ├─ delivery-fee.ts        # SafeBoda model: fit + predict range
│  │  ├─ store-order-map.ts     # store_orders row → cart lines + meta
│  │  ├─ history-groups.ts      # day/week/month tree
│  │  ├─ hours.ts               # busy/open logic from fulfillment.js
│  │  ├─ analytics/*.ts         # period bucketing, ranks, heatmap, patterns
│  │  └─ luminance.ts           # text-on-flavour colour choice
│  ├─ data/
│  │  ├─ api.ts                 # sbFetch (REST), functionFetch (/api/*), edgeFetch (store-auth)
│  │  ├─ auth.ts                # session, refresh timer (30 s), role, sign in/out
│  │  ├─ idb.ts                 # DB 'venus-pos': store 'cache' (unchanged), store 'held' (new, v2)
│  │  ├─ entities.ts            # signals per entity + meta; hydrate, fetch, stale windows, dedupe, empty guard
│  │  ├─ repository.ts          # fetchers per entity (same queries as v1)
│  │  ├─ realtime.ts            # Feed adapter: realtime + poll fallback + reconnect refetch
│  │  ├─ writes/                # one module per write path, each a thin wrapper around api.ts
│  │  │  ├─ sales.ts  clients.ts  inventory.ts  deliveries.ts  store-orders.ts
│  │  │  ├─ credit-payments.ts  fulfillment.ts  reviews.ts  partner.ts  push.ts  store-auth.ts
│  │  ├─ checkout.ts            # the checkout pipeline (orchestrates domain + writes)
│  │  ├─ session-cart.ts        # sessionStorage 'venus-pos-cart' / 'venus-pos-order-meta' (same keys and shape)
│  │  └─ prefetch.ts            # idle refresh for role-allowed entities
│  ├─ features/                 # one folder per route; each lazy-loaded
│  │  ├─ sell/  orders/  stock/  more/  settings/  insights/  clients/
│  │  ├─ history/  delivery/  reviews/  store/  debug/  system/  auth/
│  ├─ platform/                 # browser integrations
│  │  ├─ sw-register.ts  push.ts  install.ts  haptics.ts  maps.ts  geolocation.ts  clipboard.ts  whatsapp.ts
│  ├─ ui/                       # design-system components (see 03 §4) + icons.tsx
│  └─ styles/                   # layers.css, tokens.css, fonts.css, base.css
├─ public/                      # copied verbatim: assets/, manifest.webmanifest, robots, _redirects (if used)
├─ sw/sw.ts                     # service worker source → built to /sw.js
├─ netlify/functions/           # UNCHANGED (unless an approved decision says otherwise)
├─ supabase-functions/          # UNCHANGED
├─ legacy/                      # v1, frozen (removed from the build at cutover; deleted later)
├─ tests/
│  ├─ unit/                     # Vitest: domain + data
│  ├─ dual-run/                 # Vitest: legacy function vs v2 function on the same inputs
│  ├─ e2e/                      # Playwright scenarios, drivers (legacy + next), visual, a11y, perf
│  ├─ mock/                     # in-memory PostgREST + functions + auth + maps stubs
│  └─ fixtures/                 # synthetic seed data (never real customers)
├─ scripts/                     # ship.ps1 (updated), copy-legacy.mjs, size-check.mjs, check-catalog-sync.mjs
└─ docs/overhaul/               # this spec, PROGRESS.md, QUIRKS.md, baseline/ screenshots
```

### Module boundaries (enforced with ESLint `no-restricted-imports`)

| Layer | May import | May not import |
|-------|-----------|----------------|
| `domain/` | `domain/` only | everything else, any browser global |
| `data/` | `domain/`, `data/`, `platform/` (storage, clipboard excepted from UI) | `ui/`, `features/`, `app/` |
| `ui/` | `ui/`, `domain/format.ts`, `domain/luminance.ts` | `data/`, `features/`, `app/` |
| `features/x/` | `ui/`, `domain/`, `data/`, `platform/`, `app/router.ts` | other `features/*` (share via `ui/` or `data/`) |
| `app/` | everything | — |

Max 400 lines per file (ESLint `max-lines` warn at 300, error at 400). No god modules.

## 3. Routing

- `routes.ts` is the single table: `{ path, load: () => import('../features/x/route'), minRole, title, nav }`.
- History API (`pushState`/`popstate`). Links use `<Link href>`; programmatic `go(path, { replace })`.
- **Views are kept alive** (v1 view-cache behaviour): a visited route's component stays mounted but hidden (`hidden` attribute + `inert`), so returning is instant and scroll is kept. Limit the cache to 6 routes (LRU) to bound memory; Sell and Orders are pinned.
- Idle prefetch: after first paint, `requestIdleCallback` loads chunks for the role's nav routes in order (Orders, Stock, then admin routes), skipped when `navigator.connection.saveData` or effective type is `2g`.
- Guards: route `minRole` checked before load; failure → `/sell` + toast.
- Sheets push a history entry (`{ sheet: id }`); `popstate` closes the top sheet first. Port the idea of Her Voice `useHistorySheet`.
- Legacy handlers run once at boot and on `hashchange`: `#store-orders`, `#load-store-order=<id>`, `#stock`.
- Netlify: SPA fallback rewrite `/* /index.html 200` placed **after** explicit rules. Verify that `/api/*` (functions declare `config.path`), `/sw.js`, `/manifest.webmanifest`, `/assets/*`, `/auth.html` are not swallowed (Netlify serves existing files and path-configured functions before rewrites, but **test it on a draft deploy** once the owner approves one). Legacy `/pages/*.html` redirects are 301s in `netlify.toml`.

## 4. State and data

### 4.1 Entities (port of `js/store/*`)

```ts
type EntityName = 'sales' | 'inventory' | 'clients' | 'deliveries';
type EntityMeta = { status: 'empty' | 'hydrated' | 'fresh' | 'stale' | 'error'; fetchedAt: number | null; error?: string };
// signals
entities.sales: Signal<Sale[]>;  meta.sales: Signal<EntityMeta>;  // etc.
```

Behaviour that must be identical to v1:
- `hydrate()` reads all four from IDB `venus-pos` / `cache` (keys `sales`, `inventory`, `clients`, `deliveries`, value `{ key, ts, data }`) before first paint. **Same DB name, store name, keys and value shape**, so v2 starts warm from v1's cache at cutover.
- Stale windows: inventory 20 s, sales 15 min, deliveries 15 min, clients 30 min (`js/store/repository.js:7-12`). Inventory local writes do not bump freshness (`data-store.js:156-160`).
- `inFlight` dedupe per entity.
- Empty-response guard: never replace non-empty cached inventory or sales with an empty server response (`data-store.js:185-196`).
- `persist()` after every successful fetch and local mutation.
- Legacy `sessionStorage` `venus-pos-cache:*` migration is **not** needed in v2 (v1 already migrated); skip it.
- `useEntity(name)` hook: returns the signal and triggers `ensureFresh(name)` per the stale rule; cold entities show skeletons, stale ones refresh silently.

### 4.2 Other state

| State | Where | Notes |
|-------|-------|-------|
| Counter cart + meta | `sessionStorage` `venus-pos-cart`, `venus-pos-order-meta` | **Same keys and JSON shape as v1** (`js/state.js:72-114`). A cart in progress survives cutover |
| Store order sessions (loaded carts) | signal map + `sessionStorage` `venus-pos-store-orders-v1` paint cache (90 s) | Port `storeOrderSessions` |
| Held sales (D6) | IDB store `held` | New store; IDB version bump with `onupgradeneeded` that leaves `cache` untouched |
| UI prefs | `localStorage` `venus.pos.ui.v1` (haptics on/off, last Sell group) | New |
| Notification prefs, fired, stock dedupe | `venus.notif.prefs.v1`, `venus.notif.fired.v1`, `venus.notif.stock.v1` | Unchanged keys |
| Fulfillment snapshot | `localStorage` `venus.pos.fulfillment` | Unchanged |
| Partner progress | `localStorage` `venus-cookie-partner-settled-qty-v4` | Unchanged |
| Chart/insight periods | `sessionStorage` `venus_chart_range`, `venus_insight_period` | Unchanged |
| Auth | `localStorage` `venus-pos-auth`; `sessionStorage` `venus.pos.auth.gate.bounce` | Unchanged |

Every storage key is declared once in `src/data/keys.ts`.

### 4.3 Writes

- One module per table/endpoint under `data/writes/`. Each exports typed functions whose **request method, URL, query string, headers and body are identical to v1** for the same intent. The E2E write-contract tests compare them (see `06-testing.md`).
- `checkout.ts` orchestrates the pipeline exactly as `js/orders.js:2386-2578` (see `02-product-spec.md §4.5`). It takes its dependencies as parameters (writes, clock, inventory accessors) so it can be unit-tested with fakes.
- Inventory: per-category serial queue, ensure call on boot (`POST /api/inventory/write {op:'ensure'}`), delta writes, PATCH fallback on 405/502 (`js/inventory.js:112-209`).
- Every write returns `Result<T, WriteError>`; UI shows a toast with Retry on error. No write is fire-and-forget without error handling (v1 async ones like `persistSoldBreakdown` log to debug and notify; keep that).

### 4.4 Realtime (`data/realtime.ts`)

```ts
interface Feed<T> { start(): void; stop(): void; onChange(cb: (e: ChangeEvent<T>) => void): Unsubscribe; status: Signal<'live' | 'polling' | 'offline'>; }
```

- `storeOrdersFeed`: realtime channel on `store_orders` (all events) + 4 s poll fallback when disconnected + immediate refetch on reconnect, `online`, and `visibilitychange → visible`. Port the channel generation counter and reconnect delay (4 s) from `js/store-orders.js:621-643`.
- `reviewsFeed`: realtime INSERT on `store_reviews`.
- `inventoryFeed` (NEW, read only): realtime UPDATE/INSERT on `inventory` → merges into `entities.inventory`. If the table isn't in the realtime publication, log once and rely on the stale window. **Do not change the publication without owner approval.**
- Realtime JWT: `setAuth(access_token)` and refresh on token refresh (port `js/realtime-client.js`).
- Tests inject a fake feed (`tests/mock/feed.ts`); production code gets the feed from a tiny DI container in `data/index.ts`.

### 4.5 Auth

- Port `js/auth/client.js` fully: sign in, refresh every 30 s check, `decodeJwtPayload`, role from `app_metadata.role || app_metadata.pos_role`, transient-error tolerance, `venus-pos-auth-invalid` handling → redirect to `/auth.html?next=…`.
- Pre-paint gate: an **inline** script in `index.html` `<head>` (≤ 1 KB) that checks for an `access_token` in `localStorage['venus-pos-auth']` and `location.replace('/auth.html?next=…')` if missing (v1 `gate-boot.js`). Keep the bounce-loop guard.
- Keep a `window.VenusPosAuth` shim **only if** something outside the app needs it (check the SW and functions; expected: nothing). Otherwise drop the global.

## 5. Service worker (`sw/sw.ts` → `/sw.js`)

Must keep: **URL `/sw.js`, scope `/`**. Push subscriptions are tied to the registration; replacing the script at the same URL keeps them. Moving or renaming it would silently break push for every staff phone.

Port from v1 `sw.js`:
- `install` → `skipWaiting()`; `activate` → delete old caches whose names match the shell/runtime pattern, `clients.claim()`, post `venus-sw-updated`.
- `META_CACHE` (installed-PWA flag) survives version bumps; keep its name.
- `push` handler: title/body/icon/badge/tag, `#load-store-order=` URL construction, `data.url` default `/#store-orders` (now resolves to `/orders` via the hash handler) — port `sw.js:254-314` exactly.
- `notificationclick`: focus an existing client and `postMessage({ type: 'venus-notif-click', url })`, or `openWindow` — port `sw.js:316-370`, including the display-mode ping (`sw.js:175`).
- `message` handler: `venus-skip-waiting`.

New:
- Cache name `venus-pos-${BUILD_ID}-shell` / `-runtime`. `BUILD_ID` = `git rev-parse --short HEAD` + build timestamp, injected at build.
- Precache list generated from the Vite manifest: `index.html`, `auth.html`, entry JS/CSS, Sell, Orders and Stock chunks, fonts (Geograph 400/500, Akkurat Mono), icons, manifest.
- Strategies: navigations network-first with 3 s timeout → cached `index.html`; hashed assets (`/assets/*-[hash].*`) cache-first (immutable); fonts cache-first; everything under `/rest/v1/`, `/auth/v1/`, `/functions/v1/`, `/api/` **never** cached.
- Update UX: the client registers, checks for updates every 60 s (v1) and on `visibilitychange`; when a new worker is waiting, show `Update ready · Restart`; auto-activate only when the cart is empty and no sheet is open.
- Write `/build.txt` containing `BUILD_ID`.

`netlify.toml` headers: `/sw.js` `no-cache` + `Service-Worker-Allowed: /` (keep); `/assets/*` with hashed names → `public, max-age=31536000, immutable`; non-hashed `/assets/icons/*`, `/assets/fonts/*` → keep v1's 7-day + SWR; HTML `max-age=0, must-revalidate`.

## 6. Build and transition (strangler)

Production must stay on v1 until cutover. The trick: v1 and v2 ship in the same deploy.

### During Phases 1–9

- `git mv` all v1 runtime files (`index.html`, `auth.html`, `pages/`, `js/`, `css/`, `vendor/`, `sw.js`, `manifest.webmanifest`) into `legacy/`. `assets/` stays at the root (shared, moved to `public/assets/`).
- Vite builds v2 with `base: '/next/'` into `dist/next/`. v2 does **not** register a service worker while under `/next/` (`if (import.meta.env.BASE_URL !== '/') skip`).
- `scripts/copy-legacy.mjs` copies `legacy/*` to `dist/` root unchanged after the Vite build.
- `netlify.toml`: `[build] command = "npm run build"`, `publish = "dist"`, `functions = "netlify/functions"` (unchanged).
- `ship.ps1`: run `npm ci && npm run build` before deploying `dist`; keep bumping `legacy/sw.js` `CACHE_VERSION` (its regex must now target `legacy/sw.js`) so v1 clients still refresh on every ship. Update `netlify.deploy.json` `publishDir` to `dist`.
- Redirects during this period: only `/next/*  /next/index.html  200` (v2 deep links). **Do not** add the root SPA fallback or the `/pages/*.html` 301s yet; v1 still serves those pages.
- v1's SW (scope `/`) will also see `/next/` requests. It is network-first for HTML/JS/CSS, so v2 still updates; that's acceptable during the parallel run.
- Both apps share origin, so auth, IDB cache and session cart are shared. **Never have v1 and v2 open with a cart at the same time on one device during the parallel run** (both write the same session keys). Put this in the parallel-run instructions.

### At cutover (Phase 10)

- Vite `base: '/'`, output to `dist/`. `copy-legacy.mjs` is removed from the build. The new `/sw.js` replaces v1's at the same URL.
- Add the `/pages/*.html` 301s, then the root SPA fallback `/*  /index.html  200` last. Add `/next/*  /:splat  301` so bookmarks from the parallel run keep working.
- `legacy/` stays in git, out of the build, for 14 days, then is deleted in a commit tagged `legacy-final`.
- Rollback = Netlify "Publish deploy" on the last v1-at-root deploy (instant). Because the SW URL is the same and bytes differ, phones pick up whichever is live.
- `ship.ps1` no longer bumps a hand-written version; the build stamps a new `BUILD_ID` every time, which changes `sw.js` bytes. Update the workspace rule text accordingly (owner approval).

## 7. Shared catalog with the storefront

Full cross-repo sharing (a workspace package) is out of scope; the storefront is a separate repo and site. Instead:
- `src/domain/catalog.ts` is POS's single source.
- `scripts/check-catalog-sync.mjs` (run in CI and before ship) reads `venus-store/js/shared/flavored-cookie-pricing.js`, `venus-store/js/shared/products-catalog.js` (prices, pack sizes) and `netlify/functions/inventory-write.mjs` `CATEGORY_META`, and fails if prices, thresholds, IDs (after the kebab↔snake mapping in `venus-store/js/shared/store-order-sync.js:12-26`) or colours disagree with `catalog.ts`. It skips the storefront checks with a warning if `../venus-store` is absent.
- Known drift to record in QUIRKS.md, not fix: POS counts 0 flavoured cookies for an unselected pack; the store counts pack defaults immediately.

## 8. Code quality gates

- `tsc --noEmit` clean.
- ESLint: typescript-eslint recommended + strict, `no-restricted-imports` boundaries, `max-lines`, `no-console` (allow in `debug/`), `eqeqeq`, no `any` in `domain/` and `data/`.
- Stylelint: `color-no-hex` and `function-disallowed-list: rgb, rgba, hsl` everywhere except `src/styles/tokens.css`; `declaration-no-important` (allow in reduced-motion block); disallow `box-shadow` values not using `var(--e-*)`; disallow `border-radius` not using `var(--r-*)` or `0`.
- Prettier on commit (husky optional; at least `npm run lint` in CI).
- GitHub Actions workflow `ci.yml` on push and PR: install, lint, typecheck, Vitest, Playwright (Chromium desktop + Pixel 7 + iPhone 13 emulation), size check, catalog sync check. Netlify auto-deploy stays **off** (`gitContinuousDeployment: false`).

## 9. Performance budgets (CI-enforced where possible)

| Metric | Budget | How measured |
|--------|--------|--------------|
| Sell route initial JS (entry + shell + sell chunk) | ≤ 60 KB gzip | `scripts/size-check.mjs` over Vite manifest |
| Initial CSS | ≤ 20 KB gzip | same |
| Any other route chunk | ≤ 50 KB gzip (Insights ≤ 70 KB) | same |
| Fonts on first paint | Geograph 400 + Akkurat Mono preloaded (≈ 44 KB); Geograph 500 + Self Modern lazy | network log in E2E |
| Third-party on first paint | **zero** (no Google Fonts, no CDN supabase-js, no Maps) | E2E asserts no requests to other origins except Supabase REST/auth |
| Cold start to Sell tiles visible (no SW, 4× CPU throttle, Fast 4G profile) | ≤ 2.0 s | Playwright + CDP throttling, `data-ready` marker |
| Warm start (SW + IDB) to tiles visible | ≤ 700 ms | same |
| Tap tile → config sheet visible | ≤ 100 ms (4× CPU) | `performance.mark` around the handler, asserted in E2E |
| Add to sale → CartBar updated | ≤ 50 ms | same |
| Charge tap → button state change | ≤ 50 ms | same |
| INP on Sell during a scripted 10-item sale | ≤ 150 ms p98 | `web-vitals` in an E2E build |
| Memory after visiting every route twice | ≤ v1 baseline | `performance.memory` (Chromium) |

Record v1's numbers for the same metrics in Phase 0 (`docs/overhaul/baseline/perf.md`) so the improvement is shown, not claimed.

Techniques to meet them: route chunks, idle prefetch, signals with fine-grained updates (cart total updates without re-rendering tiles), `content-visibility: auto` on long lists (History, Clients) in addition to the virtual list, no layout reads in tap handlers, `will-change` only during an animation, image-free UI (icons are inline SVG), Maps and realtime as lazy chunks.
