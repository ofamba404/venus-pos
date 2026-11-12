# Handoff — Venus POS overhaul

**Date:** 2026-11-12
**Repo:** https://github.com/ofamba404/venus-pos (public)
**Branch:** `overhaul` (fast-forward only)
**Phase in progress:** Phase 0 — Safety net, task 8 (legacy driver). Not cleared. Do not start Phase 1.

## Cleared phases

None. Phase 0 exit criteria are not all met.

## In progress

**Phase 0, task 8 — legacy driver and goldens.**

`tests/e2e/legacy.spec.ts` runs all 50 scenarios through `tests/e2e/drivers/legacy.ts`.

Passed on this machine (one run each, unless noted):

S01–S26, S29–S33, S44, S46, S47, S50.

S19 posts **two** sales (quirk 7) and was checked again after the mock change. S01 was checked again too.

Still failing:

| ID | Why |
|----|-----|
| S27 | Deep link `#load-store-order=` does not open the cart in the driver |
| S28 | Busy 30 min / clear on the admin hours tab |
| S34, S35 | `settleCredit` is not implemented |
| S36, S37 | `editSale` / `voidSale` are not implemented |
| S38 | `partnerSettleBatch` is not implemented |
| S39 | Client rename/delete on `/pages/clients.html` did not finish |
| S40 | `storeUsers` is not implemented |
| S41 | Hours inputs did not finish in 20s |
| S42 | Delivery trip edit did not finish in 20s |
| S43 | `quoteLabPreset` is not implemented |
| S45 | `enableNotifications` is not implemented |
| S48 | Offline charge did not show the offline toast |
| S49 | Sign-out button click is not visible (menu is closed) |

No `tests/e2e/goldens/Sxx.json` legacy files yet. Do not record them until a scenario is stable, then `npx playwright test tests/e2e/legacy.spec.ts -g "S01 " --repeat-each=3`.

## Phase 0 exit — still open

1. **All 50 scenarios × 3 identical goldens.** 35 scenarios pass once. 15 do not. No golden files.
2. **Dual-run snapshots for `06-testing.md` §4.3.** Present, including `tests/dual-run/analytics-chart.test.ts` (Monday bounds, 2,000 runs, heatmap sum). `npm test` must be re-run after this commit; the new file passed on its own (4 tests).
3. **QUIRKS.md.** Quirks 1–8. Quirk 7 is the double-tap. Quirk 8 is no cart undo. Do not fix either in `legacy/`.
4. **Baselines.** Legacy home only, four viewports, plus `docs/overhaul/baseline/perf.md`. Not every legacy screen. `baseline.spec.ts` writes `perf-latest.md` and must not overwrite `perf.md`.

## Next concrete step

Implement `settleCredit` on `/pages/clients.html`, then `editSale` / `voidSale` on history. Re-run `npx playwright test tests/e2e/legacy.spec.ts -g "S34 |S35 |S36 |S37 "`. Leave Phase 1 closed until all 50 pass three times and the goldens match.

## How to run tests

```bash
npm ci
npm test
npm run typecheck
npx playwright test
npx playwright test tests/e2e/legacy.spec.ts
```

Vite is `http://127.0.0.1:5173`. Legacy is `http://127.0.0.1:4173`. Use `tests/mock/` only.

## Standing rules

- Do not deploy. No `ship.ps1`, no Netlify. Wait for `push deploy netlify` or `ship`.
- Do not apply any Supabase migration, including `supabase/migrations/20261112030000_sales_client_sale_id.sql`.
- Do not point tests at production Supabase. No real customer PII in fixtures.
- Do not touch or force-push `master`. Do not merge `overhaul` into `master`.
- Push with `git push origin overhaul` (fast-forward only).
- v1 write contracts stay as v1. Odd behaviour goes in `QUIRKS.md`. Do not “fix” it in `legacy/`.
- D11 look is approved (2026-11-12). Phase 4, 5, and 8 checkpoints are waived. Live Maps and deploy/ship stay blocked.
- Currency UGX. Brand: Venus.
