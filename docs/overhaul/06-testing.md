# 06 — Testing: proving nothing broke

The overhaul is safe only if we can **prove** v2 does what v1 does. The core idea is the **write contract**: for the same user intent, v2 must send the same requests to Supabase and the Netlify functions as v1 did. UI can change completely; writes may not (except approved decisions).

The harness is built in **Phase 0, against v1, before any v2 code exists**.

---

## 1. Test layers

| Layer | Tool | Runs against | Purpose |
|-------|------|--------------|---------|
| L1 Unit | Vitest | `src/domain`, `src/data` | Logic correctness, edge cases |
| L2 Dual-run parity | Vitest + fast-check | legacy function vs v2 function | v2 domain logic equals v1 on thousands of inputs |
| L3 Write contract | Playwright + mock backend | **legacy** (records goldens) and **next** (compares) | Same writes for the same scenario |
| L4 Behaviour | Playwright | next | Sheets, back button, undo, guards, keyboard, offline UI |
| L5 Visual | Playwright `toHaveScreenshot` | next | Catch unintended visual change |
| L6 Accessibility | `@axe-core/playwright` + keyboard E2E | next | Zero serious/critical violations |
| L7 Performance | Playwright + CDP throttling + size script | legacy (baseline) and next | Budgets in `04-architecture.md §9` |
| L8 Manual device QA | Real phones, checklist below | next on `/next/` (parallel run) | What automation can't see |

Commands (add to `package.json`):

```
npm run test          # L1 + L2
npm run e2e           # L3 + L4 (Chromium desktop + Pixel 7 + iPhone 13 projects)
npm run e2e:record    # L3 against legacy with RECORD=1 → writes goldens
npm run e2e:visual    # L5
npm run e2e:a11y      # L6
npm run perf          # L7
npm run size          # bundle budgets
npm run check         # lint + typecheck + test + e2e + size + catalog sync (pre-ship gate)
```

---

## 2. The mock backend (`tests/mock/`)

A Playwright fixture that intercepts every network request. **Any request it does not recognise fails the test** (throw + log the URL). That guarantees no request escapes to the real Supabase project and every new request shape is noticed.

```ts
// tests/mock/index.ts
export async function installMockBackend(page: Page, opts: {
  seed: Seed;                  // from tests/fixtures
  role: 'pos_admin' | 'pos_staff';
  failures?: FailureRule[];    // e.g. { method:'POST', table:'sales', status:500, times:1 }
}): Promise<MockHandle>;

interface MockHandle {
  db: MemoryDb;                // inspect / mutate (e.g. insert a store order)
  writes: RecordedWrite[];     // every non-GET request in order
  requests: RecordedRequest[]; // everything, for debugging
  setFailure(rule: FailureRule): void;
}
```

### 2.1 What it must serve

| Target | Behaviour |
|--------|-----------|
| `https://xiangrykfxlnacthjcad.supabase.co/rest/v1/<table>` | In-memory PostgREST subset (§2.2) |
| `…/auth/v1/token?grant_type=password` and `refresh_token` | Return a session whose `access_token` is an unsigned JWT (`header.payload.sig`) with `app_metadata.role` set to `opts.role`, `exp` 1 h after the fixed clock. v1 decodes the payload without verifying (`js/auth/client.js:54-60`) |
| `…/auth/v1/user`, `…/auth/v1/logout` | Matching user / 204 |
| `…/functions/v1/store-auth` | Actions used by POS: `admin_list_users`, `admin_set_pos_display_name`, `admin_set_verified`, `admin_delete_user`, `admin_list_pos_labels` — backed by `db.store_accounts` |
| Same-origin `/api/inventory/write` | `op: 'ensure'` (return all rows, create missing categories) and delta ops, applied to `db.inventory`. Mirror the real function's logic by reading `netlify/functions/inventory-write.mjs` |
| `/api/cookie-partner/settle` | Record + return what the real function returns |
| `/api/push/subscribe`, `/unsubscribe`, `/notify`, `/tick` | Record + 200 |
| `https://venus-store.netlify.app/api/push/notify` | Record + 200 |
| `https://maps.googleapis.com/**` | Serve `tests/mock/gmaps-stub.js`: a minimal `google.maps` with `importLibrary('places')` and `Geocoder`, plus whatever distance API v1 calls (`js/orders.js:1208-1228`, `js/places-autocomplete.js`). Read those files and stub exactly the APIs used, returning fixtures from `tests/fixtures/places.json` |
| `cdn.jsdelivr.net`, `unpkg.com` (v1 supabase-js) | Abort, which forces v1's 4 s poll fallback |
| Realtime websocket (`wss://…/realtime/v1/websocket`) | Close immediately via `page.routeWebSocket`, which forces v2's poll fallback too. Both apps then sync store orders the same way in tests. Realtime itself is unit-tested with a fake (§4) |
| Google Fonts (v1) | Serve an empty stylesheet (no external dependency in tests) |
| Anything else off-origin | **Fail the test** |

### 2.2 PostgREST subset

Before writing it, grep every `sbFetch(` and `fetch(` call in `legacy/js/` and list the exact query shapes in `tests/mock/QUERIES.md`. Support exactly those:
- `select=` with column lists and the one-level embeds actually used (e.g. `store_accounts(pos_display_name)`).
- Filters: `eq.`, `neq.`, `in.(…)`, `gte.`, `lte.`, `gt.`, `lt.`, `is.null`, `not.is.null`; `order=col.asc|desc` (multiple); `limit`; `offset`.
- `Prefer: return=representation` (return rows) or `return=minimal` (204).
- `Accept: application/vnd.pgrst.object+json` (single object).
- POST (object or array), PATCH with filters, DELETE with filters. Generated `id`s are deterministic: `00000000-0000-4000-8000-` + 12-digit counter. `created_at` / `updated_at` = the fixed clock.
- Mirror DB-side behaviour v1 relies on (find it by reading how v1 uses responses): e.g. deleting a sale cascades its delivery rows if v1 expects that.

### 2.3 Fixed time and environment

- `page.clock.install({ time: new Date('2026-11-10T10:30:00+03:00') })` before navigation. This date is a Tuesday after the partner tracking start (2026-08-12), so partner logic is exercised.
- Context options: `serviceWorkers: 'block'` (otherwise SW fetches bypass `route()`), `locale: 'en-UG'`, `timezoneId: 'Africa/Kampala'`, geolocation granted at a fixture point in Kampala, `reducedMotion: 'reduce'` for visual tests only.
- Notification API: grant permission and spy on `new Notification` / `registration.showNotification` via an init script.
- Clipboard: grant `clipboard-read`/`clipboard-write`.

---

## 3. Fixtures (`tests/fixtures/`)

**Synthetic only.** No real names, phones, locations, or sales. The repo is public.

`seed.ts` builds (deterministically):

| Table | Content |
|-------|---------|
| `inventory` | Every category in `CATEGORIES` (+ the legacy `cookie` row, to test normalisation). Mix: 0 (out), 3 and 5 (low, threshold 5), 20+, cookies at 25 (below 30 % of 100) and 80 |
| `clients` | 10 clients ("Test Client A" … "J"), two with near-duplicate names for the merge logic |
| `sales` | ~80 over 120 days before the fixed clock: every product type; packs with every pool; bulk-flavoured cookie sales; wholesale; rewards (`is_reward`, `points_cost`); paid, unpaid credit, partially paid credit, cleared credit; delivery sales; a store-order sale; enough cookie sales after 2026-08-12 for partner batches |
| `credit_payments` | Partial and full payments across methods `cash`, `mobile`, `other` |
| `deliveries` | 25 trips across Kampala periods, incl. 3 with `client_name = 'SafeBoda test'` and some `fee_was_edited` |
| `store_orders` | 2 `pending`, 1 `confirmed`, 1 `accepted`, 1 `cancelled` (not dismissed), 1 `cancelled` dismissed, 1 `checked_out`; mixed pickup/delivery; product IDs in storefront kebab-case |
| `store_reviews` | 6 with ratings 1–5 |
| `store_fulfillment` | `id = 'default'`, open 07:00–22:00, not busy |
| `store_accounts` | 4 storefront users, 2 with `pos_display_name` |

Also `places.json` (autocomplete predictions, place details, distances) and `seed-empty.ts` (brand-new shop: no sales, no clients) for empty states.

---

## 4. L1 unit and L2 dual-run

### 4.1 Allowed legacy edits for testing

Only adding `export` to existing top-level functions or constants in `legacy/js/*.js`. No logic changes. Commit these separately: `test: export legacy helpers for parity`.

### 4.2 Loading legacy modules in Vitest

Use the `jsdom` environment for `tests/dual-run/`. Legacy modules touch `window`, `document`, `localStorage` at import time in places; provide a `tests/dual-run/setup.ts` that stubs `window.VenusPosAuth`, `window.VENUS_POS`, and `matchMedia`. If a module can't be imported without a DOM side effect, document it in QUIRKS.md and test its logic through L3 instead.

### 4.3 Dual-run coverage (must exist before the matching v2 code is accepted)

For each pair, write `tests/dual-run/<name>.test.ts`:
1. A fixture table of hand-picked cases (including edge cases listed).
2. A fast-check property: `fc.assert(fc.property(arbInput, x => expect(v2(x)).toEqual(legacy(x))), { numRuns: 2000 })`.

| Legacy source | v2 target | Inputs / edge cases |
|---------------|-----------|---------------------|
| `js/flavored-cookie-pricing.js` (all exports, e.g. `applyToCartLines`) | `domain/pricing/flavored-bulk.ts` | 0–12 flavoured cookies; butterscotch mixed in; packs + singles crossing the threshold of 4; empty pack selections |
| `js/product-config.js` (pricing, validity, breakdown builders) | `domain/pricing/pack-config.ts` | every product id; `choose_any` / `choose_variety`; Quartet fixed butterscotch; stock-limited pools; wholesale unit prices |
| `js/config.js` (`cookieUnitPrice`, `cookieWholesaleUgx`, `getNavPages` logic) | `domain/catalog.ts` | legacy `cookie` id; unknown ids |
| `js/utils.js` `formatUGX` and other formatters | `domain/format.ts` | 0, negatives, 999, 1,000, 1,000,000, non-integers, `null` |
| `js/revenue.js` (`saleRecognizedOwnerRevenue`, `sumOwnerRevenue`, partner progress, `cookieBatchShareText`) | `domain/revenue.ts`, `domain/partner.ts` | credit unpaid / partial / cleared; packs split across cookies; sales before and after 2026-08-12; corrupted "all settled" values; baseline 25 |
| `js/settle-credit.js` allocation, `js/credit.js` helpers | `domain/credit.ts` | FIFO across many sales; amount > owed (must clamp as v1 does); partial; merged duplicate names |
| `js/delivery-fee-model.js` (fit + `predictSafeBodaFeeRange`) | `domain/delivery-fee.ts` | 0, 1, 2 points; outliers; each Kampala period; minimum fee 3,000; floats compared with `toBeCloseTo` only where v1 uses floats |
| `js/orders.js` `buildSaleFulfillmentFields` and the checkout body builder (export them) | `domain/sale-payload.ts` | pickup, delivery, manual fee, store order, credit, rewards, wholesale |
| `js/inventory.js` sold-breakdown → delta logic, normalisation | `domain/inventory-delta.ts` | packs, singles, legacy `cookie`, stock-deferred store lines |
| `js/store-orders.js` row → cart mapping (`applyStorefrontOrderToCart` core) | `domain/store-order-map.ts` | every storefront product id; delivery and pickup; unknown ids |
| `js/order-history.js` grouping | `domain/history-groups.ts` | today, week boundaries (Kampala time), month boundaries, year change |
| `js/analytics.js` / `analytics-chart.js` aggregations (period bucketing, ranks, heatmap, top product) | `domain/analytics/*` | each period; empty data; credit proration |
| `js/fulfillment.js`, `js/hours-dial.js` time logic | `domain/hours.ts` | busy past midnight; busy_until in the past; open/close edges |
| `js/notifications.js` stock crossing rule | `domain/stock-state.ts` | crossing low, crossing out, recovering |

L1 adds tests for v2-only logic: `luminance.ts`, cart reducer, held-sale serialisation, router guard logic, entity stale rules (with an injected clock), checkout pipeline with fake writes (success, sales POST failure → rollback, async inventory failure → notify, double-submit), realtime feed adapter (connect, drop → poll, reconnect → refetch, token refresh → `setAuth`).

**Coverage gate:** `src/domain/**` ≥ 95 % lines and branches; `src/data/**` ≥ 85 %.

---

## 5. L3 write-contract scenarios

### 5.1 Structure

```
tests/e2e/
  scenarios/          # S01-*.ts : intent steps, written once, UI-agnostic
  drivers/legacy.ts   # implements intents by clicking v1 UI (selectors from legacy/js)
  drivers/next.ts     # implements intents by clicking v2 UI (data-testid)
  goldens/S01.json    # recorded from legacy
  goldens/S01.next.json  # ONLY if an approved decision changes this scenario's writes
  contract.spec.ts    # runs each scenario per driver; compares
```

A scenario is a list of intents, e.g.:

```ts
export const S02: Scenario = {
  id: 'S02', title: 'Cookie Duet, existing client, paid',
  role: 'pos_staff', seed: 'default',
  steps: [
    { do: 'addProduct', product: 'cookie_duet', flavors: { cookie_mint: 1, cookie_chocolate: 1 } },
    { do: 'setClient', name: 'Test Client A' },
    { do: 'charge' },
    { expect: 'saleRecorded', total: 15000 },
  ],
};
```

Both drivers implement every intent. v2 elements carry `data-testid` attributes named in `tests/e2e/drivers/TESTIDS.md`.

### 5.2 Recording and comparing

- `RECORD=1 npm run e2e:record` runs scenarios with the legacy driver and writes `goldens/Sxx.json`: the normalised writes plus the asserted display values.
- `npm run e2e` runs with the next driver and compares against `Sxx.next.json` if present, else `Sxx.json`.
- **Normalisation:** sort query parameters; parse JSON bodies; drop headers except `Prefer` and `Content-Type`; replace generated ids with `<id:n>` by first appearance; replace ISO timestamps with `<ts>` unless the field is a business time chosen by the user (e.g. `deliverAt`), which must match exactly.
- **Ordering:** compare writes as a multiset, then assert causal order: `sales` POST before its `/api/inventory/write` deltas, `deliveries` POST and `store_orders` `checked_out` PATCH; `store_orders` `accepted` PATCH before `confirmed_at` PATCH for the same order; `credit_payments` POST before the `sales` PATCHes they settle.
- **Flake policy:** a golden is accepted only after the legacy run passes `--repeat-each=3` with identical output. A next run must pass `--repeat-each=3` before a phase exits.
- **Quirks:** if legacy does something odd (a duplicate PATCH, a field that looks wrong), the golden keeps it, and v2 replicates it. Write it in `QUIRKS.md`. Only the owner can approve fixing it, which then produces an `Sxx.next.json` with a short `"approvedChange": "D-x / QUIRKS #n"` note.

### 5.3 Scenario list

Seed `default` unless noted. Role in brackets.

**Selling**
- S01 [staff] Scout pack, one flavour, existing client, paid.
- S02 [staff] Cookie Duet, two flavours, paid.
- S03 [staff] Cookie Quartet (fixed butterscotch + variety rule), paid.
- S04 [staff] Four flavoured single cookies → bulk 6,500 unit price.
- S05 [staff] Cookie Trio + 2 flavoured singles crossing the threshold → pack repriced.
- S06 [admin] Wholesale cookies with a custom unit price.
- S07 [staff] Plain × 3.
- S08 [staff] Bangis 50/50 × 2 + 70/30 × 1.
- S09 [staff] Variety pack (8, `choose_variety`) + Commander's Stash in one sale.
- S10 [staff] New client created inline at checkout.
- S11 [staff] Credit sale for a client with no debt.
- S12 [staff] Credit sale for a client with existing debt → stacked-debt confirmation accepted.
- S13 [staff] Same as S12 but the confirmation is declined → no writes.
- S14 [staff] Delivery sale: GPS pickup, Places drop-off, predicted fee, deliver-at time, phone.
- S15 [staff] Delivery sale with a manually edited fee (`fee_was_edited`).
- S16 [staff] Edit a cart line (change flavours) before charging.
- S17 [staff] Remove a line, then charge (v2: also undo once, which must not produce writes).
- S18 [staff] Sales POST fails once (500) → rollback, cart intact → retry succeeds → exactly one sale.
- S19 [staff] Double-tap Charge → exactly one sale.
- S20 [staff] Reward line from a storefront order (`is_reward`, `points_cost`) checks out correctly.

**Storefront orders**
- S21 [staff] Pending order → load into cart (`accepted`) → confirm for customer (store push) → checkout (`store_order_id`, `checked_out`).
- S22 [staff] Cancel a pending order → store push; no duplicate toast.
- S23 [staff] Dismiss a cancelled order (`dismissed_at`).
- S24 [staff] Two orders loaded; switch between them; check out the second; first remains in cart.
- S25 [staff] Counter cart parked while a store order is reviewed, then restored intact.
- S26 [staff] New order arrives while on Sell (insert into mock db, advance clock 4 s) → badge + notification.
- S27 [staff] Deep link `/#load-store-order=<id>` opens the order in the cart.
- S28 [staff] Busy 30 min from the store status control, then clear (`store_fulfillment` PATCHes). v2: undo also tested (L4).

**Stock**
- S29 [staff] +1 and −1 on a joint flavour and a cookie flavour (queued deltas).
- S30 [staff] Set an exact count via keypad (v1: tap count).
- S31 [staff] Bulk adjust by +24 (v1: double-tap amount modal).
- S32 [staff] `/api/inventory/write` returns 502 → direct PATCH fallback.
- S33 [staff] Stock crosses the low threshold after a sale → stock notification fires once.

**Back office**
- S34 [admin] Settle part of a client's credit with cash (FIFO across 3 sales).
- S35 [admin] Settle a client's full credit with mobile money and a note.
- S36 [admin] Edit a past sale's items → stock delta + sale PATCH.
- S37 [admin] Void a delivery sale → sale DELETE (+ delivery cascade as v1 does) + stock returned.
- S38 [admin] Cookie partner: mark the next batch settled; copy batch text (clipboard equals golden).
- S39 [admin] Clients: add, rename, delete.
- S40 [admin] Storefront users: set POS display name; verify; delete.
- S41 [admin] Store hours: change open/close and suggest window.
- S42 [admin] Delivery log: edit a trip row.
- S43 [admin] Quote lab: log a preset test route.
- S44 [admin] Reviews: list renders; refresh; a new review arrives.
- S45 [staff/admin] Enable notifications → push subscribe; change prefs.

**Access and resilience (display assertions, few writes)**
- S46 [staff] Only Sell, Orders, Stock, More, Settings reachable; typing `/insights` redirects with a toast; no admin requests are made.
- S47 [admin] Every route loads with the default seed and with `seed-empty`.
- S48 [staff] Offline boot (requests blocked after an initial warm visit) → IDB data paints; Sync chip shows offline; a sale attempt fails cleanly with the cart kept.
- S49 [staff] Sign out → session cleared → `/auth.html`; sign back in → `next` respected.
- S50 [admin] Display parity: Today pill values, Insights overview numbers, credit owed per client, history group counts equal the legacy values captured in the golden (`display` block).

---

## 6. L4 behaviour tests (next only)

- Android back closes the top sheet, then navigates back; never exits with an open cart.
- Sheet with work-in-progress ignores backdrop taps; read-only sheets close on backdrop.
- Undo restores a removed line and a cleared cart; undo on store status writes the previous values.
- Disabled Charge shows the reason; tapping it focuses the missing field.
- Hold sale → resume → identical cart; held sales survive reload; not shared across devices (separate context).
- View keep-alive: scroll position and filters on History survive a round trip to Sell.
- SW update toast never reloads with a non-empty cart (simulate `waiting` worker).
- Keyboard-only sale on desktop (Tab/Enter/Space/Escape) completes S02.
- Legacy URL redirects and hash handlers (all rows in `02-product-spec.md §2`).
- Store status, Today pill and badges update from mock data changes without reload.

## 7. L5 visual regression (next)

- Viewports: 360 × 740 (small Android), 390 × 844 (iPhone 13), 768 × 1024, 1280 × 800.
- Capture: every route (default seed and empty seed), Config sheet per product rule, cart with store-order tabs, success state, every Dialog, Today sheet, Settings, `/system` gallery.
- `await document.fonts.ready`, `reducedMotion: 'reduce'`, mask relative times.
- `maxDiffPixelRatio: 0.01`. Baselines update only for owner-approved design changes, in a commit titled `visual: update baselines (<reason>)`.
- **Phase 0 also captures legacy screenshots** at the same viewports into `docs/overhaul/baseline/` for before/after comparison (not asserted).

## 8. L6 accessibility

- `@axe-core/playwright` on every route and open overlay: zero `serious`/`critical`.
- Focus is trapped in sheets/dialogs and returns to the opener.
- Every `IconButton` has an accessible name (also enforced by a TS required prop).
- Contrast: tokens are pre-checked (`03-design-system.md §3.2`); axe confirms.
- Touch targets: a test walks every interactive element on Sell, Cart, Config, Stock and asserts its box is ≥ 48 × 48 (≥ 56 for steppers and flavour chips, ≥ 64 for Charge).

## 9. L7 performance

- `tests/e2e/perf.spec.ts`, Chromium only: CDP `Emulation.setCPUThrottlingRate(4)` and a Fast 4G network profile; cold (no cache) and warm (second visit) loads; median of 5 runs.
- Markers: v2 sets `performance.mark('sell-ready')` when tiles render with data; the legacy baseline uses the first product row's appearance.
- Interaction timing: wrap tile tap → sheet visible, add → CartBar update, Charge → button state with `performance.now()` deltas collected through `page.evaluate`.
- `npm run size`: gzip sizes from the Vite manifest against budgets; fails CI.
- Write results to `docs/overhaul/baseline/perf.md` (legacy, Phase 0) and `docs/overhaul/perf-v2.md` (each phase).

## 10. L8 manual device QA (parallel run, Phase 9)

Run on the staff's real Android phone (installed PWA) and one iPhone, on mobile data:

- [ ] Install from Settings; icon and name unchanged; opens to Sell.
- [ ] Existing push subscription still delivers a storefront test order notification; tapping it loads the order into the cart.
- [ ] Ten real sales during a normal shift, including a credit sale, a delivery and a storefront order. Compare each in History against what v1 would show.
- [ ] Airplane mode mid-sale: cart kept, clear message, sale succeeds after reconnecting with Retry.
- [ ] Sunlight readability at the counter; one-handed use for the full sell flow.
- [ ] Notification prefs and busy toggle behave as before.
- [ ] No device has v1 and v2 open with a cart at the same time (shared session keys).
- [ ] Owner reviews History, Insights and Clients numbers against v1 for the same day.

Log findings in `docs/overhaul/PARALLEL-RUN.md` with date, device, steps, expected, actual.

---

## 11. Gates

**Per slice (every commit that changes behaviour):** lint, typecheck, L1/L2 for touched modules, and L3 for touched scenarios pass locally.

**Per phase exit:** all tests for that phase's scenarios pass with `--repeat-each=3`; visual baselines reviewed; size budget met; `PROGRESS.md` updated; owner checkpoint passed if the phase has one.

**Pre-cutover:** `npm run check` green; every row in `07-parity-checklist.md` ticked; parallel run log has no open P0/P1 issues; owner says "ship".
