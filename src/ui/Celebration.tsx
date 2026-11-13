import { Button } from './Button';

/** The moment after a sale. A check and the amount, then one way back to the next client. */
export function Celebration({
  total,
  message,
  onNext,
}: {
  total: string;
  message: string;
  onNext: () => void;
}) {
  return (
    <section class="celebration">
      <div class="success-check" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="2.4">
          <path d="M5 12.5 9.2 17 19 7" />
        </svg>
      </div>
      <p class="success-total">{total}</p>
      <p class="celebration__message">{message}</p>
      <Button size="xl" onClick={onNext}>
        New sale
      </Button>
    </section>
  );
}
