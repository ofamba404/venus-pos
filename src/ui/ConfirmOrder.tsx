import { useState } from 'preact/hooks';
import { Button } from './Button';
import { IconCheck } from './icons';

/** Green means done. This is the status tag an order wears once the store has been told. */
export function ConfirmedTag({ testId }: { testId?: string }) {
  return (
    <span class="v-tag v-tag--paid v-tag--confirmed" data-testid={testId}>
      <IconCheck size={14} />
      Confirmed
    </span>
  );
}

/** The Confirm pill. It is the primary action while an order is waiting, and busy while the write runs. */
export function ConfirmButton({
  onConfirm,
  testId,
}: {
  onConfirm: () => Promise<boolean> | boolean | void;
  testId?: string;
}) {
  const [busy, setBusy] = useState(false);
  async function run() {
    if (busy) return;
    setBusy(true);
    try {
      await onConfirm();
    } finally {
      setBusy(false);
    }
  }
  return (
    <Button size="md" className="v-btn--block" data-testid={testId} disabled={busy} onClick={() => void run()}>
      <IconCheck size={18} />
      {busy ? 'Confirming…' : 'Confirm'}
    </Button>
  );
}
