import { useEffect, useState } from 'preact/hooks';
import { copyText } from '../platform/clipboard';
import { IconCheck, IconCopy, IconPhone, IconPin } from './icons';

const KINDS = {
  phone: { Icon: IconPhone, ok: 'Phone copied', empty: 'No phone' },
  place: { Icon: IconPin, ok: 'Location copied', empty: 'No location' },
  all: { Icon: IconCopy, ok: 'Delivery details copied', empty: 'Nothing to copy' },
  text: { Icon: IconCopy, ok: 'Copied', empty: 'Nothing to copy' },
} as const;

/**
 * A labelled 44px pill that copies one thing: the phone (9 digits), the drop-off, or the whole
 * delivery block. There is no icon-only version. On compact cards the icon is left out to keep one row, and a tick appears on copy. The icon turns into a tick. No toast on success, the tick (and an optional done label) is the answer. Phone and location are bronze in the cart; on the store order sheet they follow the gray fields.
 */
export function CopyButton({
  kind,
  value,
  label,
  doneLabel,
  ariaLabel,
  testId,
  compact,
}: {
  kind: keyof typeof KINDS;
  /** Read at tap time, so a field that is still being typed in copies what is there. */
  value: () => string;
  label: string;
  /** Short confirmation, e.g. "Copied", shown in place of the label while the tick is up. */
  doneLabel?: string;
  ariaLabel?: string;
  testId?: string;
  compact?: boolean;
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
      class={`v-copy-btn v-copy-btn--${kind}${compact ? ' v-copy-btn--compact' : ''}${done ? ' is-done' : ''}`}
      aria-label={ariaLabel || label}
      data-testid={testId}
      onClick={() => void copyText(value(), ok, empty, true).then((copied) => setDone(copied))}
    >
      {!compact || done ? (
        <span class="v-copy-btn__icon" key={done ? 'done' : 'idle'}>
          {done ? <IconCheck size={16} /> : <Icon size={18} />}
        </span>
      ) : null}
      <span>{done && doneLabel ? doneLabel : label}</span>
    </button>
  );
}
