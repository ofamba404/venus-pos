import { Button } from '../../ui/Button';
import { Sheet } from '../../ui/Sheet';

export function cancelOrderQuestion(name: string): string {
  const n = name.trim();
  return n ? `Cancel ${n}'s order?` : 'Cancel this order?';
}

/** Compact "are you sure" sheet used by order cards and the review-sheet footer. No helper copy. */
export function CancelOrderConfirm({
  open,
  clientName,
  busy = false,
  onKeep,
  onConfirm,
}: {
  open: boolean;
  clientName: string;
  busy?: boolean;
  onKeep: () => void;
  onConfirm: () => void;
}) {
  return (
    <Sheet open={open} title={cancelOrderQuestion(clientName)} onClose={onKeep} footer={
      <div class="v-cancel-ask">
        <Button size="xl" variant="ghost" data-testid="cancel-order-keep" onClick={onKeep}>
          Keep
        </Button>
        <Button size="xl" variant="danger" data-testid="cancel-order-confirm" loading={busy} onClick={onConfirm}>
          Cancel order
        </Button>
      </div>
    }>
      <div class="v-cancel-ask__body" />
    </Sheet>
  );
}
