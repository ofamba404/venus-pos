/**
 * SafeBoda fee estimator — reverse-engineered from logged checkout quotes.
 *
 * Fare = max(MIN_FARE, round500( (intercept + kmRate·km) · surge[period] )).
 *
 * Calibrated from logged SafeBoda quotes with three guardrails learned from the data:
 *  1. A hard MIN_FARE floor (SafeBoda never quotes below it — confirmed by every
 *     short trip in the logs sitting at exactly 3,000).
 *  2. A floored, anchored regression so short trips stay on the floor and long trips
 *     match SafeBoda's real per-km rate (plain OLS on floored data flattens the slope
 *     and overshoots the intercept, undershooting long trips badly on extrapolation).
 *  3. A *multiplicative* time-of-day surge — the same-route logs show the peak/night
 *     premium grows with distance, i.e. it's a percentage, not a flat add-on.
 *
 * Venus does not get live API quotes, so we fit that shape from your own logged
 * SafeBoda quotes and adjust for Kampala time-of-day buckets.
 */

export const FEE_STEP_UGX = 500;

/**
 * SafeBoda minimum fare (UGX). Every logged trip below ~2.5 km sits at this floor,
 * and same pickup/drop-off quotes at exactly this. Applied in all periods.
 */
export const MIN_FARE_UGX = 3000;

/**
 * SafeBoda long-range reference points used to anchor the per-km slope.
 * All logged trips are < 12 km, so the slope past that is undetermined by data
 * alone; these keep extrapolation aligned with observed SafeBoda quotes
 * (e.g. ~31.6 km ≈ 28,500 UGX). Each is weighted like ANCHOR_WEIGHT real trips,
 * so real in-range data still dominates the middle of the curve.
 */
const REFERENCE_ANCHORS = [
  { km: 20, fee: 17800 },
  { km: 26, fee: 22900 },
  { km: 31.6, fee: 28500 },
  { km: 40, fee: 35000 },
];
const ANCHOR_WEIGHT = 3;

/** Surge is shrunk toward 1.0 and clamped so sparse/noisy buckets stay sane. */
const SURGE_MIN = 0.85;
const SURGE_MAX = 1.5;
const SURGE_PRIOR = 4;

/** Kampala local hour buckets aligned with SafeBoda peak announcements. */
export const PERIODS = {
  morning_peak: {
    id: 'morning_peak',
    label: 'Morning peak',
    short: 'AM peak',
    hint: '6:00–9:00',
  },
  day: {
    id: 'day',
    label: 'Day',
    short: 'Day',
    hint: '9:00–16:00',
  },
  evening_peak: {
    id: 'evening_peak',
    label: 'Evening peak',
    short: 'PM peak',
    hint: '16:00–20:00',
  },
  night: {
    id: 'night',
    label: 'Night',
    short: 'Night',
    hint: '20:00–6:00',
  },
};

const PERIOD_ORDER = ['morning_peak', 'day', 'evening_peak', 'night'];

/** Africa/Kampala is UTC+3 year-round (no DST). */
export function kampalaHour(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return new Date().getUTCHours() + 3;
  return (d.getUTCHours() + 3) % 24;
}

export function periodForHour(hour) {
  const h = ((Number(hour) % 24) + 24) % 24;
  if (h >= 6 && h < 9) return 'morning_peak';
  if (h >= 9 && h < 16) return 'day';
  if (h >= 16 && h < 20) return 'evening_peak';
  return 'night';
}

export function periodForDate(date = new Date()) {
  return periodForHour(kampalaHour(date));
}

export function roundFeeToNearest500(fee) {
  return Math.max(0, Math.round(fee / FEE_STEP_UGX) * FEE_STEP_UGX);
}

function mean(nums) {
  if (!nums.length) return 0;
  return nums.reduce((s, n) => s + n, 0) / nums.length;
}

function median(nums) {
  if (!nums.length) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function clamp(value, lo, hi) {
  return Math.min(hi, Math.max(lo, value));
}

/** Weighted OLS for a single predictor: y = a + b·x. */
function weightedLinearFit(points) {
  let sw = 0;
  let swx = 0;
  let swy = 0;
  points.forEach((p) => {
    sw += p.w;
    swx += p.w * p.x;
    swy += p.w * p.y;
  });
  if (sw <= 0) return null;
  const mx = swx / sw;
  const my = swy / sw;
  let num = 0;
  let den = 0;
  points.forEach((p) => {
    num += p.w * (p.x - mx) * (p.y - my);
    den += p.w * (p.x - mx) ** 2;
  });
  if (den <= 0) return null;
  const b = num / den;
  return { intercept: my - b * mx, kmRate: b };
}

/**
 * Fit `max(MIN_FARE, intercept + kmRate·km)` without letting the flat floor
 * region drag the slope down: iteratively refit only on points whose linear
 * value sits above the floor (the floor points only tell us "≥ MIN_FARE").
 */
function fitFlooredLinear(points) {
  let fit = { intercept: 1000, kmRate: 850 };
  for (let iter = 0; iter < 60; iter += 1) {
    const active = points.filter(
      (p) => fit.intercept + fit.kmRate * p.x > MIN_FARE_UGX
    );
    if (active.reduce((s, p) => s + p.w, 0) < 1) break;
    const next = weightedLinearFit(active);
    if (!next || next.kmRate <= 0) break;
    if (
      Math.abs(next.intercept - fit.intercept) < 0.5 &&
      Math.abs(next.kmRate - fit.kmRate) < 0.5
    ) {
      fit = next;
      break;
    }
    fit = next;
  }
  return fit;
}

function flooredBase(km, core) {
  return Math.max(MIN_FARE_UGX, core.intercept + core.kmRate * km);
}

function buildSamples(rows) {
  return rows
    .map((d) => {
      const km = Number(d.distance_km);
      const fee = Number(d.fee_ugx);
      const mins = d.duration_min != null ? Number(d.duration_min) : null;
      const at = d.created_at ? new Date(d.created_at) : null;
      if (Number.isNaN(km) || Number.isNaN(fee) || km < 0) return null;
      return {
        km,
        fee,
        mins: mins != null && !Number.isNaN(mins) && mins > 0 ? mins : null,
        period: at && !Number.isNaN(at.getTime()) ? periodForDate(at) : 'day',
        at,
      };
    })
    .filter(Boolean);
}

/** Floored, anchored per-km regression (self-calibrates as more trips log). */
function fitCoreModel(samples) {
  const withDuration = samples.filter((s) => s.mins != null);
  const speeds = withDuration
    .map((s) => s.km / (s.mins / 60))
    .filter((v) => v > 0 && Number.isFinite(v));
  const avgSpeedKmh = speeds.length ? mean(speeds) : 18;

  const points = samples.map((s) => ({ x: s.km, y: s.fee, w: 1 }));
  REFERENCE_ANCHORS.forEach((a) => {
    points.push({ x: a.km, y: a.fee, w: ANCHOR_WEIGHT });
  });

  const fit = fitFlooredLinear(points);
  if (!fit || fit.kmRate <= 0) return null;
  return { intercept: fit.intercept, kmRate: fit.kmRate, slowdownRate: null, avgSpeedKmh };
}

/**
 * Learn a *multiplicative* time-of-day surge per period.
 * Ratio is measured against the floored base so floor trips (ratio ≈ 1) never
 * invent surge; sparse buckets are shrunk toward 1.0 and the result is clamped.
 */
function fitSurge(samples, core) {
  const surge = {};
  const periodCounts = {};
  const ratiosByPeriod = {};
  PERIOD_ORDER.forEach((id) => {
    surge[id] = 1;
    periodCounts[id] = 0;
  });

  samples.forEach((s) => {
    const base = flooredBase(s.km, core);
    if (base <= 0) return;
    if (!ratiosByPeriod[s.period]) ratiosByPeriod[s.period] = [];
    ratiosByPeriod[s.period].push(s.fee / base);
    periodCounts[s.period] = (periodCounts[s.period] || 0) + 1;
  });

  Object.entries(ratiosByPeriod).forEach(([period, ratios]) => {
    if (!ratios.length) return;
    const raw = median(ratios);
    const n = ratios.length;
    const shrunk = 1 + (raw - 1) * (n / (n + SURGE_PRIOR));
    surge[period] = clamp(shrunk, SURGE_MIN, SURGE_MAX);
  });

  return { surge, periodCounts };
}

/**
 * Fit fee model from delivery quote rows.
 * @param {Array<Record<string, unknown>>} rows
 */
export function fitDeliveryFeeModel(rows) {
  const samples = buildSamples(rows || []);
  if (samples.length < 2) return null;

  const core = fitCoreModel(samples);
  if (!core) return null;

  const { surge, periodCounts } = fitSurge(samples, core);

  // Additive premiums kept for the analytics UI; derived from surge at a
  // representative distance so the "vs day" figures stay sane.
  const refBase = flooredBase(6, core);
  const premiums = {};
  PERIOD_ORDER.forEach((id) => {
    premiums[id] = Math.round(refBase * (surge[id] - 1));
  });

  let ssTot = 0;
  let ssRes = 0;
  const yMean = mean(samples.map((s) => s.fee));
  samples.forEach((s) => {
    const predicted = roundFeeToNearest500(
      flooredBase(s.km, core) * (surge[s.period] || 1)
    );
    ssTot += (s.fee - yMean) ** 2;
    ssRes += (s.fee - predicted) ** 2;
  });
  const r2 = ssTot === 0 ? 1 : Math.max(0, Math.min(1, 1 - ssRes / ssTot));

  // Back-compat aliases used by the scatter / analytics UI.
  return {
    kind: 'dynamic',
    n: samples.length,
    r2,
    minFare: MIN_FARE_UGX,
    intercept: core.intercept,
    slope: core.kmRate,
    core,
    surge,
    premiums,
    periodCounts,
    avgSpeedKmh: core.avgSpeedKmh,
    usesDuration: false,
    samples,
  };
}

export function estimateDurationMin(km, model) {
  if (km == null || Number.isNaN(km) || km < 0) return null;
  const speed = model?.avgSpeedKmh > 0 ? model.avgSpeedKmh : 18;
  return (km / speed) * 60;
}

function surgeForPeriod(model, bucket) {
  const value = model?.surge?.[bucket];
  return value != null && Number.isFinite(value) && value > 0 ? value : 1;
}

/**
 * Unrounded raw estimate (before the MIN_FARE floor + 500 UGX snap).
 */
export function rawQuoteFee(km, model, { period = null, at = null } = {}) {
  if (!model || !model.core || km == null || Number.isNaN(km)) return null;
  const bucket = period || (at ? periodForDate(at) : periodForDate(new Date()));
  return flooredBase(km, model.core) * surgeForPeriod(model, bucket);
}

export function quoteFee(km, model, opts = {}) {
  const raw = rawQuoteFee(km, model, opts);
  if (raw == null) return 0;
  return Math.max(MIN_FARE_UGX, roundFeeToNearest500(raw));
}

/**
 * @param {number} km
 * @param {object | null} model
 * @param {{ durationMin?: number|null, period?: string|null, at?: Date|string|null }} [opts]
 */
export function predictSafeBodaFee(km, model, opts = {}) {
  if (!model || km == null || Number.isNaN(km)) return null;
  const fee = quoteFee(km, model, opts);
  return fee > 0 ? fee : null;
}

export function modelConfidence(model) {
  if (!model) return { label: 'Need more data', cls: 'low', pct: 0 };
  const pct = Math.round(model.r2 * 100);
  if (model.r2 >= 0.9) return { label: 'Strong fit', cls: 'high', pct };
  if (model.r2 >= 0.75) return { label: 'Good fit', cls: 'mid', pct };
  if (model.r2 >= 0.5) return { label: 'Rough estimate', cls: 'mid', pct };
  return { label: 'Weak — log more quotes', cls: 'low', pct };
}

export function periodMeta(periodId) {
  return PERIODS[periodId] || PERIODS.day;
}

export function listPeriods() {
  return PERIOD_ORDER.map((id) => PERIODS[id]);
}

/** Relative premium vs daytime, rounded for display. */
export function formatPremiumVsDay(model, periodId) {
  if (!model) return null;
  const day = model.premiums.day || 0;
  const val = (model.premiums[periodId] || 0) - day;
  return roundFeeToNearest500(val);
}
