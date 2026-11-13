import { useEffect } from 'preact/hooks';
import { successCopy } from '../domain/parity';
import { formatUGX } from '../domain/format';
import { go, routeId } from '../app/router';
import { Button } from './Button';
import { Sheet } from './Sheet';
import { dismissSaleSuccess, saleSuccess } from './sale-success';

/**
 * What the cashier sees after a sale: a small sheet over wherever they were, with the amount and who it was for.
 * Done closes it and leaves them where they were. Log another sale takes them to the counter. The close button, a tap
 * on the scrim, Escape and a swipe down all close it too, so it never holds the screen.
 */
export function SaleSuccessSheet() {
  const info = saleSuccess.value;

  useEffect(() => {
    if (!info) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') dismissSaleSuccess();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [info?.id]);

  return (
    <Sheet
      open={info != null}
      title="Sale"
      onClose={dismissSaleSuccess}
      swipeBody
      footer={
        info ? (
          <div class="v-success-foot">
            <Button size="xl" data-testid="success-done" onClick={dismissSaleSuccess}>
              Done
            </Button>
            <Button
              size="md"
              variant="ghost"
              data-testid="success-another"
              onClick={() => {
                dismissSaleSuccess();
                if (routeId.value !== 'sell') go('/sell');
              }}
            >
              Log another sale
            </Button>
          </div>
        ) : null
      }
    >
      {info ? (
        <div class="v-success" data-testid="sale-success">
          <p class="v-success__label" data-testid="success-label">
            {successCopy({ queued: info.queued, credit: info.credit, savingDelivery: info.savingDelivery })}
          </p>
          <p class="v-success__total" data-testid="success-total">
            {formatUGX(info.total)}
          </p>
          <p class="v-success__client" data-testid="success-client">
            {info.client}
          </p>
        </div>
      ) : null}
    </Sheet>
  );
}
