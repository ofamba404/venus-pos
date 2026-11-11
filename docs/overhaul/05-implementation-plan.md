# 05 — Implementation plan

Eleven phases. Each one ends in a working, committed state. Never start a phase until the previous phase's exit criteria pass. **Owner checkpoints** (🛑) mean: stop, show the owner the listed evidence, and wait for a reply.

Estimated effort assumes one implementing agent working in focused sessions.

| Phase | Name | Output | Effort |
|------:|------|--------|-------:|
| 0 | Safety net | Test harness, goldens from v1, baselines | 3–4 days |
| 1 | Restructure and build | Vite project; v1 served unchanged from `legacy/`; `/next/` placeholder | 1 day |
| 2 | Domain port | `src/domain/*` with dual-run parity | 3–4 days |
| 3 | Data, auth, realtime | `src/data/*` | 2–3 days |
| 4 | Design system and shell | Tokens, fonts, UI kit, `/system`, App shell | 3–4 days 🛑 |
| 5 | Sell, checkout, Orders | The register | 5–6 days 🛑 |
| 6 | Stock, Settings, Auth, PWA | Staff surface complete | 2–3 days |
| 7 | Back office | Insights, Clients, History, Delivery, Reviews, Store, Debug | 5–7 days |
| 8 | Approved improvements | Features from decisions D1–D6 that the owner approved | 2–4 days 🛑 |
| 9 | Parallel run | v2 live at `/next/` alongside v1 | 3–7 days 🛑 |
| 10 | Cutover | v2 at `/`, legacy out of the build | 1 day 🛑 |

---

## How to port any v1 module (follow this every time)

1. Read the whole legacy file and every file it imports that holds logic. Note every function, constant, storage key, event and request.
2. Write the v2 **domain** function(s) first: pure, typed, no DOM. Name them after the legacy ones.
3. Write the dual-run test (`06-testing.md §4.3`). Make it pass with 2,000 fast-check runs.
4. Write the v2 **data/write** wrapper for any requests; confirm against a recorded golden.
5. Build the **UI** with design-system components only. No new CSS colours, radii, shadows or font sizes.
6. Run the scenario(s) for that feature with the next driver until the write contract matches.
7. Tick the rows in `07-parity-checklist.md`, commit (`wip: port <feature>`), update `PROGRESS.md`.

If a legacy behaviour looks like a bug: **replicate it**, log it in `QUIRKS.md` with file:line, and ask the owner at the next checkpoint.

---

## Phase 0 — Safety net (no product code changes)

**Goal:** be able to prove, automatically, what v1 does.

Tasks:
1. `git checkout -b overhaul` from `master`. Tag `master` HEAD as `v1-baseline`.
2. Start using `docs/overhaul/PROGRESS.md` and `docs/overhaul/QUIRKS.md` (stubs exist).
3. Add dev tooling to `package.json` (keep existing deps and scripts): `typescript`, `vitest`, `jsdom`, `fast-check`, `@playwright/test`, `@axe-core/playwright`, `eslint` + `typescript-eslint`, `prettier`, `stylelint` + `stylelint-config-standard`, `serve` (or `http-server`) for serving legacy statically. Pin exact versions. Commit.
4. Write `tests/mock/QUERIES.md`: every request shape v1 makes (grep `sbFetch(`, `fetch(`, `functionFetch`, `store-auth`, `importLibrary`, `Geocoder`). Then build the mock backend (`06-testing.md §2`). Commit.
5. Build the fixtures (`§3`). Commit.
6. Add test-only `export`s to legacy files (`§4.1`). Commit separately.
7. Write dual-run harness and **legacy-only** characterisation snapshots for every module in `§4.3` (v2 side comes in Phase 2). Commit.
8. Write the scenario definitions S01–S50 and the **legacy driver**. Serve v1 from the repo root with a static server on `http://localhost:4173`. Record goldens with `--repeat-each=3`. Commit goldens.
9. Capture legacy screenshots for every screen at the four viewports into `docs/overhaul/baseline/` (use the mock backend). Commit.
10. Measure v1 performance (`§9`) into `docs/overhaul/baseline/perf.md`. Commit.
11. Add `.github/workflows/ci.yml` running what exists so far (lint off for legacy; tests on). Commit. Do not push without the owner's go-ahead.

**Exit criteria:**
- All 50 scenarios pass against legacy three times in a row with identical goldens.
- Dual-run legacy snapshots exist for every module in `§4.3`.
- `QUIRKS.md` lists everything odd found so far.
- Baseline screenshots and perf numbers are committed.

---

## Phase 1 — Restructure and build pipeline (production behaviour identical)

Tasks:
1. `git mv` v1 runtime files into `legacy/` (`04-architecture.md §6`). Move `assets/` to `public/assets/`. Update the legacy static server in tests to serve `dist/` after build.
2. Scaffold Vite + Preact + TS: `vite.config.ts` (`base: '/next/'`, MPA inputs `index.html`, `auth.html`, `preact/compat` alias, `define: { __BUILD_ID__ }`), `tsconfig.json` (strict), `src/main.tsx` that renders "Venus POS v2 — in progress" for admins only.
3. `scripts/copy-legacy.mjs`: copy `legacy/*` → `dist/` root, and `public/assets` → `dist/assets` (shared by both).
4. `netlify.toml`: `command = "npm run build"`, `publish = "dist"`; keep functions config and every header; add `/next/*  /next/index.html  200`.
5. Update `scripts/ship.ps1`: `npm ci` + `npm run build` before deploy; bump `CACHE_VERSION` in `legacy/sw.js`; deploy `dist`. Update `netlify.deploy.json` `publishDir`.
6. Update the workspace rule `.cursor/rules/work-on-venus-store.mdc` text about ship.ps1 only after the owner approves (show the proposed wording).
7. ESLint/Stylelint/Prettier configs for `src/` (legacy excluded).

**Exit criteria:**
- `npm run build` produces `dist/` where everything outside `/next/` is byte-identical to v1 (write a check script that compares file hashes of `legacy/` vs `dist/` minus `next/`).
- All L3 scenarios pass with the legacy driver against `dist/` served statically.
- 🛑 *Optional, owner approval required:* a Netlify **draft** deploy to confirm functions still route (`/api/inventory/write` ensure returns rows) and `/next/` serves. If the owner declines, proceed; the production check happens in Phase 9.

---

## Phase 2 — Domain port

Order (each with its dual-run test passing before moving on):
1. `catalog.ts` + `scripts/check-catalog-sync.mjs`.
2. `format.ts`.
3. `pricing/flavored-bulk.ts`.
4. `pricing/pack-config.ts`.
5. `cart.ts` (v2 reducer; L1 only) and `inventory-delta.ts`.
6. `sale-payload.ts`.
7. `store-order-map.ts`.
8. `stock-state.ts`, `hours.ts`.
9. `credit.ts`, `revenue.ts`, `partner.ts`.
10. `delivery-fee.ts`.
11. `history-groups.ts`, `analytics/*`.
12. `luminance.ts`.

**Exit criteria:** every dual-run test passes with 2,000 runs; domain coverage ≥ 95 %; no imports outside `domain/`; `check-catalog-sync` passes.

---

## Phase 3 — Data, auth, realtime

1. `data/keys.ts` (every storage key), `data/api.ts`, `data/auth.ts` (+ inline pre-paint gate script for `index.html`).
2. `data/idb.ts` (v1-compatible `cache`; new `held` store via version bump).
3. `data/entities.ts`, `data/repository.ts`, `data/prefetch.ts`.
4. `data/writes/*` (one per table/endpoint).
5. `data/session-cart.ts` (v1 keys and shape; test by loading a v1-written cart fixture).
6. `data/realtime.ts` feeds (store orders, reviews, inventory read-only).
7. `data/checkout.ts` with injected dependencies; L1 tests for success, failure rollback, double submit, async failures.

**Exit criteria:** L1 coverage ≥ 85 % on `data/`; a test seeds IDB with v1-format entries and v2 hydrates them; a test loads a v1 session cart and v2 reads it identically; a v1 `venus-pos-auth` session is accepted by v2.

---

## Phase 4 — Design system and shell 🛑

1. Copy `03-design-system.md §1–9` to `DESIGN.md`.
2. `styles/layers.css` (`@layer reset, tokens, base, components, features, utilities`), `tokens.css`, `fonts.css` (self-hosted, preload Geograph 400 + Akkurat Mono), `base.css`.
3. Icons (`ui/icons.tsx`) per `03 §5`.
4. Every component in `03 §4`, each with its CSS file and a `/system` gallery section showing every variant and state.
5. Router (`app/router.ts`, `routes.ts`), keep-alive view host, history-backed `SheetHost`, `DialogHost`, `ToastHost`.
6. Shell: `TopBar`, `NavBar`, `Rail`, role-filtered nav, Account menu, Sync chip. Placeholder screens for every route (title + "Coming in Phase N").
7. L5 baselines for `/system` and the shell; L6 axe on `/system`.

**🛑 Owner checkpoint:** send screenshots of `/system` (phone and desktop) and the empty shell at 360 × 740 and 1280 × 800. Ask specifically about: the ink/paper palette, the flavour-colour idea, fonts, tile and button shapes, nav. Apply feedback, update `DESIGN.md`, re-baseline.

**Exit criteria:** owner approved the look; size budget met for shell; axe clean.

---

## Phase 5 — Sell, checkout, Orders 🛑

1. Sell screen: tiles, groups, flavour strips, stock badges, Today pill + sheet.
2. Config sheet for every product rule (including quick paths).
3. Cart (sheet on phone, pane on wide): lines, edit, remove + undo, customer with recent chips and create, fulfillment with delivery mini-form (lazy Maps), payment segment (v1 Paid/On credit), totals, Charge with disabled reasons.
4. Checkout pipeline wired to `data/checkout.ts`; processing state; success state with the signature motion; New sale.
5. Store-order cart tabs, compose parking, confirm-for-customer, copy chips, cancelled banner.
6. Orders hub: store status card (busy controls + undo), segments, cards, load/confirm/cancel/release/dismiss, live indicator, empty state.
7. Legacy hash/deep-link handlers.
8. Next driver for S01–S28, S46, S48, S50 (Sell/Orders parts).

**Exit criteria:** S01–S28 write contracts match; L4 tests for Sell and Orders pass; tap and render budgets met; tap counts measured and recorded in `PROGRESS.md` (target: single-pack paid sale for a recent client ≤ 6 taps).

**🛑 Owner checkpoint:** a short screen recording (Playwright video) at 390 × 844 of: a Cookie Duet sale, a credit sale with stacked debt, a delivery sale, a store order from arrival to checkout. Plus screenshots at 1280 × 800. Ask for feedback on speed and clarity.

---

## Phase 6 — Stock, Settings, Auth, PWA

1. Stock: summary, grid, steppers, Set count and Adjust keypads, queue + fallback writes, stock notifications, realtime read.
2. Settings: notifications (prefs + push subscribe), install sheet (iOS steps), app version/update, account/sign out, haptics toggle.
3. More screen.
4. Auth entry (`auth.html` + `auth-main.tsx`).
5. SW source `sw/sw.ts` built to `/next/sw.js` but **not registered** under `/next/`; unit-test its routing logic by importing the handler functions.
6. Next driver for S29–S33, S45, S46, S48, S49.

**Exit criteria:** those scenarios match; staff surface fully usable at `/next/` with the mock backend.

---

## Phase 7 — Back office

Port in this order, each as its own commit: Clients & credit (with settle), History (with filters and sale detail, edit, void), Insights (all sections incl. cookie partner), Delivery (log, model, quote lab), Reviews (+ unread), Store (users, hours, tools), Debug.

**Exit criteria:** S34–S44, S47, S50 match; L5 baselines; axe clean; every `07-parity-checklist.md` row except D-gated ones ticked.

---

## Phase 8 — Approved improvements 🛑

Only the decisions the owner approved in `08-decisions.md`. For each:
1. If it needs a migration: write additive SQL in `supabase/migrations/<timestamp>_<name>.sql`, show it to the owner, and **apply only after explicit approval** (via the Supabase MCP `apply_migration` or the dashboard, as the owner prefers).
2. Feature-flag it in `src/env.ts` (`features.paymentMethod` etc.).
3. New scenarios + `Sxx.next.json` goldens with `approvedChange` notes.
4. Update copy (marked DRAFT until approved).

**🛑 Owner checkpoint:** demo of each improvement; approve copy.

---

## Phase 9 — Parallel run 🛑

1. 🛑 Ask the owner for permission to deploy with `.\scripts\ship.ps1` (v1 stays at `/`, v2 at `/next/`).
2. Smoke test on production: sign in at `/next/`, view Sell, open Orders, open Stock. **No test sales on production unless the owner asks**; real sales by staff are the test.
3. Give the owner a short instruction message for staff (link, what's different, how to report problems, "don't keep v1 and v2 open with a cart at the same time").
4. Run L8 manual QA (`06-testing.md §10`). Log in `PARALLEL-RUN.md`. Fix issues (P0 within the day), ship fixes only with permission.

**Exit criteria:** ≥ 3 days of real use, no open P0/P1, owner says "ready to switch".

---

## Phase 10 — Cutover 🛑

1. Switch Vite `base` to `/`, register the new SW at `/sw.js`, remove `copy-legacy.mjs` from the build, add the redirects (`04-architecture.md §6`), keep `manifest` `id: "/"`.
2. Full `npm run check`.
3. 🛑 Owner says "ship" → `.\scripts\ship.ps1`.
4. Verify on production within 10 minutes: `/build.txt` shows the new build; a staff phone updates (SW activates when the cart is empty); a storefront test order push arrives and loads; `/pages/inventory.html` redirects.
5. Rollback plan ready: Netlify UI → Deploys → previous v1 deploy → "Publish deploy".
6. After 14 days without rollback: delete `legacy/` and its test driver in a commit, tag `legacy-final`, and remove legacy-only goldens (keep next goldens).

---

## Session discipline

- Start: read `PROGRESS.md`, `QUIRKS.md`, and the current phase section.
- Work in slices of at most a few hours; commit each.
- End: update `PROGRESS.md` (phase, last commit hash, passing/failing tests, next step, open questions for the owner).
- Never leave the branch with failing L3 tests for a phase you have already exited.
