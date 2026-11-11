/** Small geo helpers for delivery distance (Kampala shop origin). */

export type LatLng = { lat: number; lng: number };

/** Prisca Honey · Zoa Hostel — same as legacy `delivery-test-routes.js`. */
export const BASE_ORIGIN: LatLng & { label: string; shortLabel: string } = {
  label: 'Prisca Honey Enterprises, Zoa Hostel, Kampala',
  shortLabel: 'Prisca Honey · Zoa Hostel',
  lat: 0.3397125,
  lng: 32.5703906,
};

const EARTH_KM = 6371;

function toRad(deg: number) {
  return (deg * Math.PI) / 180;
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
