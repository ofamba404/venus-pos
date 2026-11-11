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
  const predicted = range?.feeMaxUgx ?? point;
  return { km, straightKm: straight, durationMin: durationMin ?? null, point, range, predicted, model };
}

/** Driving km from Maps when the script loads; otherwise the haversine estimate. */
export async function quoteFeeForDest(dest: LatLng, origin: LatLng = BASE_ORIGIN) {
  const routed = await drivingRoute(origin, dest);
  return predictFeeForDest(dest, origin, routed?.km ?? null, routed?.durationMin ?? null);
}
