# Handoff — Venus POS overhaul

**Date:** 2026-11-12
**Repo:** https://github.com/ofamba404/venus-pos (public)
**Branch:** `overhaul` (fast-forward only)
**Phase:** Phase 9 is live at `/next/`. Signed-out smoke passed. Signed-in smoke, the staff message, and 3 days of real use wait on the owner. Do not start Phase 10. Do not apply migrations.

## Cleared phases

**Phase 0 — Safety net.** S01–S50 goldens matched three times (150 passed). `npm test` 125 passed at that commit. Quirks 1–11. Baselines and `perf.md` are in `docs/overhaul/baseline/`. Commit `8cbdc36`.

**Phase 1 — Restructure and build pipeline.** `npm run build` hash check: **82 legacy files match `dist/`**. S01–S50 against `dist/`: **50 passed**. Draft deploy not run. Commit `2eae8a0`.

**Phase 2 — Domain port.** Exit criteria from `05-implementation-plan.md`:

1. **Every dual-run passes with 2,000 runs.** Catalog, format, flavored bulk, pack config, cart totals, inventory delta, sale payload, store-order map, stock state, hours, hours dial, credit, revenue, partner (including clipboard text), delivery fee rounding and quote/fit, history groups, analytics rank, and analytics period/heatmap. `npm test`: **147 passed**.
2. **Domain coverage ≥ 95%.** v8 on `src/domain/**`: **lines 99.43% (2821/2837), branches 95.36% (1544/1619), functions 100% (202/202)**. `vitest.config.ts` fails the run under those thresholds.
3. **No imports outside `domain/`.** `tests/unit/domain-imports.test.ts` walks `src/domain` and rejects any specifier that is not a relative import inside that folder.
4. **`check-catalog-sync` passes.** `node --experimental-strip-types scripts/check-catalog-sync.mjs`: inventory `CATEGORY_META` matches `catalog.ts` (**14 ids**). `../venus-store` is absent, so storefront price/pack/id checks are skipped with a warning. Wired into `npm test` as `catalog:check`.

`npm run typecheck` passed. `npx playwright test`: **109 passed, 2 skipped, 0 failed** (15.3m). Chart aggregations live in `src/domain/analytics/periods.ts` and `patterns.ts` and dual-run against `legacy/js/analytics-chart.js`. Partner batch lines and clipboard text dual-run against `legacy/js/revenue.js`.

**Phase 3 — Data, auth, realtime.** Exit criteria:

1. **L1 coverage ≥ 85% on `data/`.** `npm test` runs `scripts/check-coverage.mjs`. **Data lines 87.24% (1272/1458).** Domain stays gated at lines 99.44% and branches 95.45%. `npm test`: **154 passed**.
2. **v1 IndexedDB hydrate.** `tests/unit/hydrate-boot.test.ts` seeds `{ key, ts, data }` sales and inventory rows and `hydrateEntities` paints them. `tests/unit/idb-cache.test.ts` reads the same row shape from the `cache` store.
3. **v1 session cart.** `tests/unit/v1-hydrate.test.ts` loads `venus-pos-cart` and `venus-pos-order-meta` and reads the same line total, client name, and client id.
4. **v1 auth session.** The same test accepts a `venus-pos-auth` payload wrapped as `currentSession` and sets `authRole` to `pos_admin`. `index.html` still redirects a signed-out visit to `/next/auth.html` before paint.
5. **Checkout L1.** `tests/unit/data-layer.test.ts` covers a paid sale, a 500 that restores stock, a 503 that queues, a second call refused while the first is in flight, a short-stock refusal, and a store hold with no signal.

`npm run typecheck` passed.

## Baseline repairs before Phase 2

The suite was not green on a fresh `npm test` / `npx playwright test`:

- `tests/dual-run/hours-dial.test.ts` failed in UTC. v1 rolls a chosen clock forward by at most one day, so 12:00 am during the last 30 seconds of the day can land inside the 30-second window. The property now matches that. Quirk 12.
- Full Playwright first run: **106 passed, 3 failed, 2 skipped**. S32's 502 was sometimes consumed by inventory `ensure`, and the fallback PATCH could finish before a second waiter. The driver now fails only `op: "delta"` and waits for that PATCH or a successful delta. S38 read the clipboard before `writeText` resolved; it now waits for the settled toast. S48's offline mock returns HTTP 503, which was not queued; `shouldQueueSale` now queues 502/503/504 and still does not queue a 500 (S18).

**Phase 4 — Design system and shell.** D11 approved the look on 2026-11-12, so the owner checkpoint is waived. Exit criteria:

1. **Look approved.** D11, recorded in `08-decisions.md`.
2. **Size budget.** `node scripts/check-size.mjs` after `npm run build`: main JS **27,926 bytes gzip** (limit 61,440), CSS **4,470 bytes gzip** (limit 20,480). Sell is in the main chunk.
3. **Axe clean.** `npx playwright test --project=chromium tests/e2e/axe.spec.ts`: **/sell and /system, 2 passed**, no serious or critical violations.

**Phase 5 — Sell, checkout, Orders.** The owner checkpoint is waived. Exit criteria:

1. **S01–S28 write contracts.** The full `npx playwright test` on this branch before the charge-reason copy (**109 passed, 2 skipped**) includes every S01–S28 case in `tests/e2e/contract.spec.ts`. The reason line does not change the sale body. The new L4 sale still shows "Sale recorded".
2. **L4 Sell tests.** `npx playwright test --project=chromium tests/e2e/l4.spec.ts`: **4 passed**. A removed line comes back on Undo. Charge stays disabled, with "Add a customer to continue", until a client is chosen.
3. **Tap count.** A Scout sale for the recent client Test Client A is **5 taps** (tile, mint, Add, client chip, Charge), under the 6-tap target. Recorded below and in `PROGRESS.md`.
4. **Render budget.** With CPU throttling ×4, the in-page time from the Scout tile click to the config Add button is **≤ 100 ms**.

**Phase 6 — Stock, Settings, Auth, PWA.** Exit criteria:

1. **S29–S33, S45, S46, S48, S49 match.** `npx playwright test --project=chromium tests/e2e/contract.spec.ts -g "S29 stock|S30 set stock|S31 bulk|S32 inventory|S33 low-stock|S45 enable|S46 staff|S48 offline|S49 sign"`: **9 passed** (2.4m) against the mock at `/next/`.
2. **Staff surface.** Those scenarios sign in as staff, change stock (including the 502 PATCH fallback), subscribe to notification prefs, bounce `/insights` back to Sell, queue an offline charge, and sign out and back in.
3. **Service worker routing.** `tests/unit/sw-routing.test.ts` passes inside `npm test`. The built worker is not registered while the app is under `/next/`.

**Phase 7 — Back office.** Exit criteria:

1. **S34–S44, S47, S50 match.** They are in the full `npx playwright test`: **122 passed, 2 skipped, 0 failed** (15.4m). Axe on `/sell` and `/system` is clean. `baseline.spec.ts` captured the L5 screenshots in that same run.
2. **Parity rows.** `07-parity-checklist.md` is ticked for every row the mock can prove, including draft stock, the owes hint, cart reload, store-order release and the cancelled banner, stock glance, insights range and heatmap text, debug capture/copy/reload, install steps, the manifest `id: "/"`, and legacy URL hashes.
3. **Unit gate.** `npm test`: **166 passed**. Domain lines **99.48% (3070/3086)**, branches **95.14% (1702/1789)**. Data lines **87.23% (1271/1457)**. `npm run typecheck` passed.

Five checklist rows stay open because they need a production deploy or the cutover worker: new-order push, push subscribe, the `/sw.js` handlers, surviving push subscriptions, and Netlify function reachability.

**Phase 8 — Approved improvements.** The checkpoint is waived. `tests/e2e/phase8.spec.ts`: **3 passed**.

1. **D2 walk-in.** A paid Plain sale with the Walk-in chip posts `client_id: null`. Credit still requires a name. Note: `tests/e2e/goldens/D2-walk-in.next.json`.
2. **D4 offline queue.** `features.offlineQueue` is on. S48 in the Phase 7 full Playwright run queued an offline charge. `supabase/migrations/20261112030000_sales_client_sale_id.sql` adds `client_sale_id` and is **not applied**. Note: `tests/e2e/goldens/D4-offline.next.json`.
3. **D6 device hold.** Holding Plain and resuming it restores the line and posts no sale. Note: `tests/e2e/goldens/D6-hold.next.json`.
4. **Flags.** `paymentMethod` is false. `walkInClient`, `holdSale`, and `offlineQueue` are true.

## Merge of production master

`origin/master` was not an ancestor of `overhaul`. A normal merge brought those commits in, including `4251e1f` (cookie partner Mark sent: the server never lowers settled qty, writes an audit log, and the client only counts a send when `res.ok`). The service worker is `venus-pos-v114`. `legacy/` is a byte-for-byte copy of master's register (`index.html`, `auth.html`, `sw.js`, `manifest.webmanifest`, `js/`, `css/`, `pages/`, `vendor/`) and `public/assets` matches master's `assets/`. `npm run build` copies that tree to `dist/` outside `/next/`. Netlify functions, `supabase/migrations`, and `supabase-functions/store-auth` match master. The overhaul-only `client_sale_id` migration is still unapplied. `netlify.toml` adds `npm run build`, `publish = "dist"`, and the `/next/*` rewrite.

v2 follow-ups, not blockers:

- Cookie Quartet is still on the v2 sell grid. v1 no longer sells it. The legacy S03 check only proves the tile is gone.
- Staff inventory is read-only on v1. v2 still lets staff change stock.
- Partial cookie-partner sends are in the domain (`cookiePartnerBatchesFromCuts`, `partialSendCount`). The Insights screen still settles a full batch.
- `jointCostAt` prices flavored joints at 4,000 UGX from 2026-11-11 15:37 UTC and 5,000 before that. v2 has no commission card that reads `joint_cost_history`.
- Review moderation, the review reward, the Users admin item, the header pill rail, and the home carousels stay on v1.

## Phase 9 deploy

Live. Netlify deploy `6af5cfb23098eec353955111` of `overhaul` `e0c5d11`, published 2026-11-12 17:40 EAT. v1 at `/` is unchanged (service worker `venus-pos-v114`). v2 is at `/next/`. Signed-out smoke checks passed.

The first deploy attempt failed while bundling functions: `netlify/functions/_shared/cookie-settle-merge.mjs` imported `../../../js/cookie-partner-batches.js`. That path is `legacy/js/cookie-partner-batches.js` on this branch. `npm test` now runs `scripts/check-functions.mjs`, which bundles every function with esbuild and fails if a relative import does not resolve.

Still waiting on the owner: a signed-in smoke test, the staff message, and at least 3 days of real use. Do not start Phase 10. Do not apply any Supabase migration. Do not merge `overhaul` into `master`.

## How to run tests

```bash
npm ci
npm test
npm run typecheck
npm run build
npx playwright test
```

`npm test` runs Vitest with the domain coverage gate, then `scripts/check-catalog-sync.mjs`, then `scripts/check-functions.mjs`. The default legacy server still serves `legacy/` on port 4173. Set `LEGACY_ROOT` to `dist` to serve the built register. Vite is `http://127.0.0.1:5173`. Use `tests/mock/` only.

## Standing rules

- Do not deploy. No `ship.ps1`, no Netlify. Wait for `push deploy netlify` or `ship`.
- Do not apply any Supabase migration, including `supabase/migrations/20261112030000_sales_client_sale_id.sql`.
- Do not point tests at production Supabase. No real customer PII in fixtures.
- Do not touch or force-push `master`. Do not merge `overhaul` into `master`.
- Push with `git push origin overhaul` (fast-forward only).
- v1 write contracts stay as v1. Odd behaviour goes in `QUIRKS.md`. Do not "fix" it in `legacy/`.
- D11 look is approved (2026-11-12). Phase 4, 5, and 8 checkpoints are waived. Live Maps and deploy/ship stay blocked.
- Currency UGX. Brand: Venus.
