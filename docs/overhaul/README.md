# Venus POS v2 — Overhaul Spec

This folder is the complete brief for rebuilding Venus POS into a production-grade register. It is written for an implementing model that has **not** seen the planning conversation. Read every file in order before writing code.

| # | File | What it is |
|---|------|------------|
| 0 | `README.md` | This file. Goal, rules of engagement, reading order |
| 1 | `00-analysis.md` | Audit of POS v1: what to keep, what to change, and why |
| 2 | `01-research.md` | POS industry research, open-source references, Her Voice principles worth porting |
| 3 | `02-product-spec.md` | New IA, every screen, every flow, new features, copy rules |
| 4 | `03-design-system.md` | Tokens, type, components, motion. Becomes `DESIGN.md` at repo root |
| 5 | `04-architecture.md` | Stack, folder layout, data layer, service worker, routing, performance budgets |
| 6 | `05-implementation-plan.md` | Phases 0–10 with tasks, exit criteria and owner checkpoints |
| 7 | `06-testing.md` | Regression harness: mock backend, write-contract goldens, dual-run parity, visual, a11y, perf |
| 8 | `07-parity-checklist.md` | Every v1 feature that must still work. Tick each one before cutover |
| 9 | `08-decisions.md` | Questions only the owner can answer, with the default to use until answered |

---

## The goal in one paragraph

Venus POS v1 works, but it was assembled piece by piece. One 10,000-line stylesheet, a 2,500-line checkout module, a home screen that buries selling under analytics and store-hours controls, store orders spread over three different surfaces, and a mandatory client name on every sale. **v2 keeps every business rule and every database write exactly as they are**, and rebuilds everything the staff touches: a register that sells in as few taps as possible, one orders hub, a back office that is organised, and a codebase that is typed, modular, tested and fast. It should be a better app than v1 in its own right, not a reskin.

## What "done" means

1. Every item in `07-parity-checklist.md` is ticked with a passing test or a recorded manual check.
2. Every scenario in `06-testing.md` produces the **same Supabase and Netlify-function writes** in v2 as it did in v1 (the "write contract"). The only allowed differences are listed in `08-decisions.md` and were approved by the owner.
3. Performance budgets in `04-architecture.md §9` are met and measured.
4. Zero serious or critical axe violations on every screen.
5. The owner has reviewed the design (Phase 4), the register (Phase 5), and the parallel run (Phase 9), and said "ship".

---

## Rules of engagement (non-negotiable)

These come from the owner's standing rules. Breaking one is a failed task even if the code works.

### Work and git
- Work in `C:\Users\Admin\Desktop\Projects\Venus\venus-pos` on a branch named `overhaul`. `master` must stay deployable throughout.
- **Commit after every substantive slice** with `wip: <what>` messages. Local commits only; do **not** push unless the owner says "push".
- **Never** run `git checkout HEAD -- <file>`, `git restore` on source, `git reset --hard`, or `git clean -fd` on work you didn't create in the same turn. If you must discard something, `git stash push -m "<why>"` first.
- Never touch `C:\Users\Admin\Desktop\Projects\Venus\clone\`. Storefront code lives in `venus-store/`; read it for reference only. Do not edit it unless a phase says so and the owner approved.

### Deploying
- **Never deploy** (draft, preview or production) without the owner's explicit go-ahead in that conversation. The cue is "push deploy netlify" or "ship".
- Deploy only via `.\scripts\ship.ps1` from `venus-pos/`. After Phase 1 it builds first and guarantees a new service worker cache version every ship.

### Data safety
- POS writes to the **live** Supabase project shared with the storefront (`xiangrykfxlnacthjcad`). There is no staging database.
- **No schema change, RLS change, Edge Function change or Netlify function behaviour change** without owner approval. Approved migrations must be additive (new nullable columns, new tables). Never drop or rename.
- Tests run against the in-repo mock backend only (`tests/mock/`). Never point a test at the real Supabase URL. Never record HAR files from production, and never commit real customer names, phones, or sales. The GitHub repo `ofamba404/venus-pos` is **public**.

### Product truth
- Do not invent prices, products, business rules, or customer-facing copy. Every number comes from v1 code (`js/config.js`, `js/flavored-cookie-pricing.js`, `js/revenue.js`, `js/delivery-fee-model.js`). Anything marked `DRAFT COPY` needs owner approval before cutover.
- The legacy app is the specification of behaviour. When this spec and legacy behaviour disagree on a business rule, **legacy wins** and you note the conflict in `docs/overhaul/QUIRKS.md`.

### Legacy freeze
After Phase 1, legacy code lives in `legacy/` and is frozen. Allowed edits:
1. Adding `export` to an existing function so a test can import it (no logic change).
2. A production bug fix the owner explicitly approves (apply it to legacy and v2 both, with a test).

### When you are unsure
Stop and ask the owner with a short multiple-choice question. Do not guess on money, stock, credit, or anything the customer sees.

---

## Reading order for a fresh session

1. This README.
2. `00-analysis.md` (10 min) so you know why things change.
3. `07-parity-checklist.md` so you know what must survive.
4. The phase you are on in `05-implementation-plan.md`, plus the files it references.
5. `QUIRKS.md` and `PROGRESS.md` (created in Phase 0) to see where the last session stopped.

Keep `docs/overhaul/PROGRESS.md` updated at the end of every session: phase, last commit, what passed, what's next, open questions.
