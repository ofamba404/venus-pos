# Handoff — Venus POS overhaul

**Date:** 2026-11-12
**Repo:** https://github.com/ofamba404/venus-pos (public)
**Branch:** `overhaul` (fast-forward only)
**Phase:** Phase 0 cleared. Do not start Phase 1 until the owner says to.

## Cleared phases

**Phase 0 — Safety net.** Exit criteria from `05-implementation-plan.md`:

1. **S01–S50 vs legacy, three times, identical goldens.** `npx playwright test tests/e2e/legacy.spec.ts --timeout=30000 --repeat-each=3` → **150 passed** (exit 0, 5.2m). Goldens are `tests/e2e/goldens/S01.json`–`S50.json`. S19 contains two `POST /rest/v1/sales` (quirk 7). Boot `ensure` and `admin_list_*` reads are omitted (quirk 10).
2. **Dual-run legacy snapshots for `06-testing.md` §4.3.** `npm test` → **36 files, 125 passed**. Includes `tests/dual-run/analytics-chart.test.ts` (Monday bounds, heatmap, 2,000 runs) and `tests/dual-run/hours-dial.test.ts` (dial clock, 2,000 runs).
3. **QUIRKS.md.** Rows 1–11. Do not “fix” 7, 8, 10, or 11 in `legacy/`.
4. **Baselines.** Legacy home, inventory, clients, history, analytics, delivery, reviews, admin, and auth at 360×740, 390×844, 768×1024, and 1280×800 in `docs/overhaul/baseline/`. Perf numbers are already in `docs/overhaul/baseline/perf.md` (quiet production median 1963 ms). `baseline.spec.ts` writes `perf-latest.md` and must not overwrite `perf.md`.

## In progress

Nothing. Phase 0 is closed.

## Next concrete step

Phase 1 task 1 in `05-implementation-plan.md`: confirm the v1 files already under `legacy/`, then the byte-identical `dist/` check. Do not deploy. Do not apply migrations.

## How to run tests

```bash
npm ci
npm test
npm run typecheck
npx playwright test tests/e2e/legacy.spec.ts --timeout=30000 --repeat-each=3
```

`RECORD=1` rewrites `tests/e2e/goldens/Sxx.json`. `CAPTURE=1` refreshes the legacy screen shots. Vite is `http://127.0.0.1:5173`. Legacy is `http://127.0.0.1:4173`. Use `tests/mock/` only.

## Standing rules

- Do not deploy. No `ship.ps1`, no Netlify. Wait for `push deploy netlify` or `ship`.
- Do not apply any Supabase migration, including `supabase/migrations/20261112030000_sales_client_sale_id.sql`.
- Do not point tests at production Supabase. No real customer PII in fixtures.
- Do not touch or force-push `master`. Do not merge `overhaul` into `master`.
- Push with `git push origin overhaul` (fast-forward only).
- v1 write contracts stay as v1. Odd behaviour goes in `QUIRKS.md`. Do not “fix” it in `legacy/`.
- D11 look is approved (2026-11-12). Phase 4, 5, and 8 checkpoints are waived. Live Maps and deploy/ship stay blocked.
- Currency UGX. Brand: Venus.
