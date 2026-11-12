# Overhaul progress

Update at the end of every session. Phase 0 is cleared. Do not start Phase 1 until the owner says so.

| Field | Value |
|-------|-------|
| Current phase | Phase 0 cleared. Phase 1 not started |
| Branch | `overhaul` · tag `v1-baseline` @ `951a152` |
| Last commit | see `git log -1` |
| Tests passing | `npm test`: 36 files, 125 passed. Legacy S01–S50 ×3: 150 passed, goldens identical. S19 is two sales |
| Next step | Phase 1 when the owner says so. See `HANDOFF.md` |
| Open questions for the owner | Live Maps for production, and deploy/ship. D11 look is approved (2026-11-12). Checkpoints for Phases 4, 5, and 8 are waived. Do not apply `client_sale_id` |

## Ready vs open

**Phase 0 is cleared.** Legacy goldens S01–S50 matched three times. Dual-run snapshots cover `06-testing.md` §4.3. Quirks 1–11 are logged. Legacy screenshots exist for every screen at four viewports, and `baseline/perf.md` has the v1 numbers. Phase 1 has not been started.

**Owner decisions.** D1 A, D2 B, D3 B, D4 B, D5 A, D6 A, D16 improve, D11 approved. Details in `08-decisions.md`.

## Log

| Date | Phase | Summary | Commit |
|------|-------|---------|--------|
| 2026-11-11 | — | Spec written | `951a152` |
| 2026-11-12 | 0 | Tooling + format/catalog/bulk dual-run | `c0ee96c` |
| 2026-11-12 | 0 | Mock PostgREST + fixtures + stock-state | `6f703ae` |
| 2026-11-12 | 0/1/2 | Vite/Preact placeholder + credit dual-run | `cbf8ed8` |
| 2026-11-12 | 4–7 | Checkoutable `/next` shell + Sell/Orders/Stock/back office | `387c0fd` |
| 2026-11-12 | UI | Icon/stepper/list quirks pass | `2e62867` |
| 2026-11-12 | 0/6/7 | S01–S50 defs · Today · fee draft · set-count · settle · SW unit | `e0b916e` |
| 2026-11-12 | 0/6/7 | Playwright next driver S01/S02/S07/S30 · fee model port · quote lab · partner UI | `588f3fe` |
| 2026-11-12 | closeout | Maps place search + delivery quote · contract S01–S04, S07–S08, S10–S11, S30 · D1–D6 gate | `9693b36` |
| 2026-11-12 | — | Owner answers D1 A, D2 B, D3 B, D4 B, D5 A, D6 A | `52f0d15` |
| 2026-11-12 | D16 | Pending storefront orders claim sellable stock at place | `c758760` |
| 2026-11-12 | 8 | Walk-in chip on paid sales | `cdc3a18` |
| 2026-11-12 | 8 | Device-only hold | `cebddf6` |
| 2026-11-12 | 8 | Offline sales outbox. `client_sale_id` SQL written, not applied | `0d7f053` |
| 2026-11-12 | 0 | Legacy sale driver (S02, S05, S07) | `754a562` |
| 2026-11-12 | 0 | Playwright CI job, first-viewport baselines | `142182b` |
| 2026-11-12 | 0 | Delivery, line edit, store-order load, credit settle | `50b2595` |
| 2026-11-12 | 0 | Live-order poll, stock, clients, store users, offline queue | `e4b6325` |
| 2026-11-12 | 0 | History edit/void, trip edit, sign-in | `1c5713c` |
| 2026-11-12 | 0 | 405 wait, IDB hydrate, quiet median 2046 ms | `3a28513` |
| 2026-11-12 | 3 | Boot hydrates the v1 IDB cache. Sell route split. Quiet median 1963 ms | `411cc13` |
| 2026-11-12 | — | Handoff at `8ed5de7`. Writes WIP. Full Playwright later: 65 pass, S32 and S38 fail | `8ed5de7` |
| 2026-11-12 | — | Signed-out `/next` goes to `/next/auth.html` | `21291d3` |
| 2026-11-12 | — | D11 look approved. Phase 4/5/8 checkpoints waived | `cb3129a` |
| 2026-11-12 | 0 | Quirk 7: legacy double-tap posts two sales (×3). Handoff rewritten. Phase 0 still open | `ee6bd31` |
| 2026-11-12 | 0 | Legacy driver covers 35 of 50 scenarios once. Mock POST returns an array. Analytics chart snapshot. Phase 0 still open | `f62f24e` |
| 2026-11-12 | 0 | Phase 0 cleared. S01–S50 goldens ×3 (150 passed). Remaining legacy screenshots. Hours-dial snapshot | this commit |
