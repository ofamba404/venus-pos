import { useEffect, useState } from 'preact/hooks';
import {
  DEFAULT_CLOSE,
  DEFAULT_OPEN,
  busyUntilFromNow,
  isBusyActive,
  isWithinOpenHours,
  fulfillmentFromSnapshot,
  toHHmm,
  type FulfillmentStatus,
} from '../../domain/hours';
import { sbFetch } from '../../data/api';
import { KEYS } from '../../data/keys';
import { patchFulfillment } from '../../data/writes/store';
import { ClockField, TimePickerSheet } from '../../ui/ClockField';
import { formatClockHHmm, nextOpenAt } from '../../domain/hours';
import { Button } from '../../ui/Button';
import { showToast } from '../../ui/ToastHost';

/** "42 min left", "1 h 5 min left". */
function remainingLabel(untilIso: string | null | undefined): string {
  const ms = untilIso ? new Date(untilIso).getTime() - Date.now() : 0;
  const total = Math.max(1, Math.ceil(ms / 60_000));
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${h ? `${h} h ` : ''}${m || !h ? `${m} min` : ''} left`.replace(/\s+/g, ' ').trim();
}

/** The next time of day on a 15-minute mark, an hour from now: where the Busy until wheels start. */
function busyDefaultUntil(): string {
  const d = new Date(Date.now() + 60 * 60_000);
  d.setMinutes(Math.ceil(d.getMinutes() / 15) * 15, 0, 0);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** Whole minutes from now to the next HH:mm. A time that has already passed today means tomorrow. */
function minutesUntil(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number) as [number, number];
  const target = new Date();
  target.setHours(h, m, 0, 0);
  if (target.getTime() <= Date.now() + 60_000) target.setDate(target.getDate() + 1);
  return Math.max(1, Math.ceil((target.getTime() - Date.now()) / 60_000));
}

export function StorePage() {
  const [status, setStatus] = useState<FulfillmentStatus>({
    openTime: DEFAULT_OPEN,
    closeTime: DEFAULT_CLOSE,
  });
  const [busy, setBusy] = useState(false);
  const [customOpen, setCustomOpen] = useState(false);
  // Re-read the clock so the remaining busy time counts down while the page is open.
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setTick((t) => t + 1), 30_000);
    return () => window.clearInterval(id);
  }, []);
  // What the server last had, so Save only lights up when something changed.
  const [saved, setSaved] = useState<FulfillmentStatus | null>(null);

  function remember(next: FulfillmentStatus) {
    setStatus(next);
    setSaved(next);
    try {
      localStorage.setItem(KEYS.fulfillment, JSON.stringify(next));
    } catch {
      /* private mode */
    }
  }

  useEffect(() => {
    try {
      const snap = fulfillmentFromSnapshot(JSON.parse(localStorage.getItem(KEYS.fulfillment) || 'null'));
      if (snap) setStatus(snap);
    } catch {
      /* corrupt snapshot */
    }
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
          suggestStart: toHHmm(row.suggest_start),
          suggestEnd: toHHmm(row.suggest_end),
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
        suggest_start: status.suggestStart,
        suggest_end: status.suggestEnd,
      });
      if (!res.ok) throw new Error(`Could not save hours (${res.status})`);
      setSaved(status);
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
        try {
          localStorage.setItem(KEYS.fulfillment, JSON.stringify(next));
        } catch {
          /* private mode */
        }
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
  const tone = busyNow ? 'busy' : openNow ? 'open' : 'closed';
  const headline = busyNow ? 'Busy' : openNow ? 'Open now' : 'Closed';
  const detail = busyNow
    ? `Back to normal at ${new Date(status.busyUntil!).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`
    : openNow
      ? `Closes at ${formatClockHHmm(status.closeTime || DEFAULT_CLOSE)}`
      : `Opens ${nextOpenAt(now, status).toDateString() === now.toDateString() ? 'today' : 'tomorrow'} at ${formatClockHHmm(status.openTime || DEFAULT_OPEN)}`;
  const dirty =
    !saved ||
    saved.openTime !== status.openTime ||
    saved.closeTime !== status.closeTime ||
    (saved.suggestStart || '') !== (status.suggestStart || '') ||
    (saved.suggestEnd || '') !== (status.suggestEnd || '');
  const valid = Boolean(status.openTime && status.closeTime);
  const suggest =
    status.suggestStart && status.suggestEnd
      ? `${formatClockHHmm(status.suggestStart)} to ${formatClockHHmm(status.suggestEnd)}`
      : 'Not set';

  function setTime(key: 'openTime' | 'closeTime' | 'suggestStart' | 'suggestEnd', value: string) {
    setStatus((s) => ({ ...s, [key]: value || null }));
  }

  return (
    <section class="hours" data-testid="hours-page">
      <h1 class="page-title">Hours &amp; availability</h1>

      <div class={`hours__hero hours__hero--${tone}`} data-testid="store-status" data-state={tone}>
        <span class="hours__dot" aria-hidden="true" />
        <div>
          <div class="hours__state">{headline}</div>
          <div class="hours__detail">{detail}</div>
        </div>
      </div>

      <h2 class="v-section-label">Busy</h2>
      <p class="v-muted hours__note">Pauses new delivery and pickup times for a while. Clients see the next free time.</p>
      <div class="v-chip-row hours__busy">
        {[15, 30, 60].map((minutes) => (
          <Button
            key={minutes}
            size="md"
            variant="secondary"
            data-testid={`busy-${minutes}`}
            disabled={busy}
            onClick={() => void setBusyMinutes(minutes)}
          >
            {minutes === 60 ? '1 hour' : `${minutes} min`}
          </Button>
        ))}
        <Button size="md" variant="secondary" data-testid="busy-custom" disabled={busy} onClick={() => setCustomOpen(true)}>
          Custom
        </Button>
      </div>
      {busyNow ? (
        <div class="hours__busy-now" data-testid="busy-active">
          <div>
            <div class="hours__busy-left" data-testid="busy-remaining">{remainingLabel(status.busyUntil)}</div>
            <div class="v-muted">
              Back to normal at {new Date(status.busyUntil!).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
            </div>
          </div>
          <Button size="md" variant="secondary" data-testid="busy-clear" disabled={busy} onClick={() => void setBusyMinutes(null)}>
            Clear
          </Button>
        </div>
      ) : null}
      <TimePickerSheet
        open={customOpen}
        title="Busy until"
        value=""
        fallback={busyDefaultUntil()}
        setLabel="Set busy"
        onCancel={() => setCustomOpen(false)}
        onSet={(hhmm) => {
          setCustomOpen(false);
          void setBusyMinutes(minutesUntil(hhmm));
        }}
      />

      <h2 class="v-section-label">Opening hours</h2>
      <div class="hours__grid">
        <ClockField label="Opens" testId="hours-open" value={status.openTime || ''} onChange={(v) => setTime('openTime', v)} />
        <ClockField label="Closes" testId="hours-close" value={status.closeTime || ''} onChange={(v) => setTime('closeTime', v)} />
      </div>

      <h2 class="v-section-label">Suggested delivery window</h2>
      <p class="v-muted hours__note">The time range the storefront nudges clients toward. Leave empty for none.</p>
      <div class="hours__grid">
        <ClockField label="From" testId="hours-suggest-start" value={status.suggestStart || ''} onChange={(v) => setTime('suggestStart', v)} />
        <ClockField label="To" testId="hours-suggest-end" value={status.suggestEnd || ''} onChange={(v) => setTime('suggestEnd', v)} />
      </div>

      <div class="hours__preview" data-testid="hours-preview">
        <div class="v-list-row__meta">Clients see</div>
        <div>
          Open {formatClockHHmm(status.openTime || DEFAULT_OPEN)} to {formatClockHHmm(status.closeTime || DEFAULT_CLOSE)}
        </div>
        <div>Suggested delivery: {suggest}</div>
      </div>

      <Button size="lg" data-testid="hours-save" disabled={busy || !dirty || !valid} onClick={() => void saveHours()}>
        {busy ? 'Saving…' : dirty ? 'Save hours' : 'Saved'}
      </Button>
    </section>
  );
}
