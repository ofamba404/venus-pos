/**
 * SafeBoda fee estimator — reverse-engineered from logged checkout quotes.
 *
 * Public SafeBoda / ride-hailing sources describe fares as:
 *   base + (distance × rate/km) + (time × rate/min) [+ minimum]
 * with extra premiums by hour-of-day, demand, and weather.
 *
 * Venus does not get live API quotes, so we fit from your logged quotes.
 * In-range: OLS + period premiums + MIN_FARE floor.
 * Past farthest logged km: blend toward long-range SafeBoda anchors.
 * Quotes expose a min–max from km-band residual envelopes, then clamp around
 * the point estimate: ±500 when R² + band sample count look solid, else ±1000.
 * Not every outlier log needs to fit; accuracy improves as quotes accumulate.
 * When opts.dest matches prior drop-offs in the same Kampala period, the quote
 * tightens to those logged fees instead of the wider km-band envelope.
 */

export const FEE_STEP_UGX = 500;
/** Half-width when confident (total range width 1000 UGX). */
export const TIGHT_RANGE_HALF_UGX = 500;
/** Half-width when unsure / sparse / extrapolating (total width 2000 UGX). */
export const WIDE_RANGE_HALF_UGX = 1000;
/** Min model R² to treat a quote as confident. */
const CONFIDENT_R2 = 0.75;
/** Min logs in the km residual band to treat a quote as confident. */
const CONFIDENT_BAND_N = 5;
/** @deprecated Prefer TIGHT/WIDE half-widths; kept as “sure” total width. */
export const MAX_RANGE_WIDTH_UGX = TIGHT_RANGE_HALF_UGX * 2;

/** Distance bands for residual envelopes used by quoteFeeRange. */
export const RANGE_BANDS_KM = [
  { minKm: 0, maxKm: 3 },
  { minKm: 3, maxKm: 6 },
  { minKm: 6, maxKm: 9 },
  { minKm: 9, maxKm: 15 },
  { minKm: 15, maxKm: Infinity },
];

/** Match prior drop-offs within this radius for location-aware tight quotes. */
const MEMORY_RADIUS_KM = 0.75;
/** Cap how many nearby hits shape the remembered range. */
const MEMORY_MAX_HITS = 8;

/** SafeBoda minimum fare (UGX). Applied after predict — never during the OLS fit. */
export const MIN_FARE_UGX = 3000;

/**
 * Long-range SafeBoda refs — used ONLY when quoting past the farthest logged km.
 * They must not enter the in-range OLS fit (that pulled mid trips like Kisugu off).
 */
const REFERENCE_ANCHORS = [
  { km: 20, fee: 17800 },
  { km: 26, fee: 22900 },
  { km: 31.6, fee: 28500 },
  { km: 40, fee: 35000 },
];


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

export function roundFeeDown500(fee) {
  return Math.max(0, Math.floor(fee / FEE_STEP_UGX) * FEE_STEP_UGX);
}

export function roundFeeUp500(fee) {
  return Math.max(0, Math.ceil(fee / FEE_STEP_UGX) * FEE_STEP_UGX);
}

/**
 * ±500 when R² and km-band sample count look solid; ±1000 otherwise.
 * Extrapolation past farthest logged km always uses the wider half-width.
 */
function rangeHalfWidthUgx(km, model) {
  if (!model) return WIDE_RANGE_HALF_UGX;
  const horizon = model.dataMaxKm != null ? model.dataMaxKm : 12;
  if (km != null && !Number.isNaN(km) && km > horizon + 0.25) {
    return WIDE_RANGE_HALF_UGX;
  }
  const r2 = model.r2 || 0;
  const env = envelopeForKm(km, model);
  const n = env?.n || 0;
  if (r2 >= CONFIDENT_R2 && n >= CONFIDENT_BAND_N) return TIGHT_RANGE_HALF_UGX;
  return WIDE_RANGE_HALF_UGX;
}

/**
 * Keep [lo, hi] within ±halfWidth of the point estimate.
 * Does not widen a naturally tight envelope. Point stays inside the range.
 */
function clampRangeAroundPoint(lo, hi, point, halfWidth = WIDE_RANGE_HALF_UGX) {
  const maxWidth = Math.max(FEE_STEP_UGX, halfWidth * 2);
  let pt = roundFeeToNearest500(point);
  if (pt < MIN_FARE_UGX) pt = MIN_FARE_UGX;
  let min = Math.max(MIN_FARE_UGX, lo);
  let max = Math.max(min + FEE_STEP_UGX, hi);

  if (max - min > maxWidth) {
    min = Math.max(MIN_FARE_UGX, roundFeeDown500(pt - halfWidth));
    max = roundFeeUp500(pt + halfWidth);
    if (max - min > maxWidth) max = min + maxWidth;
    if (max - min < FEE_STEP_UGX) max = min + FEE_STEP_UGX;
  } else if (max - min < FEE_STEP_UGX) {
    max = min + FEE_STEP_UGX;
  }

  if (pt < min) pt = min;
  if (pt > max) pt = max;
  return { lo: min, hi: max, point: pt, widthUgx: max - min };
}

function mean(nums) {
  if (!nums.length) return 0;
  return nums.reduce((s, n) => s + n, 0) / nums.length;
}

/** Solve Aβ = b via Gaussian elimination with partial pivoting. */
function solveLinearSystem(matrix, vector) {
  const n = vector.length;
  const a = matrix.map((row, i) => [...row, vector[i]]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(a[row][col]) > Math.abs(a[pivot][col])) pivot = row;
    }
    if (Math.abs(a[pivot][col]) < 1e-9) return null;
    if (pivot !== col) {
      const tmp = a[col];
      a[col] = a[pivot];
      a[pivot] = tmp;
    }
    const div = a[col][col];
    for (let j = col; j <= n; j++) a[col][j] /= div;
    for (let row = 0; row < n; row++) {
      if (row === col) continue;
      const factor = a[row][col];
      for (let j = col; j <= n; j++) a[row][j] -= factor * a[col][j];
    }
  }
  return a.map((row) => row[n]);
}

/**
 * Ordinary least squares with intercept.
 * @param {{ y: number, xs: number[] }[]} samples
 * @returns {{ intercept: number, coeffs: number[], r2: number, n: number } | null}
 */
function multiLinearRegression(samples) {
  const n = samples.length;
  if (n < 2) return null;
  const k = samples[0].xs.length;
  if (samples.some((s) => s.xs.length !== k)) return null;
  if (n < k + 1) return null;

  const dim = k + 1;
  const xtx = Array.from({ length: dim }, () => Array(dim).fill(0));
  const xty = Array(dim).fill(0);

  samples.forEach((s) => {
    const row = [1, ...s.xs];
    for (let i = 0; i < dim; i++) {
      xty[i] += row[i] * s.y;
      for (let j = 0; j < dim; j++) xtx[i][j] += row[i] * row[j];
    }
  });

  const beta = solveLinearSystem(xtx, xty);
  if (!beta) return null;

  const intercept = beta[0];
  const coeffs = beta.slice(1);
  const yMean = mean(samples.map((s) => s.y));
  let ssTot = 0;
  let ssRes = 0;
  samples.forEach((s) => {
    let pred = intercept;
    s.xs.forEach((x, i) => {
      pred += coeffs[i] * x;
    });
    ssTot += (s.y - yMean) ** 2;
    ssRes += (s.y - pred) ** 2;
  });
  const r2 = ssTot === 0 ? 1 : 1 - ssRes / ssTot;
  return { intercept, coeffs, r2, n };
}

function expectedMinsForKm(km, avgSpeedKmh) {
  const speed = avgSpeedKmh > 0 ? avgSpeedKmh : 18;
  return (km / speed) * 60;
}

/** Extra minutes beyond typical pace — proxy for jam / slow routing. */
function slowdownMins(km, mins, avgSpeedKmh) {
  if (mins == null || Number.isNaN(mins) || mins <= 0) return 0;
  return Math.max(0, mins - expectedMinsForKm(km, avgSpeedKmh));
}

function corePredict(km, mins, core) {
  let fee = core.intercept + core.kmRate * km;
  if (core.slowdownRate != null && core.slowdownRate > 0) {
    fee += core.slowdownRate * slowdownMins(km, mins, core.avgSpeedKmh);
  }
  return fee;
}

function buildSamples(rows) {
  return rows
    .map((d) => {
      const km = Number(d.distance_km);
      const fee = Number(d.fee_ugx);
      const mins = d.duration_min != null ? Number(d.duration_min) : null;
      const at = d.created_at ? new Date(d.created_at) : null;
      const lat = d.dest_lat != null ? Number(d.dest_lat) : null;
      const lng = d.dest_lng != null ? Number(d.dest_lng) : null;
      if (Number.isNaN(km) || Number.isNaN(fee) || km < 0) return null;
      return {
        km,
        fee,
        mins: mins != null && !Number.isNaN(mins) && mins > 0 ? mins : null,
        period: at && !Number.isNaN(at.getTime()) ? periodForDate(at) : 'day',
        at,
        lat: lat != null && !Number.isNaN(lat) ? lat : null,
        lng: lng != null && !Number.isNaN(lng) ? lng : null,
      };
    })
    .filter(Boolean);
}

/**
 * Fit fee model from delivery quote rows.
 * @param {Array<Record<string, unknown>>} rows
 */
function fitCoreModel(samples) {
  const withDuration = samples.filter((s) => s.mins != null);
  const speeds = withDuration
    .map((s) => s.km / (s.mins / 60))
    .filter((v) => v > 0 && Number.isFinite(v));
  const avgSpeedKmh = speeds.length ? mean(speeds) : 18;

  const kmOnly = multiLinearRegression(samples.map((s) => ({ y: s.fee, xs: [s.km] })));
  if (!kmOnly || kmOnly.coeffs[0] <= 0) return null;

  // Google driving mins ≈ collinear with km, so use only *slowdown* above
  // typical pace. Require a positive coefficient or ignore the term.
  let slowdownRate = null;
  if (withDuration.length >= 4) {
    const withSlowdown = withDuration.map((s) => ({
      y: s.fee,
      xs: [s.km, slowdownMins(s.km, s.mins, avgSpeedKmh)],
    }));
    const dual = multiLinearRegression(withSlowdown);
    if (dual && dual.coeffs[0] > 0 && dual.coeffs[1] > 0 && dual.r2 >= kmOnly.r2 - 0.01) {
      return {
        intercept: dual.intercept,
        kmRate: dual.coeffs[0],
        slowdownRate: dual.coeffs[1],
        avgSpeedKmh,
        usesSlowdown: true,
      };
    }
  }

  return {
    intercept: kmOnly.intercept,
    kmRate: kmOnly.coeffs[0],
    slowdownRate,
    avgSpeedKmh,
    usesSlowdown: false,
  };
}

export function fitDeliveryFeeModel(rows) {
  const samples = buildSamples(rows || []);
  if (samples.length < 2) return null;

  const core = fitCoreModel(samples);
  if (!core) return null;

  const premiums = {};
  const periodCounts = {};
  PERIOD_ORDER.forEach((id) => {
    premiums[id] = 0;
    periodCounts[id] = 0;
  });

  const residualsByPeriod = {};
  samples.forEach((s) => {
    const pred = corePredict(s.km, s.mins, core);
    const residual = s.fee - pred;
    if (!residualsByPeriod[s.period]) residualsByPeriod[s.period] = [];
    residualsByPeriod[s.period].push(residual);
    periodCounts[s.period] = (periodCounts[s.period] || 0) + 1;
  });

  Object.entries(residualsByPeriod).forEach(([period, residuals]) => {
    // Need a few quotes in-bucket before trusting a premium.
    // Shrink toward 0 so sparse buckets (e.g. 2 daytime quotes) don't dominate.
    if (residuals.length >= 2) {
      const raw = mean(residuals);
      const n = residuals.length;
      const priorStrength = 3;
      premiums[period] = raw * (n / (n + priorStrength));
    }
  });

  const predictions = samples.map((s) => {
    const raw = corePredict(s.km, s.mins, core) + (premiums[s.period] || 0);
    return { actual: s.fee, predicted: raw };
  });
  const yMean = mean(predictions.map((p) => p.actual));
  let ssTot = 0;
  let ssRes = 0;
  predictions.forEach((p) => {
    ssTot += (p.actual - yMean) ** 2;
    ssRes += (p.actual - p.predicted) ** 2;
  });
  const r2 = ssTot === 0 ? 1 : Math.max(0, Math.min(1, 1 - ssRes / ssTot));

  // Back-compat aliases used by older scatter / UI code.
  const dataMaxKm = Math.max(...samples.map((s) => s.km));

  const model = {
    kind: 'dynamic',
    n: samples.length,
    r2,
    minFare: MIN_FARE_UGX,
    intercept: core.intercept,
    slope: core.kmRate,
    core,
    premiums,
    periodCounts,
    avgSpeedKmh: core.avgSpeedKmh,
    usesDuration: core.usesSlowdown,
    dataMaxKm,
    samples,
  };
  model.residualBands = fitResidualBands(model, samples);
  return model;
}

function envelopeFromResiduals(residuals) {
  if (!residuals.length) {
    return { minResidual: -FEE_STEP_UGX, maxResidual: FEE_STEP_UGX, n: 0 };
  }
  return {
    minResidual: Math.min(...residuals),
    maxResidual: Math.max(...residuals),
    n: residuals.length,
  };
}

/** Snap quoted point residuals into km-band envelopes for range quotes. */
function fitResidualBands(model, samples) {
  const bandBuckets = RANGE_BANDS_KM.map((b) => ({ ...b, residuals: [] }));
  const global = [];
  samples.forEach((s) => {
    const pred = quoteFee(s.km, model, { durationMin: s.mins, period: s.period });
    const err = s.fee - pred;
    global.push(err);
    const band =
      bandBuckets.find((b) => s.km >= b.minKm && s.km < b.maxKm) ||
      bandBuckets[bandBuckets.length - 1];
    band.residuals.push(err);
  });
  return {
    global: envelopeFromResiduals(global),
    bands: bandBuckets.map((b) => ({
      minKm: b.minKm,
      maxKm: b.maxKm,
      ...envelopeFromResiduals(b.residuals),
    })),
  };
}

function envelopeForKm(km, model) {
  const rb = model?.residualBands;
  if (!rb) {
    return { minResidual: -FEE_STEP_UGX * 2, maxResidual: FEE_STEP_UGX * 2, n: 0 };
  }
  const band = rb.bands.find((b) => km >= b.minKm && km < b.maxKm);
  if (band && band.n >= 2) return band;
  return rb.global;
}

function haversineKm(a, b) {
  const toRad = (d) => (d * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Tight quote from prior drop-offs near dest in the same Kampala period.
 * @returns {{ feeMinUgx: number, feeMaxUgx: number, feePointUgx: number, widthUgx: number } | null}
 */
function locationMemoryQuote(model, opts = {}) {
  const dest = opts.dest;
  if (
    !model ||
    !dest ||
    !Number.isFinite(dest.lat) ||
    !Number.isFinite(dest.lng)
  ) {
    return null;
  }
  const period = opts.period || periodForDate(opts.at || new Date());
  const nearby = [];
  (model.samples || []).forEach((s) => {
    if (s.period !== period) return;
    if (s.lat == null || s.lng == null) return;
    const dKm = haversineKm(dest, { lat: s.lat, lng: s.lng });
    if (dKm <= MEMORY_RADIUS_KM) nearby.push({ s, dKm });
  });
  if (!nearby.length) return null;

  nearby.sort((a, b) => {
    if (a.dKm !== b.dKm) return a.dKm - b.dKm;
    const atA = a.s.at instanceof Date && !Number.isNaN(a.s.at.getTime()) ? a.s.at.getTime() : 0;
    const atB = b.s.at instanceof Date && !Number.isNaN(b.s.at.getTime()) ? b.s.at.getTime() : 0;
    return atB - atA;
  });
  const pool = nearby.slice(0, MEMORY_MAX_HITS).map((n) => n.s);
  const fees = pool.map((s) => s.fee);
  let lo = Math.max(MIN_FARE_UGX, roundFeeDown500(Math.min(...fees)));
  let hi = Math.max(lo, roundFeeUp500(Math.max(...fees)));

  const newest = pool
    .slice()
    .sort((a, b) => {
      const atA = a.at instanceof Date && !Number.isNaN(a.at.getTime()) ? a.at.getTime() : 0;
      const atB = b.at instanceof Date && !Number.isNaN(b.at.getTime()) ? b.at.getTime() : 0;
      return atB - atA;
    })[0];
  const clamped = clampRangeAroundPoint(
    lo,
    hi,
    newest.fee,
    rangeHalfWidthUgx(opts.quoteKm, model)
  );

  return {
    feeMinUgx: clamped.lo,
    feeMaxUgx: clamped.hi,
    feePointUgx: clamped.point,
    widthUgx: clamped.widthUgx,
  };
}

export function estimateDurationMin(km, model) {
  if (km == null || Number.isNaN(km) || km < 0) return null;
  const speed = model?.avgSpeedKmh > 0 ? model.avgSpeedKmh : 18;
  return (km / speed) * 60;
}

function anchoredLongFee(km) {
  const pts = [{ km: 0, fee: MIN_FARE_UGX }, ...REFERENCE_ANCHORS];
  for (let i = 1; i < pts.length; i++) {
    if (km <= pts[i].km) {
      const a = pts[i - 1];
      const b = pts[i];
      const t = (km - a.km) / (b.km - a.km);
      return a.fee + t * (b.fee - a.fee);
    }
  }
  const last = pts[pts.length - 1];
  const prev = pts[pts.length - 2];
  const slope = (last.fee - prev.fee) / (last.km - prev.km);
  return last.fee + slope * (km - last.km);
}

/**
 * Unrounded raw estimate (before MIN_FARE floor + 500 UGX snap).
 * Past dataMaxKm, blend OLS toward long-range anchors over the next ~8 km.
 */
export function rawQuoteFee(km, model, { durationMin = null, period = null, at = null } = {}) {
  if (!model || km == null || Number.isNaN(km)) return null;
  const bucket = period || (at ? periodForDate(at) : periodForDate(new Date()));
  const mins = durationMin != null && !Number.isNaN(durationMin) ? durationMin : null;
  const ols = corePredict(km, mins, model.core) + (model.premiums[bucket] || 0);
  const horizon = model.dataMaxKm != null ? model.dataMaxKm : 12;
  if (km <= horizon + 0.25) return ols;
  const t = Math.min(1, (km - horizon) / 8);
  return ols * (1 - t) + anchoredLongFee(km) * t;
}

export function quoteFee(km, model, opts = {}) {
  const mem = locationMemoryQuote(model, { ...opts, quoteKm: km });
  if (mem) return mem.feePointUgx;
  const raw = rawQuoteFee(km, model, opts);
  if (raw == null) return 0;
  return Math.max(MIN_FARE_UGX, roundFeeToNearest500(raw));
}

/**
 * Min–max range from km-band residual envelopes, clamped around the point
 * estimate (±500 when confident, ±1000 when unsure).
 * With opts.dest, prefers a tight range from nearby same-period logged fees.
 * @returns {{ feeMinUgx: number, feeMaxUgx: number, feePointUgx: number, widthUgx: number }}
 */
export function quoteFeeRange(km, model, opts = {}) {
  const mem = locationMemoryQuote(model, { ...opts, quoteKm: km });
  if (mem) return mem;
  const point = quoteFee(km, model, opts);
  if (!point) {
    return { feeMinUgx: 0, feeMaxUgx: 0, feePointUgx: 0, widthUgx: 0 };
  }
  const env = envelopeForKm(km, model);
  let lo = Math.max(MIN_FARE_UGX, roundFeeDown500(point + env.minResidual));
  let hi = Math.max(lo + FEE_STEP_UGX, roundFeeUp500(point + env.maxResidual));
  if (point < lo) lo = Math.max(MIN_FARE_UGX, roundFeeDown500(point));
  if (point > hi) hi = roundFeeUp500(point);
  const clamped = clampRangeAroundPoint(lo, hi, point, rangeHalfWidthUgx(km, model));
  return {
    feeMinUgx: clamped.lo,
    feeMaxUgx: clamped.hi,
    feePointUgx: clamped.point,
    widthUgx: clamped.widthUgx,
  };
}

/**
 * @param {number} km
 * @param {object | null} model
 * @param {{ durationMin?: number|null, period?: string|null, at?: Date|string|null, dest?: { lat: number, lng: number }|null }} [opts]
 */
export function predictSafeBodaFee(km, model, opts = {}) {
  if (!model || km == null || Number.isNaN(km)) return null;
  const fee = quoteFee(km, model, opts);
  return fee > 0 ? fee : null;
}

/**
 * Range quote for storefront / POS — feeMaxUgx is the safe stored estimate.
 * When opts.dest matches nearby same-period logs, range tightens to those fees.
 * @returns {{ feeMinUgx: number, feeMaxUgx: number, feePointUgx: number, widthUgx: number } | null}
 */
export function predictSafeBodaFeeRange(km, model, opts = {}) {
  if (!model || km == null || Number.isNaN(km)) return null;
  const range = quoteFeeRange(km, model, opts);
  return range.feeMaxUgx > 0 ? range : null;
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
