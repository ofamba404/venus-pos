import { formatUGX } from './format';
import { localPhoneDigits } from './phone';

export type DeliveryCopyInput = {
  name?: string | null;
  phone?: string | null;
  place?: string | null;
  lat?: number | string | null;
  lng?: number | string | null;
  /** Money still to collect at the door: pay on delivery, or a sale on credit. */
  collect?: number | null;
};

function finiteCoord(value: number | string | null | undefined): number | null {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** A Google Maps link for a drop-off pin, or '' when the order has no coordinates. */
export function mapsLink(lat: number | string | null | undefined, lng: number | string | null | undefined): string {
  const a = finiteCoord(lat);
  const b = finiteCoord(lng);
  if (a == null || b == null) return '';
  return `https://www.google.com/maps/search/?api=1&query=${a},${b}`;
}

/** The drop-off text exactly as typed, then the map link on its own line when there is a pin. */
export function copyLocationText(input: Pick<DeliveryCopyInput, 'place' | 'lat' | 'lng'>): string {
  const place = String(input.place || '').trim();
  const link = mapsLink(input.lat, input.lng);
  return [place, link].filter(Boolean).join('\n');
}

/** Nine digits, no country code. This is what SafeBoda asks for. */
export function copyPhoneText(phone: string | null | undefined): string {
  return localPhoneDigits(phone);
}

/**
 * A short block to paste into a SafeBoda note or chat. Lines with nothing to say are left out:
 *
 *   Name: Bartholomew Nakimuli
 *   Phone: 700333444
 *   Drop-off: Plot 14 Acacia Avenue, Kololo, Kampala
 *   Map: https://www.google.com/maps/search/?api=1&query=0.33,32.59
 *   Collect: UGX 55,000
 */
export function copyAllText(input: DeliveryCopyInput): string {
  const lines: string[] = [];
  const name = String(input.name || '').trim();
  const phone = copyPhoneText(input.phone);
  const place = String(input.place || '').trim();
  const link = mapsLink(input.lat, input.lng);
  const collect = Math.round(Number(input.collect) || 0);
  if (name) lines.push(`Name: ${name}`);
  if (phone) lines.push(`Phone: ${phone}`);
  if (place) lines.push(`Drop-off: ${place}`);
  if (link) lines.push(`Map: ${link}`);
  if (collect > 0) lines.push(`Collect: ${formatUGX(collect)}`);
  return lines.join('\n');
}
