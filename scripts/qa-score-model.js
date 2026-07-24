/**
 * Score live delivery-fee model against deliveries + FIT_TARGET coverage.
 * Usage:
 *   npm run qa:score
 *   npm run qa:score -- qa/snapshots/2026-07-24-deliveries.json
 *
 * Loads production js/delivery-fee-model.js (not a forked copy).
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { SUPABASE_URL, SUPABASE_ANON_JWT, SUPABASE_KEY } from '../js/config.js';
import {
  fitDeliveryFeeModel,
  predictSafeBodaFee,
  periodForDate,
  modelConfidence,
  PERIODS,
  MIN_FARE_UGX,
} from '../js/delivery-fee-model.js';

// delivery-test-routes.js calls getPageHref at load (needs location)
globalThis.location = globalThis.location || { pathname: '/pages/delivery.html' };

const { analyzeCoverage, FIT_TARGET, TEST_DROPOFFS } = await import(
  '../js/delivery-test-routes.js'
);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const posRoot = path.resolve(__dirname, '..');
const fixturesPath = path.join(posRoot, 'qa', 'fixtures', 'routes.json');
const snapshotsDir = path.join(posRoot, 'qa', 'snapshots');

const PERIOD_ORDER = ['morning_peak', 'day', 'evening_peak', 'night'];

function loadFixtures() {
  return JSON.parse(fs.readFileSync(fixturesPath, 'utf8'));
}

function unwrapRows(data) {
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.rows)) return data.rows;
  throw new Error('Snapshot must be an array or { rows: [...] }');
}

async function fetchDeliveries() {
  const url = process.env.SUPABASE_URL || SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY || SUPABASE_ANON_JWT || SUPABASE_KEY;
  if (!url || !key) return null;
  const endpoint = new URL(
    'deliveries?select=*&order=created_at.desc&limit=500',
    url.replace(/\/?$/, '/') + 'rest/v1/'
  );
  const res = await fetch(endpoint, {
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
    },
  });
  if (!res.ok) {
    throw new Error(`Supabase ${res.status}: ${await res.text()}`);
  }
  return res.json();
}

function latestSnapshotPath() {
  if (!fs.existsSync(snapshotsDir)) return null;
  const files = fs
    .readdirSync(snapshotsDir)
    .filter((f) => f.endsWith('-deliveries.json'))
    .sort();
  if (!files.length) return null;
  return path.join(snapshotsDir, files[files.length - 1]);
}

async function loadRows(argvPath) {
  if (argvPath) {
    const abs = path.isAbsolute(argvPath) ? argvPath : path.resolve(process.cwd(), argvPath);
    console.log(`Source: snapshot ${abs}`);
    return unwrapRows(JSON.parse(fs.readFileSync(abs, 'utf8')));
  }
  try {
    const live = await fetchDeliveries();
    if (live) {
      console.log(`Source: live Supabase (${live.length} rows)`);
      return live;
    }
  } catch (e) {
    console.warn(`Live fetch failed: ${e.message}`);
  }
  const snap = latestSnapshotPath();
  if (snap) {
    console.log(`Source: latest snapshot ${path.relative(posRoot, snap)}`);
    return unwrapRows(JSON.parse(fs.readFileSync(snap, 'utf8')));
  }
  throw new Error(
    'No data. Pass a snapshot path, run npm run qa:export, or set SUPABASE_URL + SUPABASE_ANON_KEY.'
  );
}

function pad(s, n) {
  return String(s).padEnd(n);
}
function padL(s, n) {
  return String(s).padStart(n);
}

function scoreInSample(rows, model) {
  let n = 0;
  let absErr = 0;
  let within500 = 0;
  for (const d of rows) {
    const km = Number(d.distance_km);
    const fee = Number(d.fee_ugx);
    if (Number.isNaN(km) || Number.isNaN(fee) || km < 0) continue;
    const mins = d.duration_min != null ? Number(d.duration_min) : null;
    const at = d.created_at ? new Date(d.created_at) : null;
    const period = at && !Number.isNaN(at.getTime()) ? periodForDate(at) : 'day';
    const pred = predictSafeBodaFee(km, model, {
      durationMin: mins != null && !Number.isNaN(mins) && mins > 0 ? mins : null,
      period,
    });
    if (pred == null) continue;
    n += 1;
    const err = Math.abs(pred - fee);
    absErr += err;
    if (err <= 500) within500 += 1;
  }
  return {
    n,
    mae: n ? Math.round(absErr / n) : null,
    within500Pct: n ? Math.round((within500 / n) * 100) : null,
  };
}

function printCoverage(coverage) {
  console.log('\n=== Coverage vs FIT_TARGET ===');
  console.log(
    `Quotes: ${coverage.total} (lab ${coverage.testCount} · real ${coverage.realCount}) · strong ${FIT_TARGET.totalStrong} · stretch ${FIT_TARGET.totalNearPerfect}`
  );
  console.log(
    `Progress: ${Math.round(coverage.progressStrong * 100)}% strong · ${Math.round(coverage.progressNearPerfect * 100)}% stretch · still need ${coverage.logsStillNeeded}`
  );
  console.log(
    `Cells ≥${FIT_TARGET.minPerCell}: ${coverage.cellsFilled}/${coverage.cellsTotal} · periods met ${coverage.periodsMet}/4`
  );

  console.log('\nBy period:');
  for (const id of PERIOD_ORDER) {
    const meta = PERIODS[id];
    const count = coverage.byPeriod[id] || 0;
    const need = Math.max(0, FIT_TARGET.perPeriod - count);
    console.log(
      `  ${pad(meta.label, 14)} ${padL(count, 3)}/${FIT_TARGET.perPeriod}${need ? `  (need ${need})` : '  ok'}`
    );
  }

  console.log('\nBy band:');
  for (const band of ['short', 'mid', 'long']) {
    const count = coverage.byBand[band] || 0;
    const floor = FIT_TARGET.perBand[band];
    const ok = count >= floor ? 'ok' : `need ${floor - count}`;
    console.log(`  ${pad(band, 6)} ${padL(count, 3)}/${floor}  ${ok}`);
  }

  console.log('\nMatrix (preset × period counts):');
  const header = pad('drop-off', 28) + PERIOD_ORDER.map((p) => padL(PERIODS[p].short, 8)).join('');
  console.log(header);
  for (const drop of TEST_DROPOFFS) {
    const cells = PERIOD_ORDER.map((p) => {
      const n = coverage.matrix[p]?.[drop.id] || 0;
      const mark = n < FIT_TARGET.minPerCell ? `${n}!` : String(n);
      return padL(mark, 8);
    }).join('');
    console.log(pad(`${drop.shortLabel} (~${drop.approxKm}km)`, 28) + cells);
  }

  if (coverage.nextRecommended) {
    const n = coverage.nextRecommended;
    console.log(
      `\nNext priority: ${n.periodLabel} → ${n.drop.shortLabel} (${n.cellCount || 0}/${FIT_TARGET.minPerCell} · ~${n.drop.approxKm} km)`
    );
  } else {
    console.log(
      `\nPreset cells at ≥${FIT_TARGET.minPerCell} each — keep logging sparse periods, customs, or stretch to ${FIT_TARGET.totalNearPerfect}.`
    );
  }
}

function printModel(model, inSample) {
  console.log('\n=== Fitted model (production) ===');
  if (!model) {
    console.log('Could not fit — need more valid quotes.');
    return;
  }
  const conf = modelConfidence(model);
  console.log(
    `intercept ${Math.round(model.core.intercept)} · kmRate ${Math.round(model.core.kmRate)} · R² ${(model.r2 * 100).toFixed(1)}% (${conf.label}) · dataMaxKm ${model.dataMaxKm?.toFixed?.(1) ?? model.dataMaxKm} · n=${model.n}`
  );
  console.log('Premiums:');
  for (const id of PERIOD_ORDER) {
    console.log(`  ${pad(PERIODS[id].label, 14)} ${padL(Math.round(model.premiums[id] || 0), 6)}`);
  }
  if (inSample.n) {
    console.log(
      `\nIn-sample: MAE ${inSample.mae} UGX · within ±500: ${inSample.within500Pct}% (n=${inSample.n})`
    );
  }
}

function printSpotChecks(model, fixtures) {
  console.log('\n=== Spot checks (daytime, production predict) ===');
  console.log(
    pad('place', 28) + padL('km', 6) + padL('SafeBoda', 9) + padL('model', 8) + padL('Δ', 7)
  );
  for (const c of fixtures.spotChecks || []) {
    const pred = predictSafeBodaFee(c.km, model, { period: 'day' });
    const delta = pred != null ? pred - c.safeboda : null;
    console.log(
      pad(c.name, 28) +
        padL(c.km.toFixed(1), 6) +
        padL(c.safeboda, 9) +
        padL(pred ?? '—', 8) +
        padL(delta != null ? delta : '—', 7)
    );
  }

  console.log('\nKisugu South (~6.5 km) across periods:');
  for (const per of PERIOD_ORDER) {
    const pred = predictSafeBodaFee(6.541, model, { period: per });
    console.log(`  ${pad(PERIODS[per].label, 14)} ${pred ?? '—'}`);
  }

  const floorPred = predictSafeBodaFee(1.0, model, { period: 'day' });
  if (floorPred != null && floorPred < MIN_FARE_UGX) {
    console.log(`\nWARN: short trip predicted ${floorPred} < MIN_FARE ${MIN_FARE_UGX}`);
  } else if (floorPred != null) {
    console.log(`\nFloor ok: 1 km → ${floorPred} (≥ ${MIN_FARE_UGX})`);
  }
}

async function main() {
  const argvPath = process.argv[2];
  const fixtures = loadFixtures();
  const rows = await loadRows(argvPath);
  const coverage = analyzeCoverage(rows);
  const model = fitDeliveryFeeModel(rows);
  const inSample = scoreInSample(rows, model);

  printCoverage(coverage);
  printModel(model, inSample);
  printSpotChecks(model, fixtures);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
