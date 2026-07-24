# SafeBoda fee-model QA (POS only)

All delivery-fee calibration and scoring lives here. **venus-store only consumes the refined model** — do not add quote logs, fixtures, or QA scripts in the store.

## Workflow

1. Log quotes in POS **Delivery → Quote lab** (same pickup: Prisca Honey / Nkinzi Rd).
2. Export a golden snapshot: `npm run qa:export`
3. Score coverage + model error: `npm run qa:score`
4. Fill the **next recommended** cell (period × drop-off) until strong target (80) / stretch (120).

## Commands

```bash
# From venus-pos/
npm run qa:export              # → qa/snapshots/YYYY-MM-DD-deliveries.json
npm run qa:score               # live fetch (or latest snapshot)
npm run qa:score -- path/to/snapshot.json
```

Env overrides (optional): `SUPABASE_URL`, `SUPABASE_ANON_KEY`. Defaults come from `js/config.js`.

## Layout

| Path | Purpose |
|------|---------|
| `fixtures/routes.json` | Eval mirror of presets + `FIT_TARGET` + spot checks |
| `snapshots/*.json` | Dated `deliveries` exports for offline / regression scoring |
| `js/delivery-test-routes.js` | Runtime Quote Lab source of truth |
| `js/delivery-fee-model.js` | Production fit/predict (score CLI imports this) |

## Targets

- **80** quotes strong · **120** stretch
- **20**/period · each preset × period at least **2×**
- Band floors: short 16 / mid 28 / long 28

Quotes stay in Supabase `deliveries` (`client_name = 'SafeBoda test'` for lab rows). Snapshots are exports for scoring — not a second logging UI.
