# Handoff — Venus POS overhaul

**Date:** 2026-11-12
**Repo:** https://github.com/ofamba404/venus-pos (public)
**Branch:** `overhaul` (fast-forward only)
**Phase:** Phase 2 cleared. Next is Phase 3. Do not deploy. Do not apply migrations.

## Cleared phases

**Phase 0 — Safety net.** S01–S50 goldens matched three times (150 passed). `npm test` 125 passed at that commit. Quirks 1–11. Baselines and `perf.md` are in `docs/overhaul/baseline/`. Commit `8cbdc36`.

**Phase 1 — Restructure and build pipeline.** `npm run build` hash check: **82 legacy files match `dist/`**. S01–S50 against `dist/`: **50 passed**. Draft deploy not run. Commit `2eae8a0`.

**Phase 2 — Domain port.** Exit criteria from `05-implementation-plan.md`:

1. **Every dual-run passes with 2,000 runs.** Catalog, format, flavored bulk, pack config, cart totals, inventory delta, sale payload, store-order map, stock state, hours, hours dial, credit, revenue, partner (including clipboard text), delivery fee rounding and quote/fit, history groups, analytics rank, and analytics period/heatmap. `npm test`: **147 passed**.
2. **Domain coverage ≥ 95%.** v8 on `src/domain/**`: **lines 99.43% (2821/2837), branches 95.36% (1544/1619), functions 100% (202/202)**. `vitest.config.ts` fails the run under those thresholds.
3. **No imports outside `domain/`.** `tests/unit/domain-imports.test.ts` walks `src/domain` and rejects any specifier that is not a relative import inside that folder.
4. **`check-catalog-sync` passes.** `node --experimental-strip-types scripts/check-catalog-sync.mjs`: inventory `CATEGORY_META` matches `catalog.ts` (**14 ids**). `../venus-store` is absent, so storefront price/pack/id checks are skipped with a warning. Wired into `npm test` as `catalog:check`.

`npm run typecheck` passed. `npx playwright test`: **109 passed, 2 skipped, 0 failed** (15.3m). Chart aggregations live in `src/domain/analytics/periods.ts` and `patterns.ts` and dual-run against `legacy/js/analytics-chart.js`. Partner batch lines and clipboard text dual-run against `legacy/js/revenue.js`.

## Baseline repairs before Phase 2

The suite was not green on a fresh `npm test` / `npx playwright test`:

- `tests/dual-run/hours-dial.test.ts` failed in UTC. v1 rolls a chosen clock forward by at most one day, so 12:00 am during the last 30 seconds of the day can land inside the 30-second window. The property now matches that. Quirk 12.
- Full Playwright first run: **106 passed, 3 failed, 2 skipped**. S32's 502 was sometimes consumed by inventory `ensure`, and the fallback PATCH could finish before a second waiter. The driver now fails only `op: "delta"` and waits for that PATCH or a successful delta. S38 read the clipboard before `writeText` resolved; it now waits for the settled toast. S48's offline mock returns HTTP 503, which was not queued; `shouldQueueSale` now queues 502/503/504 and still does not queue a 500 (S18).

## In progress

Nothing. Phase 2 is closed.

## Next concrete step

Phase 3 task 1 in `05-implementation-plan.md`: `src/data/keys.ts`, `src/data/api.ts`, `src/data/auth.ts`, and the inline pre-paint gate. Exit bar is L1 coverage ≥ 85% on `data/`, a v1 IDB hydrate, a v1 session cart, and a v1 `venus-pos-auth` session accepted by v2. Do not deploy. Do not apply migrations.

## How to run tests

```bash
npm ci
npm test
npm run typecheck
npm run build
npx playwright test
```

`npm test` runs Vitest with the domain coverage gate, then `scripts/check-catalog-sync.mjs`. The default legacy server still serves `legacy/` on port 4173. Set `LEGACY_ROOT` to `dist` to serve the built register. Vite is `http://127.0.0.1:5173`. Use `tests/mock/` only.

## Standing rules

- Do not deploy. No `ship.ps1`, no Netlify. Wait for `push deploy netlify` or `ship`.
- Do not apply any Supabase migration, including `supabase/migrations/20261112030000_sales_client_sale_id.sql`.
- Do not point tests at production Supabase. No real customer PII in fixtures.
- Do not touch or force-push `master`. Do not merge `overhaul` into `master`.
- Push with `git push origin overhaul` (fast-forward only).
- v1 write contracts stay as v1. Odd behaviour goes in `QUIRKS.md`. Do not "fix" it in `legacy/`.
- D11 look is approved (2026-11-12). Phase 4, 5, and 8 checkpoints are waived. Live Maps and deploy/ship stay blocked.
- Currency UGX. Brand: Venus.
