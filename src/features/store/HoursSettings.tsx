import { DEFAULT_CLOSE, DEFAULT_OPEN, formatClockHHmm } from '../../domain/hours';
import { ClockField, TimePickerSheet } from '../../ui/ClockField';
import { Button } from '../../ui/Button';
import { busyDefaultUntil, minutesUntil, remainingLabel, type HoursState } from './use-fulfillment';

/** The existing Hours form: busy presets, Custom busy, Opens/Closes, delivery window. */
export function HoursSettings({ hours }: { hours: HoursState }) {
  const {
    status,
    busy,
    customOpen,
    setCustomOpen,
    saveHours,
    setBusyMinutes,
    setTime,
    tone,
    headline,
    detail,
    dirty,
    valid,
    suggest,
    busyNow,
  } = hours;

  return (
    <>
      <div class={`hours__hero hours__hero--${tone}`} data-testid="store-status" data-state={tone}>
        <span class="hours__dot" aria-hidden="true" />
        <div>
          <div class="hours__state">{headline}</div>
          <div class="hours__detail">{detail}</div>
        </div>
      </div>

      <h2 class="v-section-label">Busy</h2>
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
            <div class="hours__busy-left" data-testid="busy-remaining">
              {remainingLabel(status.busyUntil)}
            </div>
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
    </>
  );
}
