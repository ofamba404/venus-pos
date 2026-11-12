/** Pure fulfillment / hours helpers — port of `legacy/js/fulfillment.js` (no cache). */

export type BusyFor = 'delivery' | 'pickup' | 'both';

export type FulfillmentStatus = {
  busyUntil?: string | null;
  busyFor?: BusyFor;
  suggestStart?: string | null;
  suggestEnd?: string | null;
  openTime?: string | null;
  closeTime?: string | null;
  updatedAt?: string | null;
};

export const DEFAULT_OPEN = '07:00';
export const DEFAULT_CLOSE = '22:00';

function pad2(n: number) {
  return String(n).padStart(2, '0');
}

/** Postgres `time` / ISO → HH:mm */
export function toHHmm(value: unknown): string | null {
  if (value == null || value === '') return null;
  const raw = String(value);
  const m = raw.match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  return `${pad2(Number(m[1]))}:${pad2(Number(m[2]))}`;
}

function parseMinutes(hhmm: string | null | undefined) {
  const v = toHHmm(hhmm);
  if (!v) return null;
  const [h, m] = v.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

function minutesOfDay(date: Date) {
  return date.getHours() * 60 + date.getMinutes();
}

export function isBusyActive(
  status: FulfillmentStatus | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!status?.busyUntil) return false;
  const until = new Date(status.busyUntil);
  return Number.isFinite(until.getTime()) && until.getTime() > now.getTime();
}

export function hasBusyUntil(status: FulfillmentStatus | null | undefined): boolean {
  return Boolean(status?.busyUntil);
}

export function isWithinOpenHours(
  at: Date | string | number,
  status: FulfillmentStatus | null | undefined = {},
): boolean {
  const when = at instanceof Date ? at : new Date(at);
  if (!Number.isFinite(when.getTime())) return true;
  const open = parseMinutes(status?.openTime || DEFAULT_OPEN);
  const close = parseMinutes(status?.closeTime || DEFAULT_CLOSE);
  if (open == null || close == null) return true;
  if (open === close) return true;
  const mins = minutesOfDay(when);
  if (open < close) return mins >= open && mins < close;
  return mins >= open || mins < close;
}

export function nextOpenAt(
  from: Date = new Date(),
  status: FulfillmentStatus | null | undefined = {},
): Date {
  const d = new Date(from);
  if (!Number.isFinite(d.getTime())) return new Date();
  if (isWithinOpenHours(d, status)) return d;

  const openMins = parseMinutes(status?.openTime || DEFAULT_OPEN) ?? 7 * 60;
  const openH = Math.floor(openMins / 60);
  const openM = openMins % 60;

  const todayOpen = new Date(d);
  todayOpen.setHours(openH, openM, 0, 0);
  if (todayOpen.getTime() > d.getTime() && isWithinOpenHours(todayOpen, status)) {
    return todayOpen;
  }

  const tomorrowOpen = new Date(d);
  tomorrowOpen.setDate(tomorrowOpen.getDate() + 1);
  tomorrowOpen.setHours(openH, openM, 0, 0);
  return tomorrowOpen;
}

function roundUpToStep(date: Date, stepMinutes = 5) {
  const d = new Date(date);
  const mins = d.getMinutes();
  const stepped = Math.ceil(mins / stepMinutes) * stepMinutes;
  if (stepped === 60) d.setHours(d.getHours() + 1, 0, 0, 0);
  else d.setMinutes(stepped, 0, 0);
  return d;
}

function appliesToMode(status: FulfillmentStatus | null | undefined, deliveryEnabled?: boolean) {
  const busyFor = status?.busyFor || 'both';
  if (busyFor === 'both') return true;
  if (busyFor === 'delivery') return deliveryEnabled !== false;
  if (busyFor === 'pickup') return deliveryEnabled === false;
  return true;
}

export function earliestAvailableAt(
  from: Date | string = new Date(),
  opts: {
    deliveryEnabled?: boolean;
    status?: FulfillmentStatus;
    stepMinutes?: number;
  } = {},
): Date {
  const status = opts.status || {};
  const deliveryEnabled = opts.deliveryEnabled;
  let t = new Date(from);
  if (!Number.isFinite(t.getTime())) t = new Date();

  if (isBusyActive(status, t) && appliesToMode(status, deliveryEnabled)) {
    const until = new Date(status.busyUntil!);
    if (t.getTime() < until.getTime()) t = new Date(until);
  }

  // Busy is applied once above. A later open-hours step cannot enter a new busy
  // window, because busyUntil is a single instant and next open is later.
  for (let i = 0; i < 3; i += 1) {
    if (isWithinOpenHours(t, status)) break;
    t = nextOpenAt(t, status);
  }

  return roundUpToStep(t, opts.stepMinutes ?? 5);
}

export function isUnavailableAt(
  deliverAt: string | Date,
  opts: {
    deliveryEnabled?: boolean;
    now?: Date;
    status?: FulfillmentStatus;
  } = {},
): boolean {
  const status = opts.status || {};
  const at = deliverAt instanceof Date ? deliverAt : new Date(deliverAt);
  if (!Number.isFinite(at.getTime())) return false;
  if (!isWithinOpenHours(at, status)) return true;
  if (!isBusyActive(status, opts.now || new Date())) return false;
  if (!appliesToMode(status, opts.deliveryEnabled)) return false;
  return at.getTime() < new Date(status.busyUntil!).getTime();
}

export function formatClockHHmm(hhmm: string | null | undefined): string {
  const [h, m] = String(hhmm || '').split(':').map(Number);
  const d = new Date();
  d.setHours(Number.isFinite(h) ? (h as number) : 0, Number.isFinite(m) ? (m as number) : 0, 0, 0);
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

export function busyUntilFromNow(minutes: number, now: Date = new Date()): string {
  const d = new Date(now);
  d.setMinutes(d.getMinutes() + Math.max(1, Number(minutes) || 0), 0, 0);
  return d.toISOString();
}

/** Last store-hours snapshot (`venus.pos.fulfillment`). Corrupt blobs are ignored. */
export function fulfillmentFromSnapshot(raw: unknown): FulfillmentStatus | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  const busyRaw = row.busyFor ?? row.busy_for;
  const busyFor: BusyFor =
    busyRaw === 'delivery' || busyRaw === 'pickup' || busyRaw === 'both' ? busyRaw : 'both';
  const updated = row.updatedAt ?? row.updated_at;
  return {
    busyUntil: row.busyUntil ? String(row.busyUntil) : row.busy_until ? String(row.busy_until) : null,
    busyFor,
    suggestStart: toHHmm(row.suggestStart ?? row.suggest_start),
    suggestEnd: toHHmm(row.suggestEnd ?? row.suggest_end),
    openTime: toHHmm(row.openTime ?? row.open_time) || DEFAULT_OPEN,
    closeTime: toHHmm(row.closeTime ?? row.close_time) || DEFAULT_CLOSE,
    updatedAt: updated ? String(updated) : null,
  };
}
