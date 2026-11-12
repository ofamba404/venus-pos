/** Small geo helpers for delivery distance (Kampala shop origin). */

export type LatLng = { lat: number; lng: number };

/** Pine Valley Apartments · Kikoni — same as legacy `delivery-test-routes.js` (from 2026-10-14). */
export const BASE_ORIGIN: LatLng & { label: string; shortLabel: string } = {
  label: 'Pine Valley Apartments, Kikoni, 8HJ6+9V5, Kampala',
  shortLabel: 'Pine Valley Apartments · Kikoni',
  lat: 0.3308808,
  lng: 32.562232,
};

const EARTH_KM = 6371;

function toRad(deg: number) {
  return (deg * Math.PI) / 180;
}

/** Pickup for a delivery row. Missing GPS uses the shop, including store-order carts. */
export function resolveDeliveryOrigin(origin?: { lat?: number | null; lng?: number | null; label?: string | null } | null): {
  lat: number;
  lng: number;
  label: string;
} {
  const lat = Number(origin?.lat);
  const lng = Number(origin?.lng);
  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    return { lat, lng, label: origin?.label || 'GPS pickup' };
  }
  return { lat: BASE_ORIGIN.lat, lng: BASE_ORIGIN.lng, label: BASE_ORIGIN.label };
}

/** Great-circle km between two WGS84 points. */
export function haversineKm(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Rough road-distance factor used when Distance Matrix is unavailable. */
export function roadKmEstimate(straightKm: number): number {
  return Math.max(0, Number(straightKm) || 0) * 1.35;
}
