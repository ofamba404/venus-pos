import { useEffect, useState } from 'preact/hooks';
import { copyText } from '../platform/clipboard';
import { IconCheck, IconPhone, IconPin } from './icons';

const KINDS = {
  phone: { Icon: IconPhone, ok: 'Phone copied', empty: 'No phone' },
  place: { Icon: IconPin, ok: 'Location copied', empty: 'No location' },
} as const;

/**
 * A 44px tinted tap target that copies a phone number (mint) or a place (melon).
 * The icon turns into a tick for a moment so the tap is felt. With `label` it
 * becomes a tinted pill that says what it copies.
 */
export function CopyButton({
  kind,
  value,
  label,
  ariaLabel,
  testId,
}: {
  kind: keyof typeof KINDS;
  /** Read at tap time, so a field that is still being typed in copies what is there. */
  value: () => string;
  label?: string;
  ariaLabel: string;
  testId?: string;
}) {
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!done) return;
    const timer = window.setTimeout(() => setDone(false), 1400);
    return () => window.clearTimeout(timer);
  }, [done]);
  const { Icon, ok, empty } = KINDS[kind];
  return (
    <button
      type="button"
      class={`v-copy-btn v-copy-btn--${kind}${label ? ' v-copy-btn--pill' : ''}${done ? ' is-done' : ''}`}
      aria-label={ariaLabel}
      data-testid={testId}
      onClick={() => void copyText(value(), ok, empty).then((copied) => setDone(copied))}
    >
      <span class="v-copy-btn__icon" key={done ? 'done' : 'idle'}>
        {done ? <IconCheck size={20} /> : <Icon size={20} />}
      </span>
      {label ? <span>{label}</span> : null}
    </button>
  );
}
