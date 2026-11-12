# Handoff — Venus POS overhaul (for next agent)

**Date:** 2026-11-12  
**Repo:** https://github.com/ofamba404/venus-pos (public)  
**Continue on branch:** `overhaul`  
**Do not deploy.** Owner must say `push deploy netlify` / `ship` before any Netlify deploy.  
**Do not apply** `supabase/migrations/20261112030000_sales_client_sale_id.sql` until the owner approves.

Progress board (local): `docs/overhaul/progress.html` + `progress.json` (serve the folder; was on `http://127.0.0.1:8765/progress.html`). Keep those in sync with `PROGRESS.md`.

---

## What this is

Rebuild of Venus POS v1 → v2 at `/next/` while v1 stays at `/` (strangler). Spec is complete in `docs/overhaul/` — read in order starting at `README.md`, then `PROGRESS.md`, `QUIRKS.md`, `08-decisions.md`, `05-implementation-plan.md`, `07-parity-checklist.md`.

Owner is continuing the same work in another chat (Grok). Pick up from the open items below; do not restart the overhaul.

---

## Git facts (important)

| Fact | Value |
|------|--------|
| Work branch | `overhaul` |
| Baseline tag | `v1-baseline` @ `951a152` |
| Default / production branch | `master` (not `main`) |
| Netlify CD | **off** (`netlify.deploy.json` → `gitContinuousDeployment: false`) |
| Production URL | https://posvenus.netlify.app |

`origin/master` has moved ahead of the point `overhaul` was cut (staff Home / HV polish PRs, ~42 commits). **Do not force-push or replace `master` with `overhaul`.** Reconcile with `origin/master` before any Phase 9 parallel deploy. Until then, all product work stays on `overhaul`.

Local path on the previous machine: `C:\Users\Admin\Desktop\Projects\Venus\venus-pos`.

---

## Owner decisions already answered (2026-11-12)

Recorded in `08-decisions.md`:

| ID | Answer | Shipped? |
|----|--------|----------|
| D1 | **A** — Paid / On credit only | N/A (no change) |
| D2 | **B** — Walk-in chip for paid sales; credit still needs client | Yes |
| D3 | **B** — No WhatsApp receipt | Skipped |
| D4 | **B** — Offline sales outbox | Yes (local). SQL for `client_sale_id` **written, not applied** |
| D5 | **A** — No shift close | Skipped |
| D6 | **A** — Device-only hold/park | Yes |
| D16 | **Yes** — Pending storefront orders claim sellable stock at place | Yes |

Still blocked on owner: **D11 look approval**, live Maps go-ahead for production, **deploy / ship** cues. Do not invent answers.

---

## Where the code stands

### Done enough to use locally

- Phase 1 strangler: `legacy/` + Vite `/next/`
- Phase 2 domain port + dual-run suite
- Phase 4 shell + design system (D11 not signed off)
- Phase 5 Sell / checkout / Orders (Maps place search + fee high-end, store-order load paths)
- Phase 8 locals: walk-in, hold (`src/data/held.ts`), offline outbox (`src/data/outbox.ts`)
- Boot hydrates v1 IDB cache then network (`411cc13` and follow-on WIP)
- Sell route code-split; quiet throttled production median **1963 ms** (cold samples in that five can still exceed 2.0 s)

### Still open (do this next)

1. **Phase 0 exit** — Not closed. Legacy driver only green for S01, S02, S05, S07, S11, S50. S19 legacy double-tap still posts two sales. Full S01–S50 legacy goldens ×3 not done.
2. **Phase 3** — Finish moving every v1 write into `src/data/writes/*` (WIP may include credit/partner/store helpers). Live push subscribe still open. Coverage gates (domain ≥95%, data ≥85%) not proven.
3. **Phase 6** — Stock/auth largely in; live push + PWA install polish still open.
4. **Phase 7** — Pages exist (Clients, History, Insights, Delivery, Reviews, Store). Many `07-parity-checklist.md` rows still unticked.
5. **Perf** — Keep cold sell under 2.0 s on throttled production bundle; median is under, cold outliers are not.
6. **Reconcile `origin/master`** into `overhaul` before any deploy path.
7. **Phases 9–10** — Owner-gated only.

### Tests last known green (before handoff)

- Typecheck clean
- ~117 unit / dual-run
- 54 next Playwright contracts
- axe serious/critical clean on `/sell` and `/system`
- Legacy: S01, S02, S05, S07, S11, S50
- Lint stays **off** CI for now

Run from repo root:

```powershell
npm test
npm run typecheck
npx playwright test
```

Use the in-repo mock (`tests/mock/`). Never point tests at production Supabase. Repo is public — no real customer PII in fixtures.

---

## Hard rules (owner standing)

- Work only in `venus-pos/` for POS. Do not touch `clone/`. Storefront is `venus-store/` (separate).
- Commit with `wip: <what>`. Push only when asked. **Never deploy** without the ship cue.
- v1 write contracts stay identical unless an approved decision says otherwise.
- Quirks: replicate odd v1 behaviour, log in `QUIRKS.md`, ask owner — do not “fix” silently.
- Ship script when eventually allowed: `.\scripts\ship.ps1` from `venus-pos` (bumps SW cache). Not bare `netlify deploy`.
- Currency UGX. Brand: Venus. Register-first IA.

---

## Suggested first hour for the next agent

1. `git checkout overhaul && git pull` (or clone fresh and checkout `overhaul`).
2. Read `PROGRESS.md`, this file, `progress.json`, `08-decisions.md`.
3. `npm ci` / `npm test` + a short contract smoke — confirm the tree is green on this machine.
4. Diff uncommitted intent: write-module extraction under `src/data/writes/`, repository/checkout call sites, progress page sync.
5. Either finish write-module port + tests, or close a Phase 0 legacy golden gap — one slice, then commit + update `PROGRESS.md` / `progress.json`.

---

## Progress UI

| File | Role |
|------|------|
| `docs/overhaul/PROGRESS.md` | Session truth table + log |
| `docs/overhaul/progress.json` | Live board data |
| `docs/overhaul/progress.html` | Auto-refresh board (fetches `progress.json`) |

Update all three when a slice lands.
