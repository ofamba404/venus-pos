/** Fee constants + period helpers — port of `legacy/js/delivery-fee-model.js` head. */

export const FEE_STEP_UGX = 500;
export const TIGHT_RANGE_HALF_UGX = 500;
export const WIDE_RANGE_HALF_UGX = 1000;
export const MAX_RANGE_WIDTH_UGX = TIGHT_RANGE_HALF_UGX * 2;
export const MIN_FARE_UGX = 3000;

export const RANGE_BANDS_KM = [
  { minKm: 0, maxKm: 3 },
  { minKm: 3, maxKm: 6 },
  { minKm: 6, maxKm: 9 },
  { minKm: 9, maxKm: 15 },
  { minKm: 15, maxKm: Infinity },
] as const;

export const PERIODS = {
  morning_peak: {
    id: 'morning_peak',
    label: 'Morning peak',
    short: 'AM peak',
    hint: '6:00–9:00',
  },
  day: { id: 'day', label: 'Day', short: 'Day', hint: '9:00–16:00' },
  evening_peak: {
    id: 'evening_peak',
    label: 'Evening peak',
    short: 'PM peak',
    hint: '16:00–20:00',
  },
  night: { id: 'night', label: 'Night', short: 'Night', hint: '20:00–6:00' },
} as const;

export type PeriodId = keyof typeof PERIODS;

/** Africa/Kampala is UTC+3 year-round (no DST). */
export function kampalaHour(date: Date | string | number = new Date()): number {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return (new Date().getUTCHours() + 3) % 24;
  return (d.getUTCHours() + 3) % 24;
}

export function periodForHour(hour: number): PeriodId {
  const h = ((Number(hour) % 24) + 24) % 24;
  if (h >= 6 && h < 9) return 'morning_peak';
  if (h >= 9 && h < 16) return 'day';
  if (h >= 16 && h < 20) return 'evening_peak';
  return 'night';
}

export function periodForDate(date: Date | string | number = new Date()): PeriodId {
  return periodForHour(kampalaHour(date));
}

export function roundFeeToNearest500(fee: number): number {
  return Math.max(0, Math.round(fee / FEE_STEP_UGX) * FEE_STEP_UGX);
}

export function roundFeeDown500(fee: number): number {
  return Math.max(0, Math.floor(fee / FEE_STEP_UGX) * FEE_STEP_UGX);
}

export function roundFeeUp500(fee: number): number {
  return Math.max(0, Math.ceil(fee / FEE_STEP_UGX) * FEE_STEP_UGX);
}

export function periodMeta(periodId: string) {
  return PERIODS[periodId as PeriodId] || null;
}

export function listPeriods() {
  return (Object.keys(PERIODS) as PeriodId[]).map((id) => PERIODS[id]);
}
