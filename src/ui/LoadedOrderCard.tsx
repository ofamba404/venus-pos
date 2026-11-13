import { Button } from './Button';
import { DeliveryCopyRow } from './DeliveryCopyRow';
import { Money } from './Money';
import { ConfirmButton, ConfirmedTag } from './ConfirmOrder';
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
  /** Has the store been told? Shows the green Confirmed tag and drops the Confirm pill. */
  confirmed?: boolean;
  /** Confirm pill. Resolves true on success. Left out where the order cannot be confirmed. */
  onConfirm?: () => Promise<boolean> | boolean | void;
  /**
   * Page variant (above the Sell grid) adds the phone, the copy pills and Unlink. The sheet variant is just the header.
   * There is no Review button: the floating cart bar's Review sale does that.
   */
  page?: boolean;
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
  confirmed = false,
  onConfirm,
  page = false,
  onUnlink,
  testId = 'loaded-order',
}: LoadedOrderCardProps) {
  return (
    <section class="v-loaded-order" data-testid={testId} data-mode={delivery ? 'delivery' : 'pickup'}>
      <div class="v-loaded-order__top">
        <span class="v-loaded-order__kicker">Store order</span>
        <span class="v-loaded-order__tags">
          <Tag tone={delivery ? 'bronze' : 'default'}>{delivery ? 'Delivery' : 'Pickup'}</Tag>
          {confirmed ? <ConfirmedTag testId={`${testId}-confirmed`} /> : null}
        </span>
      </div>
      <div class="v-loaded-order__name" data-testid={`${testId}-name`}>
        {name || 'Store order'}
      </div>
      <div class="v-loaded-order__meta">
        {itemCount} item{itemCount === 1 ? '' : 's'} · <Money className="v-money--total" value={total} />
        {delivery && timeLabel ? ` · ${timeLabel}` : ''}
      </div>
      {delivery && place ? (
        <div class="v-loaded-order__text" data-testid={`${testId}-place`}>
          {place}
        </div>
      ) : null}
      {page && phone ? <div class="v-loaded-order__text">{phone}</div> : null}
      {page ? (
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
      {onUnlink || (onConfirm && !confirmed) ? (
        <div class="v-loaded-order__actions">
          {onConfirm && !confirmed ? <ConfirmButton testId={`${testId}-confirm`} onConfirm={onConfirm} /> : null}
          {onUnlink ? (
            <Button size="md" variant="ghost" data-testid={`${testId}-unlink`} onClick={onUnlink}>
              Unlink
            </Button>
          ) : null}
        </div>
      ) : null}
      {onUnlink ? (
        <p class="v-loaded-order__hint" data-testid={`${testId}-unlink-hint`}>
          Unlink keeps these items. The order stays in Orders, not cancelled.
        </p>
      ) : null}
    </section>
  );
}
