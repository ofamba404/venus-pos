import { useEffect, useState } from 'preact/hooks';
import {
  DEFAULT_CLOSE,
  DEFAULT_OPEN,
  busyUntilFromNow,
  formatClockHHmm,
  fulfillmentFromSnapshot,
  isBusyActive,
  isWithinOpenHours,
  nextOpenAt,
  toHHmm,
  type FulfillmentStatus,
} from '../../domain/hours';
import { sbFetch } from '../../data/api';
import { KEYS } from '../../data/keys';
import { patchFulfillment } from '../../data/writes/store';
import { showToast } from '../../ui/ToastHost';

export type StoreTone = 'open' | 'busy' | 'closed';

/** "42 min left", "1 h 5 min left". */
export function remainingLabel(untilIso: string | null | undefined): string {
  const ms = untilIso ? new Date(untilIso).getTime() - Date.now() : 0;
  const total = Math.max(1, Math.ceil(ms / 60_000));
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${h ? `${h} h ` : ''}${m || !h ? `${m} min` : ''} left`.replace(/\s+/g, ' ').trim();
}

/** The next time of day on a 15-minute mark, an hour from now: where the Busy until wheels start. */
export function busyDefaultUntil(): string {
  const d = new Date(Date.now() + 60 * 60_000);
  d.setMinutes(Math.ceil(d.getMinutes() / 15) * 15, 0, 0);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** Whole minutes from now to the next HH:mm. A time that has already passed today means tomorrow. */
export function minutesUntil(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number) as [number, number];
  const target = new Date();
  target.setHours(h, m, 0, 0);
  if (target.getTime() <= Date.now() + 60_000) target.setDate(target.getDate() + 1);
  return Math.max(1, Math.ceil((target.getTime() - Date.now()) / 60_000));
}

function persist(next: FulfillmentStatus) {
  try {
    localStorage.setItem(KEYS.fulfillment, JSON.stringify(next));
  } catch {
    /* private mode */
  }
}

/** Shared Hours state: snapshot first, then the live store_fulfillment row. */
export function useFulfillment() {
  const [status, setStatus] = useState<FulfillmentStatus>(() => {
    try {
      return (
        fulfillmentFromSnapshot(JSON.parse(localStorage.getItem(KEYS.fulfillment) || 'null')) || {
          openTime: DEFAULT_OPEN,
          closeTime: DEFAULT_CLOSE,
        }
      );
    } catch {
      return { openTime: DEFAULT_OPEN, closeTime: DEFAULT_CLOSE };
    }
  });
  const [busy, setBusy] = useState(false);
  const [customOpen, setCustomOpen] = useState(false);
  const [, setTick] = useState(0);
  const [saved, setSaved] = useState<FulfillmentStatus | null>(null);

  useEffect(() => {
    const id = window.setInterval(() => setTick((t) => t + 1), 30_000);
    return () => window.clearInterval(id);
  }, []);

  function remember(next: FulfillmentStatus) {
    setStatus(next);
    setSaved(next);
    persist(next);
  }

  useEffect(() => {
    void (async () => {
      try {
        const res = await sbFetch('store_fulfillment?select=*&limit=1');
        if (!res.ok) return;
        const rows = (await res.json()) as Array<Record<string, unknown>>;
        const row = rows[0];
        if (!row) return;
        remember({
          openTime: toHHmm(row.open_time) || DEFAULT_OPEN,
          closeTime: toHHmm(row.close_time) || DEFAULT_CLOSE,
          busyUntil: row.busy_until ? String(row.busy_until) : null,
          busyFor: (row.busy_for as FulfillmentStatus['busyFor']) || 'both',
        });
      } catch {
        /* offline / missing table */
      }
    })();
  }, []);

  async function saveHours() {
    setBusy(true);
    try {
      const res = await patchFulfillment({
        open_time: status.openTime,
        close_time: status.closeTime,
      });
      if (!res.ok) throw new Error(`Could not save hours (${res.status})`);
      setSaved(status);
      persist(status);
      showToast('Hours saved');
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Could not save hours');
    } finally {
      setBusy(false);
    }
  }

  async function setBusyMinutes(minutes: number | null) {
    setBusy(true);
    try {
      const until = minutes === null ? null : busyUntilFromNow(minutes);
      const res = await patchFulfillment({
        busy_until: until,
        busy_for: minutes === null ? null : 'both',
      });
      if (!res.ok) throw new Error(`Could not update busy (${res.status})`);
      setStatus((current) => {
        const next = {
          ...current,
          busyUntil: until,
          busyFor: minutes === null ? undefined : ('both' as const),
        };
        persist(next);
        return next;
      });
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Could not update busy');
    } finally {
      setBusy(false);
    }
  }

  const now = new Date();
  const openNow = isWithinOpenHours(now, status);
  const busyNow = isBusyActive(status);
  const tone: StoreTone = busyNow ? 'busy' : openNow ? 'open' : 'closed';
  const word = busyNow ? 'Busy' : openNow ? 'Open' : 'Closed';
  const headline = busyNow ? 'Busy' : openNow ? 'Open now' : 'Closed';
  const detail = busyNow
    ? `Back to normal at ${new Date(status.busyUntil!).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`
    : openNow
      ? `Closes at ${formatClockHHmm(status.closeTime || DEFAULT_CLOSE)}`
      : `Opens ${nextOpenAt(now, status).toDateString() === now.toDateString() ? 'today' : 'tomorrow'} at ${formatClockHHmm(status.openTime || DEFAULT_OPEN)}`;
  const dirty = !saved || saved.openTime !== status.openTime || saved.closeTime !== status.closeTime;
  const valid = Boolean(status.openTime && status.closeTime);

  function setTime(key: 'openTime' | 'closeTime', value: string) {
    setStatus((s) => ({ ...s, [key]: value || null }));
  }

  return {
    status,
    busy,
    customOpen,
    setCustomOpen,
    saveHours,
    setBusyMinutes,
    setTime,
    tone,
    word,
    headline,
    detail,
    dirty,
    valid,
    busyNow,
  };
}

export type HoursState = ReturnType<typeof useFulfillment>;
