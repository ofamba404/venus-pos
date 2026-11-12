# Handoff — Venus POS overhaul

**Date:** 2026-11-12
**Repo:** https://github.com/ofamba404/venus-pos (public)
**Branch:** `overhaul` (fast-forward only)
**Phase:** Phase 1 cleared. Do not start Phase 2 until the owner says to.

## Cleared phases

**Phase 0 — Safety net.** S01–S50 goldens matched three times (150 passed). `npm test` 125 passed. Quirks 1–11. Baselines and `perf.md` are in `docs/overhaul/baseline/`. Commit `8cbdc36`.

**Phase 1 — Restructure and build pipeline.** Exit criteria from `05-implementation-plan.md`:

1. **`dist/` outside `/next/` is byte-identical to v1.** `npm run build` runs `scripts/check-legacy-dist.mjs`. Result: **82 legacy files match `dist/`**, `dist/assets` matches `public/assets`, `dist/next` ignored.
2. **L3 scenarios pass against `dist/` served statically.** `LEGACY_ROOT=dist LEGACY_PORT=4175 npx playwright test tests/e2e/legacy.spec.ts --timeout=30000` → **50 passed** (exit 0, 1.8m). Goldens still match. The server log was `from .../dist`. `GET /next/index.html` on that root is 200. Served `/` and `/sw.js` hash-match `legacy/`.
3. **Optional Netlify draft deploy.** Not run. The plan requires owner approval, and deploy is still blocked. Production check stays in Phase 9.

`ship.ps1` now runs `npm ci` and `npm run build` before a local Netlify deploy, still bumps `CACHE_VERSION` in `legacy/sw.js`, and deploys `dist`. It was not executed. D15 wording is proposed in `08-decisions.md` and not applied. `.cursor/rules/work-on-venus-store.mdc` is not in this repo.

## In progress

Nothing. Phase 1 is closed.

## Next concrete step

Phase 2 task 1 in `05-implementation-plan.md`: `src/domain/catalog.ts` and `scripts/check-catalog-sync.mjs`, with the dual-run test passing. Do not deploy. Do not apply migrations.

## How to run tests

```bash
npm ci
npm test
npm run typecheck
npm run build
npx playwright test tests/e2e/legacy.spec.ts --timeout=30000 --repeat-each=3
LEGACY_ROOT="$PWD/dist" LEGACY_PORT=4175 npx playwright test tests/e2e/legacy.spec.ts --timeout=30000
```

The default legacy server still serves `legacy/` on port 4173. Set `LEGACY_ROOT` to `dist` to serve the built register. Vite is `http://127.0.0.1:5173`. Use `tests/mock/` only.

## Standing rules

- Do not deploy. No `ship.ps1`, no Netlify. Wait for `push deploy netlify` or `ship`.
- Do not apply any Supabase migration, including `supabase/migrations/20261112030000_sales_client_sale_id.sql`.
- Do not point tests at production Supabase. No real customer PII in fixtures.
- Do not touch or force-push `master`. Do not merge `overhaul` into `master`.
- Push with `git push origin overhaul` (fast-forward only).
- v1 write contracts stay as v1. Odd behaviour goes in `QUIRKS.md`. Do not “fix” it in `legacy/`.
- D11 look is approved (2026-11-12). Phase 4, 5, and 8 checkpoints are waived. Live Maps and deploy/ship stay blocked.
- Currency UGX. Brand: Venus.
