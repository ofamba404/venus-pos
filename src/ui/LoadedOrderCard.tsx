import { Button } from './Button';
import { DeliveryCopyRow } from './DeliveryCopyRow';
import { Money } from './Money';
import { Tag } from './Tag';

export type LoadedOrderCardProps = {
  name: string;
  delivery: boolean;
  timeLabel?: string;
  place?: string;
  phone?: string;
  lat?: number | null;
  lng?: number | null;
  /** Money still to collect at the door. */
  collect?: number | null;
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
  lat,
  lng,
  collect,
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
        <Tag tone={delivery ? 'amber' : 'default'}>{delivery ? 'Delivery' : 'Pickup'}</Tag>
      </div>
      <div class="v-loaded-order__name" data-testid={`${testId}-name`}>
        {name || 'Store order'}
      </div>
      <div class="v-loaded-order__meta">
        {itemCount} item{itemCount === 1 ? '' : 's'} · <Money className="v-money--amber" value={total} />
        {delivery && timeLabel ? ` · ${timeLabel}` : ''}
      </div>
      {delivery && place ? (
        <div class="v-loaded-order__text" data-testid={`${testId}-place`}>
          {place}
        </div>
      ) : null}
      {onReview && phone ? <div class="v-loaded-order__text">{phone}</div> : null}
      {onReview ? (
        <DeliveryCopyRow
          delivery={delivery}
          name={name}
          phone={phone}
          place={place}
          lat={lat}
          lng={lng}
          collect={collect}
          idPrefix={`${testId}-copy-`}
        />
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
