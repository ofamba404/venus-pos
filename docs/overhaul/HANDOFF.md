# Handoff — Venus POS overhaul

**Date:** 2026-11-12
**Repo:** https://github.com/ofamba404/venus-pos (public)
**Branch:** `overhaul` (push here, fast-forward only)
**Phase in progress:** Phase 0 — Safety net. Not cleared. Do not start Phase 1.

No phase has cleared its exit criteria. Later phases have code on this branch, but `05-implementation-plan.md` says stay here until Phase 0 exits.

## Cleared phases

None. Phase 0 exit is still open (see below).

## In progress

**Phase 0, task 8 — legacy driver and goldens.**

The legacy driver (`tests/e2e/drivers/legacy.ts`) can run: `addProduct`, `setClient`, `setCredit`, `charge`, `doubleTapCharge`, `go`, and expects `saleRecorded`, `noWrites`, `toast`.

Green on that driver (one run in the full Playwright job, except S19 which was re-run three times after the guard was put back):

| Scenario | Result |
|----------|--------|
| S01, S02, S03, S04, S05, S07, S08 | Sale total matches the scenario |
| S11 | Credit sale, `is_credit: true`, total 8000 |
| S19 | **Two** sale POSTs of 8000. Stable across `--repeat-each=3` on 2026-11-12. Quirk 7 |
| S50 | Today revenue, joints, and cookies match `computeTodayStats` on the seed |

No `tests/e2e/goldens/Sxx.json` legacy goldens are committed yet. `S01.next.json` is a v2 sample only. `--repeat-each=3` identical goldens for S01–S50 are not done.

Driver steps still missing: `editLine`, `removeLine`, `undo`, `confirmStackedDebt`, `setDelivery`, `chargeRetry`, `loadStoreOrder`, `confirmStoreOrder`, `cancelStoreOrder`, `dismissStoreOrder`, `parkCounterCart`, `restoreCounterCart`, `setStoreBusy`, `arriveStoreOrder`, `adjustStock`, `setStockCount`, `settleCredit`, `editSale`, `voidSale`, `partnerSettleBatch`, `clientsCrud`, `storeUsers`, `setStoreHours`, `editDeliveryTrip`, `quoteLabPreset`, `refreshReviews`, `enableNotifications`, `signOut`, `signIn`, `goOffline`, and expects `stock`, `display`, `reachable`, `clipboard`, `redirect`.

## Phase 0 exit — what is still open

1. **All 50 scenarios on legacy, three identical goldens.** Not started as files. Only the rows in the table above have been driven.
2. **Dual-run snapshots for every `06-testing.md` §4.3 module.** Present with 2,000 fast-check runs for flavored-bulk, pack-config, catalog, format, revenue, partner, credit, delivery-fee, sale-payload, inventory-delta, store-order-map, history-groups, hours, stock-state. Analytics is only top-product and revenue-delta (`tests/dual-run/analytics-rank.test.ts`), using inlined oracles because `legacy/js/analytics.js` is not a pure import. Period bucketing and heatmap are not snapshotted.
3. **QUIRKS.md.** Quirks 1–7 are logged. S19 is quirk 7. Add a row when a new odd legacy behaviour shows up. Do not fix v1 to make a scenario “nicer”.
4. **Baselines.** Legacy **home** only, four viewports, in `docs/overhaul/baseline/`. Not every legacy screen (`pages/inventory.html`, clients, history, analytics, delivery, reviews, admin, auth). `perf.md` has the kept numbers (dev-server throttled sell 7922 ms; production-bundle quiet median **1963 ms** on samples 3192, 2448, 1963, 1908, 1766). `baseline.spec.ts` now writes `perf-latest.md` so it does not erase `perf.md`.

## Evidence from this machine (2026-11-12)

- `npm test` — 34 files, **118 passed**. Typecheck clean (`tsc --noEmit`).
- `npx playwright test` on `8ed5de7` (before the auth-guard change) — **65 passed, 2 failed, 1 skipped** (13.8 min). Failures are v2, not Phase 0:
  - S32: no `PATCH /rest/v1/inventory` (the 502 injection is not limited to `op: delta`, so boot `ensure` can consume it). A separate test, “inventory 405 falls back to a patch”, passed.
  - S38: clipboard read back empty after partner settle.
- After the guard change: S49, “signed-out /next/sell opens the v2 sign-in”, and “a corrupt session opens v2 sign-in on sell” passed. The full 68 was **not** re-run after that change.
- Legacy S19 ×3 passed with two sale posts.

## Next concrete step

Extend `tests/e2e/drivers/legacy.ts` one scenario at a time, starting with S06, S09, S10, S12, and S13 (still on the sell screen). Record `tests/e2e/goldens/Sxx.json` from the legacy driver. Accept a file only after `npx playwright test tests/e2e/legacy.spec.ts --repeat-each=3` writes the same bytes three times. Then do the missing screenshots and the analytics period/heatmap snapshot. Do not open Phase 1.

## How to run tests

From the repo root (Node 22):

```bash
npm ci
npm test
npm run typecheck
npx playwright test
```

Playwright starts Vite on `http://127.0.0.1:5173` and the legacy server on `http://127.0.0.1:4173`. First time: `npx playwright install chromium`.

Use `tests/mock/` only. Never point tests at production Supabase.

## Commits on this handoff

| Commit | What |
|--------|------|
| `21291d3` | Boot guard sends signed-out `/next` visits to `/next/auth.html` (keeps `next`; corrupt session uses `next=/next/sell`) |
| `cb3129a` | D11 recorded: current look approved. Phase 4, 5, and 8 checkpoints waived |
| see `git log -1` | Quirk 7 restored (legacy double-tap is two sales) and this handoff |

## Standing rules

- Do not deploy. No `ship.ps1`, no Netlify. Wait for `push deploy netlify` or `ship`.
- Do not apply any Supabase migration, including `supabase/migrations/20261112030000_sales_client_sale_id.sql`.
- Do not point tests at production Supabase. The repo is public: no real customer names, phones, or sales in fixtures.
- Do not touch or force-push `master`. Do not merge `overhaul` into `master`.
- Push this branch fast-forward only: `git push origin overhaul`.
- v1 write contracts stay identical unless an approved decision says otherwise.
- Odd v1 behaviour: replicate it, log `QUIRKS.md`, ask the owner. Do not fix it in `legacy/`.
- Currency UGX. Brand: Venus. Register-first.
- D11 is approved (2026-11-12). Live Maps for production is still blocked. Phases 9 and 10 stay blocked on deploy/ship.
- `client_sale_id` SQL is a file only. It is not applied.
