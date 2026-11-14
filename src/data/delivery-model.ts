import { signal } from '@preact/signals';
import {
  fitDeliveryFeeModel,
  predictSafeBodaFee,
  predictSafeBodaFeeRange,
} from '../domain/delivery-fee';
import { BASE_ORIGIN, haversineKm, roadKmEstimate, type LatLng } from '../domain/geo';
import { drivingRoute } from '../platform/maps';
import { sbFetch } from './api';

export type FeeModel = ReturnType<typeof fitDeliveryFeeModel>;

export const deliveryModel = signal<FeeModel>(null);
export const deliveryModelReady = signal(false);

export async function ensureDeliveryModel() {
  try {
    const res = await sbFetch('deliveries?select=*&order=created_at.desc&limit=200');
    if (!res.ok) throw new Error(`deliveries ${res.status}`);
    const rows = (await res.json()) as unknown[];
    deliveryModel.value = fitDeliveryFeeModel(rows);
  } catch {
    deliveryModel.value = null;
  } finally {
    deliveryModelReady.value = true;
  }
  return deliveryModel.value;
}

type FeeRange = {
  feeMinUgx?: number;
  feeMaxUgx?: number;
  feePointUgx?: number;
} | null;

/** Same fallback the storefront uses when quote history cannot be fitted. */
const FALLBACK = {
  intercept: 4000,
  kmRate: 1100,
  slowdownRate: 80,
  avgSpeedKmh: 18,
  minUgx: 3000,
  stepUgx: 500,
  padUgx: 1000,
};

function roundFee(fee: number, minUgx: number, stepUgx: number) {
  return Math.max(minUgx, Math.round(fee / stepUgx) * stepUgx);
}

/** Point + range when there is no fitted deliveries model. */
export function fallbackFeeForKm(km: number, durationMin?: number | null) {
  const expectedMin = (km / FALLBACK.avgSpeedKmh) * 60;
  const mins = durationMin != null && Number.isFinite(durationMin) ? durationMin : expectedMin;
  const slowdown = Math.max(0, mins - expectedMin);
  const point = roundFee(
    FALLBACK.intercept + FALLBACK.kmRate * km + FALLBACK.slowdownRate * slowdown,
    FALLBACK.minUgx,
    FALLBACK.stepUgx,
  );
  const step = FALLBACK.stepUgx;
  let lo = Math.max(FALLBACK.minUgx, Math.floor((point - FALLBACK.padUgx) / step) * step);
  let hi = Math.max(lo + step, Math.ceil((point + FALLBACK.padUgx) / step) * step);
  if (point < lo) lo = Math.max(FALLBACK.minUgx, Math.floor(point / step) * step);
  if (point > hi) hi = Math.ceil(point / step) * step;
  if (hi - lo < step) hi = lo + step;
  return {
    point,
    range: { feeMinUgx: lo, feeMaxUgx: hi, feePointUgx: point } satisfies NonNullable<FeeRange>,
    predicted: hi,
  };
}

/** Sync estimate when Distance Matrix is unavailable (straight-line × 1.35). */
export function predictFeeForDest(
  dest: LatLng,
  origin: LatLng = BASE_ORIGIN,
  kmOverride?: number | null,
  durationMin?: number | null,
) {
  const straight = haversineKm(origin, dest);
  const km = kmOverride != null && kmOverride > 0 ? kmOverride : roadKmEstimate(straight);
  const model = deliveryModel.value;
  const opts = { durationMin: durationMin ?? null, dest, at: new Date() };
  const point = predictSafeBodaFee(km, model, opts) as number | null;
  const range = predictSafeBodaFeeRange(km, model, opts) as FeeRange;
  // Legacy checkout stores the range high end (feeMaxUgx), then the point.
  let predicted = range?.feeMaxUgx ?? point;
  let resolvedPoint = point;
  let resolvedRange = range;
  if (predicted == null) {
    const fallback = fallbackFeeForKm(km, durationMin);
    resolvedPoint = fallback.point;
    resolvedRange = fallback.range;
    predicted = fallback.predicted;
  }
  return { km, straightKm: straight, durationMin: durationMin ?? null, point: resolvedPoint, range: resolvedRange, predicted, model };
}

/** Driving km from Maps when the script loads; otherwise the haversine estimate. */
export async function quoteFeeForDest(dest: LatLng, origin: LatLng = BASE_ORIGIN) {
  if (!deliveryModelReady.value) await ensureDeliveryModel();
  const routed = await drivingRoute(origin, dest);
  return predictFeeForDest(dest, origin, routed?.km ?? null, routed?.durationMin ?? null);
}
