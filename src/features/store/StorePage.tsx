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
import { Field } from '../../ui/Field';
import { formatClockHHmm, nextOpenAt } from '../../domain/hours';
import { Button } from '../../ui/Button';
import { showToast } from '../../ui/ToastHost';

export function StorePage() {
  const [status, setStatus] = useState<FulfillmentStatus>({
    openTime: DEFAULT_OPEN,
    closeTime: DEFAULT_CLOSE,
  });
  const [busy, setBusy] = useState(false);
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
        {busyNow ? (
          <Button size="md" variant="ghost" data-testid="busy-clear" disabled={busy} onClick={() => void setBusyMinutes(null)}>
            Clear busy
          </Button>
        ) : null}
      </div>

      <h2 class="v-section-label">Opening hours</h2>
      <div class="hours__grid">
        <Field
          label="Opens"
          type="time"
          data-testid="hours-open"
          value={status.openTime || ''}
          onInput={(e) => setTime('openTime', (e.target as HTMLInputElement).value)}
        />
        <Field
          label="Closes"
          type="time"
          data-testid="hours-close"
          value={status.closeTime || ''}
          onInput={(e) => setTime('closeTime', (e.target as HTMLInputElement).value)}
        />
      </div>

      <h2 class="v-section-label">Suggested delivery window</h2>
      <p class="v-muted hours__note">The time range the storefront nudges clients toward. Leave empty for none.</p>
      <div class="hours__grid">
        <Field
          label="From"
          type="time"
          data-testid="hours-suggest-start"
          value={status.suggestStart || ''}
          onInput={(e) => setTime('suggestStart', (e.target as HTMLInputElement).value)}
        />
        <Field
          label="To"
          type="time"
          data-testid="hours-suggest-end"
          value={status.suggestEnd || ''}
          onInput={(e) => setTime('suggestEnd', (e.target as HTMLInputElement).value)}
        />
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
