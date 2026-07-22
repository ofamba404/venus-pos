/**
 * Manual SafeBoda quote testing — fixed pickup + curated drop-offs.
 *
 * Goal: enough distance × time-of-day coverage that OLS + period premiums
 * actually stabilize. SafeBoda noise (rain/demand) means a single pass of
 * 9 quotes/period is nowhere near enough — treat that old target as wrong.
 */

import { PERIODS, periodForDate } from './delivery-fee-model.js';
import { getPageHref } from './config.js';

/** Tag written to deliveries.client_name for manual tests (sale_id null). */
export const TEST_CLIENT_NAME = 'SafeBoda test';

export const BASE_ORIGIN = {
  id: 'prisca-honey',
  label: 'Prisca Honey Enterprises, Aryan Hostel, Nkinzi Road',
  shortLabel: 'Prisca Honey · Nkinzi Rd',
  // Google Places rooftop — Plot 29/30 Aryan Hostel, Shop 06 Nkinzi Rd.
  lat: 0.3351426,
  lng: 32.5737724,
};

/**
 * Quote-lab drop-offs — curated for SafeBoda fee-model coverage, not random.
 *
 * Selection rules (from verified Prisca Honey origin):
 * 1. Real Google Places POIs that are easy to search in SafeBoda
 * 2. Road-distance ladder via Distance Matrix (~0.8 → ~11 km)
 * 3. Different corridors / jam patterns
 * 4. Band mix: short (<2.5) · mid (<6) · long (≥6)
 *
 * approxKm = Google driving distance. SafeBoda km/fee can still differ slightly.
 */
export const TEST_DROPOFFS = [
  {
    id: 'wandegeya',
    label: 'Wandegeya Market, Kampala',
    shortLabel: 'Wandegeya Market',
    searchAs: 'Wandegeya Market',
    lat: 0.3305576,
    lng: 32.5733405,
    band: 'short',
    approxKm: 0.8,
    why: 'Nearest market hop — anchors base fare / 3k floor',
  },
  {
    id: 'makerere-gate',
    label: 'Makerere University Main Gate, Kampala',
    shortLabel: 'Makerere University Main Gate',
    searchAs: 'Makerere University Main Gate',
    lat: 0.329201,
    lng: 32.5710341,
    band: 'short',
    approxKm: 1.2,
    why: 'Campus corridor — SafeBoda-confirmed POI name',
  },
  {
    id: 'acacia',
    label: 'Acacia Mall, Cooper Road, Kampala',
    shortLabel: 'Acacia Mall',
    searchAs: 'Acacia Mall',
    lat: 0.3381812,
    lng: 32.5863218,
    band: 'mid',
    approxKm: 2.9,
    why: 'Kololo / Kisementi — mid student & office drops',
  },
  {
    id: 'nakasero',
    label: 'Nakasero Market, Kampala',
    shortLabel: 'Nakasero Market',
    searchAs: 'Nakasero Market',
    lat: 0.3117969,
    lng: 32.5800566,
    band: 'mid',
    approxKm: 3.2,
    why: 'CBD market corridor — daytime traffic pattern',
  },
  {
    id: 'kawempe',
    label: 'Mperwerwe Gayaza Stage, Gayaza-Kampala Road',
    shortLabel: 'Mperwerwe Gayaza Stage',
    searchAs: 'Mperwerwe Gayaza Stage',
    aliases: ['mpererwe', 'gayaza stage', 'kawempe taxi park', 'mpererwe kasangati'],
    lat: 0.3822452,
    lng: 32.5767988,
    band: 'mid',
    approxKm: 5.6,
    why: 'North / Gayaza corridor — upper-mid jam pattern',
  },
  {
    id: 'kisugu-south',
    label: 'Kisugu South, Kampala',
    shortLabel: 'Kisugu South',
    searchAs: 'Kisugu South',
    aliases: ['kisugu s', 'kisugu'],
    lat: 0.3044859,
    lng: 32.6060064,
    band: 'long',
    approxKm: 6.5,
    why: 'SE / Kabalagala corridor — mid-long check (~5.5–6.5k SafeBoda)',
  },
  {
    id: 'bugolobi',
    label: 'Village Mall, Spring Road, Kampala',
    shortLabel: 'Village Mall',
    searchAs: 'Village Mall',
    aliases: ['village mall bugolobi', 'bugolobi'],
    lat: 0.320333,
    lng: 32.6179634,
    band: 'long',
    approxKm: 6.8,
    why: 'Bugolobi / Spring Rd — SafeBoda-confirmed long SE run',
  },
  {
    id: 'ntinda',
    label: 'Capital Shoppers, Ntinda Road, Kampala',
    shortLabel: 'Capital Shoppers Ntinda',
    searchAs: 'Capital Shoppers Ntinda',
    aliases: ['ntinda shopping complex', 'ntinda shopping center', 'ntinda'],
    lat: 0.3491591,
    lng: 32.6165672,
    band: 'long',
    approxKm: 9.3,
    why: 'Ntinda east — stretches the km rate (~9 km)',
  },
  {
    id: 'garden-city',
    label: 'Metroplex Shopping Centre, Kampala - Northern Bypass Highway',
    shortLabel: 'Metroplex Shopping Centre',
    searchAs: 'Metroplex Shopping Centre',
    aliases: ['metroplex shopping mall', 'metroplex', 'garden city'],
    lat: 0.3675,
    lng: 32.6330556,
    band: 'long',
    approxKm: 11.3,
    why: 'Northern Bypass long run — top of the distance ladder',
  },
];

/**
 * Named places to log via custom search (no fixed pin until you pick them).
 * Use these when SafeBoda quotes disagree with the app — log the same POI
 * across periods so the fit learns that corridor.
 */
export const CALIBRATION_SEARCHES = [
  {
    id: 'pine-valley',
    searchAs: 'Pine Valley Apartments',
    shortLabel: 'Pine Valley Apartments',
    note: 'Near mid (~3.5k SafeBoda) — log day + evening at least',
  },
  {
    id: 'meeting-point-ganda',
    searchAs: 'Meeting Point Ganda Road',
    shortLabel: 'Meeting Point · Ganda Rd',
    note: 'Mid-long (~5.5k SafeBoda) — pair with Kisugu South',
  },
];

/**
 * Honest sample targets (the old 9/period target was too thin):
 * - Period premiums shrink toward 0 with priorStrength=3 → need ~20/period
 *   before the premium is mostly data-driven (~85% weight).
 * - Each preset × period should be logged at least twice (minPerCell) so one
 *   weird quote cannot own a cell.
 * - 9 presets × 4 periods × 2 = 72; strong target 80 leaves room for customs.
 * - Stretch 120 ≈ 3 fills of the matrix + custom calibration POIs.
 *
 * Real SafeBoda noise means R²≈1.0 is unlikely — "strong" means ≥90% with
 * balanced coverage, not "done after 36 logs".
 */
export const FIT_TARGET = {
  perPeriod: 20,
  perPeriodStretch: 30,
  minPerCell: 2,
  totalStrong: 80,
  totalNearPerfect: 120,
  minForSlowdown: 8,
  strongR2: 0.9,
  perBand: { short: 16, mid: 28, long: 28 },
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
    body: 'Log 2–3 routes (one short, one mid/long) from Prisca Honey while SafeBoda shows morning prices.',
    url: getPageHref('delivery') + '#quote-lab',
  },
  {
    id: 'dl-test-day',
    type: 'delivery-test',
    hour: 12,
    minute: 0,
    period: 'day',
    title: 'SafeBoda quote check · daytime',
    body: 'Midday — open Delivery → Quote lab. Prefer a red matrix cell or a calibration search (Pine Valley / Ganda).',
    url: getPageHref('delivery') + '#quote-lab',
  },
  {
    id: 'dl-test-evening',
    type: 'delivery-test',
    hour: 17,
    minute: 30,
    period: 'evening_peak',
    title: 'SafeBoda quote check · evening peak',
    body: 'Evening peak — re-log a route you already did in daytime so the period premium learns the gap.',
    url: getPageHref('delivery') + '#quote-lab',
  },
  {
    id: 'dl-test-night',
    type: 'delivery-test',
    hour: 21,
    minute: 0,
    period: 'night',
    title: 'SafeBoda quote check · night',
    body: 'Night band — same route as earlier today if possible; night premiums need paired data.',
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

/** Match a logged row to a preset drop-off (label, aliases, or ~400m proximity). */
export function matchDropoff(row) {
  const label = String(row.dest_label || '').toLowerCase();
  for (const d of TEST_DROPOFFS) {
    const needles = [
      d.shortLabel,
      d.label,
      d.searchAs,
      d.id.replace(/-/g, ' '),
      ...(d.aliases || []),
    ]
      .filter(Boolean)
      .map((s) => String(s).toLowerCase());
    if (needles.some((n) => n && label.includes(n))) return d;
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

  // Prefer cells under minPerCell; then periods furthest below target.
  const gaps = [];
  PERIOD_IDS.forEach((period) => {
    TEST_DROPOFFS.forEach((drop) => {
      const n = matrix[period][drop.id] || 0;
      if (n < FIT_TARGET.minPerCell) {
        gaps.push({
          period,
          drop,
          count: n,
          score:
            (FIT_TARGET.perPeriod - (byPeriod[period] || 0)) * 10 +
            (FIT_TARGET.minPerCell - n) * 5 +
            (drop.band === 'long' ? 3 : drop.band === 'mid' ? 2 : 1),
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

  const cellsFilled = PERIOD_IDS.reduce(
    (sum, p) =>
      sum +
      TEST_DROPOFFS.filter((d) => (matrix[p][d.id] || 0) >= FIT_TARGET.minPerCell)
        .length,
    0
  );
  const cellsTotal = PERIOD_IDS.length * TEST_DROPOFFS.length;

  const total = list.length;
  const progressStrong = Math.min(1, total / FIT_TARGET.totalStrong);
  const periodsMet = PERIOD_IDS.filter(
    (id) => (byPeriod[id] || 0) >= FIT_TARGET.perPeriod
  ).length;
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
    cellsFilled,
    cellsTotal,
    progressStrong,
    progressNearPerfect: Math.min(1, total / FIT_TARGET.totalNearPerfect),
    nextRecommended: next
      ? {
          periodId: next.period,
          periodLabel: PERIODS[next.period].label,
          drop: next.drop,
          cellCount: next.count,
        }
      : null,
    logsStillNeeded: Math.max(0, FIT_TARGET.totalStrong - total),
    stretchStillNeeded: Math.max(0, FIT_TARGET.totalNearPerfect - total),
  };
}

export function getDropoffById(id) {
  return TEST_DROPOFFS.find((d) => d.id === id) || null;
}
