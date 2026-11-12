# Overhaul progress

Update at the end of every session.

| Field | Value |
|-------|-------|
| Current phase | Phase 0 exit still open. Phase 8 locals (walk-in, hold, offline) are in |
| Branch | `overhaul` · tag `v1-baseline` @ `951a152` |
| Last commit | see `git log -1` |
| Tests passing | typecheck clean · 98 unit/dual-run · 17 Playwright next contract · 3 legacy (S02, S05, S07) |
| Next step | S06, S14–S16, S18, S20–S28, S31–S50. Throttled perf. Lint is not clean, so CI does not run it. No deploy. Do not apply `client_sale_id` |
| Open questions for the owner | D11 look, live Maps, and deploy stay blocked until the owner is back |

## Ready vs open (before a parallel run)

**Ready for you to decide.** `/next` can sell, take credit, set a stock count, and attach a drop-off. Place search talks to Google Maps in the app and to a local Maps stub in tests. A Scout sale writes the sale, then the mint stock delta (`tests/e2e/goldens/S01.next.json`). Fee prediction uses driving distance when Maps answers, and the stored fee is the model’s high end, same as v1.

**Open before staff use v2 beside v1.**

- D1–D6 are answered in `08-decisions.md` (2026-11-12). Walk-in, device hold, and the offline outbox are local. `client_sale_id` is a SQL file only. It is not applied.
- The Playwright next contract that is green is the catalog plus S01–S05, S07–S13, S17, S19, S29, and S30. Legacy on port 4173 is green for S02, S05, and S07. The other scenarios are defined and not in this run yet.
- Phase 9 needs you to say deploy. That is `.\scripts\ship.ps1` from `venus-pos` (v1 stays at `/`, v2 at `/next/`). No test sales on production unless you ask.
- Phase 10 needs you to say ship, after the parallel run. Same script, after the cutover edits. Rollback stays the previous Netlify deploy.

Nothing in this closeout was pushed or deployed.

## D1–D6 — pick one each

Reply with the letter. The marked default is what the app does today.

**D1. Record the payment method on every sale?** (blocks Phase 8)

- A. No. Paid / On credit only. **(default)**
- B. Yes. Cash, MTN MoMo, Airtel Money, credit, or other, plus an optional MoMo/Airtel reference.

**D2. Allow a walk-in sale with no client name when it is paid in full?** (blocks Phase 8)

- A. No. A client name is required. **(default)**
- B. Yes. A Walk-in chip for paid sales. Credit still needs a client.

**D3. WhatsApp receipt button on the success screen and in History?** (Phase 8 copy stays draft until you approve it)

- A. Yes. Behind a flag. The receipt text stays marked DRAFT until you approve it. **(default)**
- B. No receipt button.

**D4. Offline sales queue (sell with no signal, sync when the connection returns)?** (blocks Phase 8)

- A. No. A sale needs signal, same as v1. **(default)**
- B. Yes. Queue the sale on the device and sync later.

**D5. End-of-day / shift close screen?** (depends on D1)

- A. No shift close in v2.0. **(default)**
- B. Yes. Opening float, cash count, and per-method totals. Only if D1 is B.

**D6. Hold / park a counter sale on this device?**

- A. Yes. Saved on the device only. No database change. **(default)**
- B. No hold.

Phase 8 is in progress from the answers in `docs/overhaul/08-decisions.md`. Phases 9 and 10 do not start until you give the deploy cue above.

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
| 2026-11-12 | D16 | Pending storefront orders claim sellable stock at place. Charge consumes the hold. Cancel releases it. 89 unit/dual-run | `c758760` |
| 2026-11-12 | 8 | Walk-in chip on paid sales. Credit still needs a client | `cdc3a18` |
| 2026-11-12 | 8 | Device-only hold | `cebddf6` |
| 2026-11-12 | 8 | Offline sales outbox. `client_sale_id` SQL written, not applied | `0d7f053` |
| 2026-11-12 | 0 | Legacy sale driver (S02, S05, S07). Next contract through S05, S09, S12, S13, S17, S19, S29. Analytics rank dual-run | `754a562` |
| 2026-11-12 | 0 | Playwright CI job, first-viewport baselines, parity ticks for the tests that passed | this commit |
