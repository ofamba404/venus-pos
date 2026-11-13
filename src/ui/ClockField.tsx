import { useEffect, useRef, useState } from 'preact/hooks';
import { fromWheelParts, toWheelParts } from '../domain/clock';
import { formatClockHHmm } from '../domain/hours';
import { Button } from './Button';
import { Sheet } from './Sheet';

const ROW = 44;
const HOURS = Array.from({ length: 12 }, (_, i) => ({ value: i + 1, text: String(i + 1) }));
const BASE_MINUTES = [0, 15, 30, 45];
const MERIDIEMS = [
  { value: 0, text: 'AM', id: 'am' },
  { value: 1, text: 'PM', id: 'pm' },
];

function pad(n: number) {
  return String(n).padStart(2, '0');
}

function reducedMotion(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

/**
 * One scroll-snap wheel. Scrolling settles on a row and picks it. A tap picks a row and centres it. Up and Down move the pick.
 * Rows are real radio buttons, so a screen reader and the keyboard get the same list.
 */
function Wheel({
  label,
  items,
  value,
  onPick,
  testPrefix,
}: {
  label: string;
  items: Array<{ value: number; text: string; id?: string }>;
  value: number;
  onPick: (value: number) => void;
  testPrefix: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const lockUntil = useRef(0);
  const timer = useRef<number | undefined>(undefined);
  const index = Math.max(0, items.findIndex((i) => i.value === value));

  function centre(i: number, smooth: boolean) {
    const el = ref.current;
    if (!el) return;
    lockUntil.current = Date.now() + 450;
    window.clearTimeout(timer.current);
    el.scrollTo({ top: i * ROW, behavior: smooth && !reducedMotion() ? 'smooth' : 'auto' });
  }

  useEffect(() => {
    centre(index, false);
    // Only on open. Later picks centre themselves.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function onScroll() {
    if (Date.now() < lockUntil.current) return;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      const el = ref.current;
      if (!el) return;
      const i = Math.max(0, Math.min(items.length - 1, Math.round(el.scrollTop / ROW)));
      const next = items[i]!;
      if (next.value !== value) onPick(next.value);
    }, 90);
  }

  function pick(i: number) {
    const target = items[Math.max(0, Math.min(items.length - 1, i))]!;
    onPick(target.value);
    centre(items.indexOf(target), true);
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      pick(index + (e.key === 'ArrowDown' ? 1 : -1));
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      pick(e.key === 'Home' ? 0 : items.length - 1);
    }
  }

  return (
    <div class="v-wheel" data-testid={`${testPrefix}-wheel`}>
      <div
        class="v-wheel__list"
        role="radiogroup"
        aria-label={label}
        ref={ref}
        onScroll={onScroll}
        onKeyDown={onKey}
      >
        {items.map((item, i) => (
          <button
            key={item.value}
            type="button"
            role="radio"
            aria-checked={item.value === value}
            tabIndex={item.value === value ? 0 : -1}
            class={`v-wheel__item${item.value === value ? ' is-on' : ''}`}
            data-testid={`${testPrefix}-${item.id ?? item.value}`}
            onClick={() => pick(i)}
          >
            {item.text}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * Our own time picker, in our own bottom sheet. Three scroll-snap wheels (hour 1 to 12, minute 00/15/30/45, AM/PM) under a large
 * readout of the time you are setting. Cancel leaves things as they were. Value is "HH:mm" (24-hour). No native time input.
 */
export function TimePickerSheet({
  open,
  title,
  value,
  fallback,
  onCancel,
  onSet,
  onClear,
  setLabel = 'Set',
}: {
  open: boolean;
  title: string;
  value: string;
  fallback?: string;
  onCancel: () => void;
  onSet: (value: string) => void;
  onClear?: () => void;
  setLabel?: string;
}) {
  const start = toWheelParts(value, fallback);
  const [hour, setHour] = useState(start.hour);
  const [minute, setMinute] = useState(start.minute);
  const [pm, setPm] = useState(start.pm);
  // Re-seed each time the sheet opens, from the value it was opened with.
  const wasOpen = useRef(false);
  if (open && !wasOpen.current) {
    wasOpen.current = true;
    if (hour !== start.hour) setHour(start.hour);
    if (minute !== start.minute) setMinute(start.minute);
    if (pm !== start.pm) setPm(start.pm);
  }
  if (!open && wasOpen.current) wasOpen.current = false;

  const minutes = (BASE_MINUTES.includes(minute) ? BASE_MINUTES : [...BASE_MINUTES, minute].sort((a, b) => a - b)).map((x) => ({
    value: x,
    text: pad(x),
  }));
  const chosen = fromWheelParts(hour, minute, pm);
  return (
    <Sheet
      open={open}
      title={title}
      onClose={onCancel}
      footer={
        <div class="v-clock__foot">
          <Button variant="ghost" size="xl" data-testid="clock-cancel" onClick={onCancel}>
            Cancel
          </Button>
          {onClear && value ? (
            <Button variant="secondary" size="xl" data-testid="clock-clear" onClick={onClear}>
              Clear
            </Button>
          ) : null}
          <Button variant="primary" size="xl" data-testid="clock-done" onClick={() => onSet(chosen)}>
            {setLabel}
          </Button>
        </div>
      }
    >
      <div class="v-clock" data-testid="clock-sheet">
        <div class="v-clock__readout" aria-live="polite" data-testid="clock-readout">
          <span class="v-clock__digits">
            {hour}:{pad(minute)}
          </span>
          <span class="v-clock__ampm">{pm ? 'PM' : 'AM'}</span>
        </div>
        <div class="v-clock__wheels">
          <div class="v-clock__band" aria-hidden="true" />
          <Wheel label="Hour" testPrefix="clock-hour" value={hour} onPick={setHour} items={HOURS} />
          <Wheel label="Minute" testPrefix="clock-minute" value={minute} onPick={setMinute} items={minutes} />
          <Wheel label="AM or PM" testPrefix="clock-ampm" value={pm} onPick={setPm} items={MERIDIEMS} />
        </div>
      </div>
    </Sheet>
  );
}

/** A time of day as a tappable chip that opens the sheet above. Value is "HH:mm" or "" for not set. */
export function ClockField({
  label,
  value,
  onChange,
  testId,
  allowClear = true,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  testId: string;
  allowClear?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div class="v-field v-clock-field">
      <span class="v-field__label">{label}</span>
      <button
        type="button"
        class={`v-clock__chip${value ? '' : ' is-empty'}`}
        data-testid={testId}
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
      >
        {value ? formatClockHHmm(value) : 'Not set'}
      </button>
      <TimePickerSheet
        open={open}
        title={label}
        value={value}
        onCancel={() => setOpen(false)}
        onSet={(next) => {
          onChange(next);
          setOpen(false);
        }}
        onClear={
          allowClear
            ? () => {
                onChange('');
                setOpen(false);
              }
            : undefined
        }
      />
    </div>
  );
}
