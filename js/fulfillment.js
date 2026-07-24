/**
 * Storefront pickup/delivery availability — POS writes, store reads.
 * Singleton row in public.store_fulfillment (id = 'default').
 *
 * Busy window (busy_until) + daily open/close hours.
 * Default open 07:00–22:00 (closed 22:00–07:00 overnight).
 */
import { sbFetch } from './api.js';

const ROW_ID = 'default';
const DEFAULT_OPEN = '07:00';
const DEFAULT_CLOSE = '22:00';

/** @typedef {'both' | 'delivery' | 'pickup'} BusyFor */

/**
 * @typedef {object} FulfillmentStatus
 * @property {string|null} busyUntil ISO timestamptz or null
 * @property {BusyFor} busyFor
 * @property {string|null} suggestStart HH:mm or null
 * @property {string|null} suggestEnd HH:mm or null
 * @property {string} openTime HH:mm
 * @property {string} closeTime HH:mm
 * @property {string|null} updatedAt
 */

/** @type {FulfillmentStatus} */
const EMPTY = {
  busyUntil: null,
  busyFor: 'both',
  suggestStart: null,
  suggestEnd: null,
  openTime: DEFAULT_OPEN,
  closeTime: DEFAULT_CLOSE,
  updatedAt: null,
};

/** @type {FulfillmentStatus} */
let cache = { ...EMPTY };
/** Bumped on successful save so in-flight loads cannot overwrite fresher cache. */
let mutationEpoch = 0;
/** @type {Array<(s: FulfillmentStatus) => void>} */
const listeners = [];

function pad2(n) {
  return String(n).padStart(2, '0');
}

/** Postgres `time` / ISO → HH:mm */
export function toHHmm(value) {
  if (value == null || value === '') return null;
  const raw = String(value);
  const m = raw.match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  return `${pad2(Number(m[1]))}:${pad2(Number(m[2]))}`;
}

function parseMinutes(hhmm) {
  const v = toHHmm(hhmm);
  if (!v) return null;
  const [h, m] = v.split(':').map(Number);
  return h * 60 + m;
}

function minutesOfDay(date) {
  return date.getHours() * 60 + date.getMinutes();
}

function normalizeRow(row) {
  if (!row || typeof row !== 'object') return { ...EMPTY };
  const busyFor = row.busy_for;
  return {
    busyUntil: row.busy_until ? String(row.busy_until) : null,
    busyFor:
      busyFor === 'delivery' || busyFor === 'pickup' || busyFor === 'both'
        ? busyFor
        : 'both',
    suggestStart: toHHmm(row.suggest_start),
    suggestEnd: toHHmm(row.suggest_end),
    openTime: toHHmm(row.open_time) || DEFAULT_OPEN,
    closeTime: toHHmm(row.close_time) || DEFAULT_CLOSE,
    updatedAt: row.updated_at ? String(row.updated_at) : null,
  };
}

function notify() {
  listeners.forEach((fn) => {
    try {
      fn(cache);
    } catch {
      /* ignore */
    }
  });
}

export function getFulfillmentStatus() {
  return { ...cache };
}

export function onFulfillmentChange(fn) {
  if (typeof fn !== 'function') return () => {};
  listeners.push(fn);
  return () => {
    const i = listeners.indexOf(fn);
    if (i >= 0) listeners.splice(i, 1);
  };
}

export function isBusyActive(status = cache, now = new Date()) {
  if (!status?.busyUntil) return false;
  const until = new Date(status.busyUntil);
  return Number.isFinite(until.getTime()) && until.getTime() > now.getTime();
}

/** True when a busy_until timestamp is stored (active or expired leftover). */
export function hasBusyUntil(status = cache) {
  return Boolean(status?.busyUntil);
}

/**
 * Open window: [openTime, closeTime). Supports overnight open when open > close.
 * Default 07:00–22:00 ⇒ closed 22:00–07:00.
 */
export function isWithinOpenHours(at, status = cache) {
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

export function nextOpenAt(from = new Date(), status = cache) {
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

function roundUpToStep(date, stepMinutes = 5) {
  const d = new Date(date);
  const mins = d.getMinutes();
  const stepped = Math.ceil(mins / stepMinutes) * stepMinutes;
  if (stepped === 60) {
    d.setHours(d.getHours() + 1, 0, 0, 0);
  } else {
    d.setMinutes(stepped, 0, 0);
  }
  return d;
}

/**
 * Earliest time a customer can book from `from` (busy + daily closed).
 * @param {Date|string} [from]
 * @param {{ deliveryEnabled?: boolean, status?: FulfillmentStatus, stepMinutes?: number }} [opts]
 */
export function earliestAvailableAt(from = new Date(), opts = {}) {
  const status = opts.status || cache;
  const deliveryEnabled = opts.deliveryEnabled;
  let t = new Date(from);
  if (!Number.isFinite(t.getTime())) t = new Date();

  if (isBusyActive(status, t) && appliesToMode(status, deliveryEnabled)) {
    const until = new Date(status.busyUntil);
    if (t.getTime() < until.getTime()) t = new Date(until);
  }

  for (let i = 0; i < 3; i += 1) {
    if (!isWithinOpenHours(t, status)) {
      t = nextOpenAt(t, status);
    }
    if (isBusyActive(status, t) && appliesToMode(status, deliveryEnabled)) {
      const until = new Date(status.busyUntil);
      if (t.getTime() < until.getTime()) {
        t = new Date(until);
        continue;
      }
    }
    break;
  }

  return roundUpToStep(t, opts.stepMinutes ?? 5);
}

function appliesToMode(status, deliveryEnabled) {
  const busyFor = status?.busyFor || 'both';
  if (busyFor === 'both') return true;
  if (busyFor === 'delivery') return deliveryEnabled !== false;
  if (busyFor === 'pickup') return deliveryEnabled === false;
  return true;
}

/**
 * @param {string|Date} deliverAt
 * @param {{ deliveryEnabled?: boolean, now?: Date, status?: FulfillmentStatus }} [opts]
 */
export function isUnavailableAt(deliverAt, opts = {}) {
  const status = opts.status || cache;
  const at = deliverAt instanceof Date ? deliverAt : new Date(deliverAt);
  if (!Number.isFinite(at.getTime())) return false;
  if (!isWithinOpenHours(at, status)) return true;
  if (!isBusyActive(status, opts.now || new Date())) return false;
  if (!appliesToMode(status, opts.deliveryEnabled)) return false;
  return at.getTime() < new Date(status.busyUntil).getTime();
}

/** Time-only label; adds “tomorrow” when not today — never weekday. */
export function formatUntilClock(isoOrDate, now = new Date()) {
  if (!isoOrDate) return '';
  try {
    const d = new Date(isoOrDate);
    if (!Number.isFinite(d.getTime())) return '';
    const time = d.toLocaleTimeString(undefined, {
      hour: 'numeric',
      minute: '2-digit',
    });
    const startToday = new Date(now);
    startToday.setHours(0, 0, 0, 0);
    const startTomorrow = new Date(startToday);
    startTomorrow.setDate(startTomorrow.getDate() + 1);
    const startDayAfter = new Date(startTomorrow);
    startDayAfter.setDate(startDayAfter.getDate() + 1);
    if (d >= startTomorrow && d < startDayAfter) return `${time} tomorrow`;
    return time;
  } catch {
    return '';
  }
}

export function formatBusyUntilLabel(status = cache) {
  if (!isBusyActive(status)) return '';
  return formatUntilClock(status.busyUntil);
}

export function formatOpenHoursLabel(status = cache) {
  const fmt = (hhmm) => {
    const [h, m] = String(hhmm || '').split(':').map(Number);
    const d = new Date();
    d.setHours(h || 0, m || 0, 0, 0);
    return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  };
  return `${fmt(status.openTime || DEFAULT_OPEN)} – ${fmt(status.closeTime || DEFAULT_CLOSE)}`;
}

export function formatSuggestRangeLabel(status = cache) {
  const start = status?.suggestStart;
  const end = status?.suggestEnd;
  if (!start && !end) return '';
  const fmt = (hhmm) => {
    const [h, m] = String(hhmm).split(':').map(Number);
    const d = new Date();
    d.setHours(h || 0, m || 0, 0, 0);
    return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  };
  if (start && end) return `${fmt(start)} – ${fmt(end)}`;
  if (start) return `from ${fmt(start)}`;
  return `until ${fmt(end)}`;
}

export async function loadFulfillmentStatus() {
  const epoch = mutationEpoch;
  const res = await sbFetch(`store_fulfillment?id=eq.${ROW_ID}&select=*`, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Could not load availability (${res.status})${detail ? `: ${detail}` : ''}`);
  }
  const rows = await res.json();
  // A save completed while we were in flight — keep the local cache.
  if (epoch !== mutationEpoch) return getFulfillmentStatus();
  cache = normalizeRow(Array.isArray(rows) ? rows[0] : null);
  notify();
  return getFulfillmentStatus();
}

/**
 * @param {{
 *   busyUntil?: string|null,
 *   busyFor?: BusyFor,
 *   suggestStart?: string|null,
 *   suggestEnd?: string|null,
 *   openTime?: string|null,
 *   closeTime?: string|null,
 * }} patch
 */
export async function saveFulfillmentStatus(patch = {}) {
  const next = {
    busy_until:
      patch.busyUntil === undefined
        ? cache.busyUntil
        : patch.busyUntil
          ? new Date(patch.busyUntil).toISOString()
          : null,
    busy_for: patch.busyFor ?? cache.busyFor ?? 'both',
    suggest_start:
      patch.suggestStart === undefined ? cache.suggestStart : toHHmm(patch.suggestStart),
    suggest_end: patch.suggestEnd === undefined ? cache.suggestEnd : toHHmm(patch.suggestEnd),
    open_time:
      patch.openTime === undefined
        ? cache.openTime || DEFAULT_OPEN
        : toHHmm(patch.openTime) || DEFAULT_OPEN,
    close_time:
      patch.closeTime === undefined
        ? cache.closeTime || DEFAULT_CLOSE
        : toHHmm(patch.closeTime) || DEFAULT_CLOSE,
    updated_at: new Date().toISOString(),
  };

  const res = await sbFetch(`store_fulfillment?id=eq.${ROW_ID}`, {
    method: 'PATCH',
    headers: {
      Prefer: 'return=representation',
      Accept: 'application/json',
    },
    body: JSON.stringify(next),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Could not save availability (${res.status})${detail ? `: ${detail}` : ''}`);
  }
  const rows = await res.json();
  if (!Array.isArray(rows) || !rows.length) {
    throw new Error('Could not save availability: no row updated');
  }
  mutationEpoch += 1;
  cache = normalizeRow(rows[0]);
  notify();
  return getFulfillmentStatus();
}

/** @param {number} minutes */
export function busyUntilFromNow(minutes) {
  const d = new Date();
  d.setMinutes(d.getMinutes() + Math.max(1, Number(minutes) || 0), 0, 0);
  return d.toISOString();
}

/** datetime-local value from ISO / Date */
export function toDatetimeLocalValue(isoOrDate) {
  const d = isoOrDate ? new Date(isoOrDate) : new Date();
  if (!Number.isFinite(d.getTime())) return '';
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}
