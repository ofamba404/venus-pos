import { Button } from './Button';
import { CopyButton } from './CopyButton';
import { Money } from './Money';
import { Tag } from './Tag';

export type LoadedOrderCardProps = {
  name: string;
  delivery: boolean;
  timeLabel?: string;
  place?: string;
  phone?: string;
  itemCount: number;
  total: number;
  /** Page variant adds Review and Unlink. The sheet variant is just the header. */
  onReview?: () => void;
  onUnlink?: () => void;
  testId?: string;
};

/**
 * Says "this cart is a store order being fulfilled": who it is for, how it is going out,
 * where, and what it is worth. Sits above the Sell grid on a phone and at the top of the cart.
 */
export function LoadedOrderCard({
  name,
  delivery,
  timeLabel,
  place,
  phone,
  itemCount,
  total,
  onReview,
  onUnlink,
  testId = 'loaded-order',
}: LoadedOrderCardProps) {
  return (
    <section class="v-loaded-order" data-testid={testId} data-mode={delivery ? 'delivery' : 'pickup'}>
      <div class="v-loaded-order__top">
        <span class="v-loaded-order__kicker">Store order</span>
        <Tag tone={delivery ? 'paid' : 'default'}>{delivery ? 'Delivery' : 'Pickup'}</Tag>
      </div>
      <div class="v-loaded-order__name" data-testid={`${testId}-name`}>
        {name || 'Store order'}
      </div>
      <div class="v-loaded-order__meta">
        {itemCount} item{itemCount === 1 ? '' : 's'} · <Money className="v-money--amber" value={total} />
        {delivery && timeLabel ? ` · ${timeLabel}` : ''}
      </div>
      {delivery && place ? (
        <div class="v-loaded-order__row">
          <span class="v-loaded-order__text" data-testid={`${testId}-place`}>
            {place}
          </span>
          {onReview ? (
            <CopyButton kind="place" ariaLabel="Copy order location" testId={`${testId}-copy-location`} value={() => place} />
          ) : null}
        </div>
      ) : null}
      {onReview && phone ? (
        <div class="v-loaded-order__row">
          <span class="v-loaded-order__text">{phone}</span>
          <CopyButton kind="phone" ariaLabel="Copy order phone" testId={`${testId}-copy-phone`} value={() => phone} />
        </div>
      ) : null}
      {onReview || onUnlink ? (
        <div class="v-loaded-order__actions">
          {onReview ? (
            <Button size="md" data-testid={`${testId}-review`} onClick={onReview}>
              Review order
            </Button>
          ) : null}
          {onUnlink ? (
            <Button size="md" variant="ghost" data-testid={`${testId}-unlink`} onClick={onUnlink}>
              Unlink
            </Button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
