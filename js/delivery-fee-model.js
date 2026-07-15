/**
 * SafeBoda fee estimator — reverse-engineered from logged checkout quotes.
 *
 * Public SafeBoda / ride-hailing sources describe fares as:
 *   base + (distance × rate/km) + (time × rate/min) [+ minimum]
 * with extra premiums by hour-of-day, demand, and weather.
 *
 * Venus does not get Live API quotes, so we fit that shape from your own
 * logged quotes and adjust for Kampala time-of-day buckets.
 */

export const FEE_STEP_UGX = 500;

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
  return {
    kind: 'dynamic',
    n: samples.length,
    r2,
    intercept: core.intercept,
    slope: core.kmRate,
    core,
    premiums,
    periodCounts,
    avgSpeedKmh: core.avgSpeedKmh,
    usesDuration: core.usesSlowdown,
    samples,
  };
}

export function estimateDurationMin(km, model) {
  if (km == null || Number.isNaN(km) || km < 0) return null;
  const speed = model?.avgSpeedKmh > 0 ? model.avgSpeedKmh : 18;
  return (km / speed) * 60;
}

/**
 * Unrounded raw estimate (before 500 UGX snap).
 */
export function rawQuoteFee(km, model, { durationMin = null, period = null, at = null } = {}) {
  if (!model || km == null || Number.isNaN(km)) return null;
  const bucket = period || (at ? periodForDate(at) : periodForDate(new Date()));
  const mins = durationMin != null && !Number.isNaN(durationMin) ? durationMin : null;
  return corePredict(km, mins, model.core) + (model.premiums[bucket] || 0);
}

export function quoteFee(km, model, opts = {}) {
  const raw = rawQuoteFee(km, model, opts);
  if (raw == null) return 0;
  return roundFeeToNearest500(raw);
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
