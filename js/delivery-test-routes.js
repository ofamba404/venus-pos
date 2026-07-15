/**
 * Manual SafeBoda quote testing — fixed pickup + curated drop-offs.
 *
 * Goal: balanced distance × time-of-day coverage so the OLS fee model
 * approaches a strong fit (R² ≥ 0.90). Real checkout logs count too.
 */

import { PERIODS, periodForDate } from './delivery-fee-model.js';
import { getPageHref } from './config.js';

/** Tag written to deliveries.client_name for manual tests (sale_id null). */
export const TEST_CLIENT_NAME = 'SafeBoda test';

export const BASE_ORIGIN = {
  id: 'prisca-honey',
  label: 'Prisca Honey Enterprises, Aryan Hostel, Nkinzi Road',
  shortLabel: 'Prisca Honey · Nkinzi Rd',
  // Makerere / Kikoni · Nkinzi Rd — Distance Matrix snaps to road network.
  lat: 0.3382,
  lng: 32.5635,
};

/**
 * Drop-offs chosen for:
 * - distance ladder (~1.5 → ~9 km) from the base
 * - different corridors (Wandegeya / Kololo / city / Ntinda / Bugolobi)
 * - easy to search in the SafeBoda app
 */
export const TEST_DROPOFFS = [
  {
    id: 'wandegeya',
    label: 'Wandegeya Market, Kampala',
    shortLabel: 'Wandegeya Market',
    lat: 0.3318,
    lng: 32.5735,
    band: 'short',
    approxKm: 1.5,
    why: 'Near-shop short hop — anchors base fare',
  },
  {
    id: 'makerere-gate',
    label: 'Makerere University Main Gate, Kampala',
    shortLabel: 'Makerere Main Gate',
    lat: 0.3336,
    lng: 32.5675,
    band: 'short',
    approxKm: 1.2,
    why: 'Short campus route — confirms minimum band',
  },
  {
    id: 'acacia',
    label: 'Acacia Mall, Kisementi, Kampala',
    shortLabel: 'Acacia Mall',
    lat: 0.3378,
    lng: 32.5865,
    band: 'mid',
    approxKm: 3.2,
    why: 'Typical mid-range student / office drop',
  },
  {
    id: 'garden-city',
    label: 'Garden City Mall, Yusuf Lule Road, Kampala',
    shortLabel: 'Garden City',
    lat: 0.3265,
    lng: 32.582,
    band: 'mid',
    approxKm: 4.5,
    why: 'City-centre corridor with different traffic',
  },
  {
    id: 'nakasero',
    label: 'Nakasero Market, Kampala',
    shortLabel: 'Nakasero Market',
    lat: 0.3155,
    lng: 32.5825,
    band: 'mid',
    approxKm: 5.0,
    why: 'Central business corridor — common daytime drop',
  },
  {
    id: 'kawempe',
    label: 'Kawempe Taxi Park, Kampala',
    shortLabel: 'Kawempe Taxi Park',
    lat: 0.379,
    lng: 32.561,
    band: 'long',
    approxKm: 6.5,
    why: 'North corridor — different jam pattern than Ntinda/Bugolobi',
  },
  {
    id: 'ntinda',
    label: 'Ntinda Shopping Complex, Kampala',
    shortLabel: 'Ntinda Complex',
    lat: 0.356,
    lng: 32.616,
    band: 'long',
    approxKm: 7.0,
    why: 'Long east run — stretches the km rate',
  },
  {
    id: 'bugolobi',
    label: 'Village Mall, Bugolobi, Kampala',
    shortLabel: 'Village Mall Bugolobi',
    lat: 0.318,
    lng: 32.62,
    band: 'long',
    approxKm: 9.0,
    why: 'Longest preset — stress-tests far quotes',
  },
];

/**
 * Sample targets derived from the fee model:
 * - Period premiums shrink toward 0 with priorStrength=3 → need ~9/period
 *   for a usable (~75% weight) premium, ~12/period near-stable (~80%).
 * - Slowdown term needs ≥4 rows with duration (always collected).
 * - 8 routes × 4 periods = 32 covers the matrix once; 36 is the strong
 *   target; 48 is the stretch for near-max period stability.
 *
 * Real SafeBoda noise (rain/demand) means R²≈1.0 is unlikely — "almost
 * 100%" here means Strong fit (≥90%) with balanced coverage.
 */
export const FIT_TARGET = {
  perPeriod: 9,
  perPeriodStretch: 12,
  totalStrong: 36,
  totalNearPerfect: 48,
  minForSlowdown: 4,
  strongR2: 0.9,
};

const PERIOD_IDS = ['morning_peak', 'day', 'evening_peak', 'night'];
const BANDS = ['short', 'mid', 'long'];

/** Kampala reminder slots — one ping per pricing period. */
export const DELIVERY_TEST_REMINDERS = [
  {
    id: 'dl-test-morning',
    type: 'delivery-test',
    hour: 7,
    minute: 30,
    period: 'morning_peak',
    title: 'SafeBoda quote check · morning peak',
    body: 'Log 1–2 preset routes from Prisca Honey while SafeBoda shows morning prices.',
    url: getPageHref('delivery') + '#quote-lab',
  },
  {
    id: 'dl-test-day',
    type: 'delivery-test',
    hour: 12,
    minute: 0,
    period: 'day',
    title: 'SafeBoda quote check · daytime',
    body: 'Midday prices — open Delivery → Quote lab and log the next priority drop-off.',
    url: getPageHref('delivery') + '#quote-lab',
  },
  {
    id: 'dl-test-evening',
    type: 'delivery-test',
    hour: 17,
    minute: 30,
    period: 'evening_peak',
    title: 'SafeBoda quote check · evening peak',
    body: 'Evening peak — check SafeBoda and log a mid or long preset route.',
    url: getPageHref('delivery') + '#quote-lab',
  },
  {
    id: 'dl-test-night',
    type: 'delivery-test',
    hour: 21,
    minute: 0,
    period: 'night',
    title: 'SafeBoda quote check · night',
    body: 'Night band — you already have many night quotes; still log a gap if the matrix shows red.',
    url: getPageHref('delivery') + '#quote-lab',
  },
];

function haversineKm(a, b) {
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function bandForKm(km) {
  if (km < 2.5) return 'short';
  if (km < 6) return 'mid';
  return 'long';
}

/** Match a logged row to a preset drop-off (label or ~400m proximity). */
export function matchDropoff(row) {
  const label = String(row.dest_label || '').toLowerCase();
  for (const d of TEST_DROPOFFS) {
    if (label.includes(d.shortLabel.toLowerCase()) || label.includes(d.id.replace(/-/g, ' '))) {
      return d;
    }
  }
  if (row.dest_lat != null && row.dest_lng != null) {
    let best = null;
    let bestKm = Infinity;
    for (const d of TEST_DROPOFFS) {
      const km = haversineKm(
        { lat: Number(row.dest_lat), lng: Number(row.dest_lng) },
        { lat: d.lat, lng: d.lng },
      );
      if (km < bestKm) {
        bestKm = km;
        best = d;
      }
    }
    if (best && bestKm < 0.4) return best;
  }
  return null;
}

export function isTestQuote(row) {
  const name = String(row.client_name || '').toLowerCase();
  return name.includes('safeboda test') || name === 'manual test';
}

/**
 * Aggregate real + test quotes into a coverage matrix and next action.
 * @param {Array<Record<string, unknown>>} rows
 */
export function analyzeCoverage(rows) {
  const list = rows || [];
  const byPeriod = Object.fromEntries(PERIOD_IDS.map((id) => [id, 0]));
  const byBand = Object.fromEntries(BANDS.map((id) => [id, 0]));
  /** @type {Record<string, Record<string, number>>} */
  const matrix = {};
  PERIOD_IDS.forEach((p) => {
    matrix[p] = Object.fromEntries(TEST_DROPOFFS.map((d) => [d.id, 0]));
  });

  let withDuration = 0;
  let testCount = 0;

  list.forEach((d) => {
    const period = d.created_at ? periodForDate(new Date(d.created_at)) : 'day';
    byPeriod[period] = (byPeriod[period] || 0) + 1;
    const km = Number(d.distance_km);
    if (!Number.isNaN(km)) byBand[bandForKm(km)] = (byBand[bandForKm(km)] || 0) + 1;
    if (d.duration_min != null && Number(d.duration_min) > 0) withDuration += 1;
    if (isTestQuote(d)) testCount += 1;

    const drop = matchDropoff(d);
    if (drop && matrix[period]) {
      matrix[period][drop.id] = (matrix[period][drop.id] || 0) + 1;
    }
  });

  // Prefer empty period×route cells; then periods furthest below target.
  const gaps = [];
  PERIOD_IDS.forEach((period) => {
    TEST_DROPOFFS.forEach((drop) => {
      const n = matrix[period][drop.id] || 0;
      if (n < 1) {
        gaps.push({
          period,
          drop,
          count: n,
          // Soft priority: underfilled periods first, then longer routes (more informative).
          score:
            (FIT_TARGET.perPeriod - (byPeriod[period] || 0)) * 10 +
            (drop.band === 'long' ? 3 : drop.band === 'mid' ? 2 : 1) -
            n,
        });
      }
    });
  });
  gaps.sort((a, b) => b.score - a.score);

  const periodGaps = PERIOD_IDS.map((id) => ({
    id,
    label: PERIODS[id].label,
    hint: PERIODS[id].hint,
    count: byPeriod[id] || 0,
    need: Math.max(0, FIT_TARGET.perPeriod - (byPeriod[id] || 0)),
  })).sort((a, b) => b.need - a.need);

  const total = list.length;
  const progressStrong = Math.min(1, total / FIT_TARGET.totalStrong);
  const periodsMet = PERIOD_IDS.filter((id) => (byPeriod[id] || 0) >= FIT_TARGET.perPeriod).length;
  const next = gaps[0] || null;

  return {
    total,
    testCount,
    realCount: total - testCount,
    withDuration,
    byPeriod,
    byBand,
    matrix,
    periodGaps,
    periodsMet,
    progressStrong,
    progressNearPerfect: Math.min(1, total / FIT_TARGET.totalNearPerfect),
    nextRecommended: next
      ? {
          periodId: next.period,
          periodLabel: PERIODS[next.period].label,
          drop: next.drop,
        }
      : null,
    logsStillNeeded: Math.max(0, FIT_TARGET.totalStrong - total),
    stretchStillNeeded: Math.max(0, FIT_TARGET.totalNearPerfect - total),
  };
}

export function getDropoffById(id) {
  return TEST_DROPOFFS.find((d) => d.id === id) || null;
}
