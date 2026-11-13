import { useRef, useState } from 'preact/hooks';
import type { StoreOrderRow } from '../../data/entities';
import { checkoutStoreOrder } from '../../data/store-order-checkout';
import { mapStoreOrderToCart } from '../../domain/store-order-map';
import { cartTotal } from '../../domain/cart';
import { lineCount } from '../../domain/line-count';
import { copyAllText, copyLocationText, copyPhoneText } from '../../domain/delivery-copy';
import { itemsImageSlides } from '../../domain/product-art';
import { formatUGX } from '../../domain/format';
import { Button } from '../../ui/Button';
import { CopyButton } from '../../ui/CopyButton';
import { ConfirmButton, ConfirmedTag } from '../../ui/ConfirmOrder';
import { FlavorSwatches } from '../../ui/FlavorSwatches';
import { Money } from '../../ui/Money';
import { ProductGallery } from '../../ui/ProductGallery';
import { Sheet } from '../../ui/Sheet';
import { Tag } from '../../ui/Tag';
import { showToast } from '../../ui/ToastHost';
import { confirmStoreOrder, isOrderConfirmed } from './confirm-order';
import { orderLine } from './order-view';

function deliverAtText(order: StoreOrderRow): string {
  const delivery = order.delivery || {};
  const label = String(delivery.label || '').trim();
  if (label) return label;
  const at = String(delivery.deliverAt || '').trim();
  if (!at) return '';
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return at;
  return date.toLocaleString('en-GB', {
    timeZone: 'Africa/Kampala',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

function DetailRow({ label, value, testId, copy }: { label: string; value: string; testId: string; copy: preact.ComponentChildren }) {
  return (
    <div class="v-so-detail" data-testid={testId}>
      <div class="v-so-detail__text">
        <span class="v-so-detail__label">{label}</span>
        <span class="v-so-detail__value" data-testid={`${testId}-value`}>
          {value}
        </span>
      </div>
      {copy}
    </div>
  );
}

/**
 * A client's storefront order, read only. It is not the cart: items, drop-off, phone and time are as the client
 * placed them. The delivery fee is the one editable field. Checkout records the sale from the order.
 */
function StoreOrderBody({
  shown,
  order,
  title,
  onClose,
  onCancel,
}: {
  shown: boolean;
  order: StoreOrderRow;
  title: string;
  onClose: () => void;
  onCancel: (order: StoreOrderRow) => Promise<void> | void;
}) {
  const mapped = mapStoreOrderToCart({ ...order, items: (order.items || []) as never }, { customerName: title });
  const raw = Array.isArray(order.items) ? order.items : [];
  const delivery = order.delivery_enabled !== false;
  const open = order.status !== 'cancelled' && order.status !== 'checked_out';
  const credit = order.is_credit === true;
  const [fee, setFee] = useState(order.delivery_fee_ugx != null ? String(Math.round(Number(order.delivery_fee_ugx) || 0)) : '');
  const [paying, setPaying] = useState(false);
  const [armed, setArmed] = useState(false);

  const items = cartTotal(mapped.lines);
  const feeUgx = delivery && fee.trim() !== '' ? Math.max(0, parseInt(fee, 10) || 0) : 0;
  const total = items + feeUgx;
  const phone = String(order.phone_e164 || order.phone || '');
  const place = delivery ? String(order.location_label || '') : '';
  const when = deliverAtText(order);
  const lat = order.location_lat;
  const lng = order.location_lng;
  const km = order.delivery_distance_km != null ? Number(order.delivery_distance_km) : null;
  const mins = order.delivery_duration_min != null ? Number(order.delivery_duration_min) : null;
  const confirmed = isOrderConfirmed(order);

  async function checkout() {
    if (paying) return;
    setPaying(true);
    const result = await checkoutStoreOrder(order, {
      customerName: title,
      feeUgx: delivery && fee.trim() !== '' ? feeUgx : null,
      isCredit: credit,
    });
    setPaying(false);
    if (!result.ok) {
      if (!('cancelled' in result && result.cancelled)) showToast(result.error);
      return;
    }
    showToast(result.queued ? 'Queued offline' : `Sale recorded · ${formatUGX(items)}`);
    onClose();
  }

  const footer = open ? (
    <div class="v-so-foot">
      <Button size="xl" data-testid="store-order-checkout" disabled={paying} onClick={() => void checkout()}>
        {paying ? 'Saving…' : `Checkout ${formatUGX(total)}`}
      </Button>
      <Button
        size="md"
        variant="ghost"
        data-testid="store-order-cancel"
        onClick={() => {
          if (!armed) {
            setArmed(true);
            return;
          }
          void Promise.resolve(onCancel(order)).then(onClose);
        }}
      >
        {armed ? 'Tap again to cancel this order' : 'Cancel order'}
      </Button>
    </div>
  ) : null;

  return (
    <Sheet open={shown} title="Store order" onClose={onClose} footer={footer}>
      <div class="v-so" data-testid="store-order-sheet" data-mode={delivery ? 'delivery' : 'pickup'}>
        <div class="v-so__top">
          <div class="v-so__name" data-testid="store-order-name">
            {title}
          </div>
          <div class="v-so__tags">
            <Tag tone={delivery ? 'bronze' : 'default'}>{delivery ? 'Delivery' : 'Pickup'}</Tag>
            {confirmed ? <ConfirmedTag testId="store-order-confirmed" /> : null}
            {order.status === 'cancelled' ? <Tag tone="danger">Cancelled</Tag> : null}
            {order.status === 'checked_out' ? <Tag tone="paid">Paid</Tag> : null}
          </div>
        </div>

        <div class="v-so__items" data-testid="store-order-items">
          {mapped.lines.map((line, index) => {
            const view = orderLine(raw[index]);
            const { qty, contents } = lineCount(line);
            return (
              <div class="v-cart-line" key={line.key}>
                <ProductGallery slides={itemsImageSlides([view])} size={64} testId="so-gallery" />
                <div class="v-cart-line__main">
                  <div class="v-cart-line__head">
                    <div class="v-list-row__title">
                      {line.name}
                      {qty > 1 ? <span class="v-qty-inline">×{qty}</span> : null}
                    </div>
                    <Money className="v-money--total" value={line.isReward ? 0 : line.lineTotal} />
                  </div>
                  {contents ? <div class="v-cart-line__contents">{contents}</div> : null}
                  <FlavorSwatches breakdown={view.breakdown} productId={view.productId} />
                </div>
              </div>
            );
          })}
        </div>

        <div class="v-so-details">
          {place ? (
            <DetailRow
              label="Drop-off"
              value={place}
              testId="so-place"
              copy={
                <CopyButton kind="place" label="Copy" ariaLabel="Copy drop-off" compact testId="so-copy-place" value={() => copyLocationText({ place, lat, lng })} />
              }
            />
          ) : null}
          {phone ? (
            <DetailRow
              label="Phone"
              value={phone}
              testId="so-phone"
              copy={<CopyButton kind="phone" label="Copy" ariaLabel="Copy phone" compact testId="so-copy-phone" value={() => copyPhoneText(phone)} />}
            />
          ) : null}
          {when ? (
            <DetailRow
              label={delivery ? 'Deliver at' : 'Pick up at'}
              value={when}
              testId="so-when"
              copy={<CopyButton kind="text" label="Copy" ariaLabel="Copy time" compact testId="so-copy-when" value={() => when} />}
            />
          ) : null}
          <div class="v-so-detail__all">
            <CopyButton
              kind="all"
              label="Copy all"
              compact
              testId="so-copy-all"
              // A store order records no paid flag, so Collect is left out unless the order itself is on credit.
              value={() => copyAllText({ name: title, phone, place, lat, lng, collect: credit ? total : 0 })}
            />
          </div>
          {delivery && km != null ? (
            <p class="v-muted" data-testid="so-distance">
              {km.toFixed(1)} km{mins != null ? ` · ~${Math.round(mins)} min` : ''}
            </p>
          ) : null}
        </div>

        <div class="v-so-totals">
          <div class="v-so-totals__row">
            <span>Items</span>
            <Money value={items} />
          </div>
          {delivery ? (
            <label class="v-so-totals__row">
              <span>Delivery fee</span>
              {open ? (
                <input
                  class="v-so-fee"
                  inputMode="numeric"
                  data-testid="store-order-fee"
                  aria-label="Delivery fee (UGX)"
                  value={fee}
                  placeholder="0"
                  onInput={(e) => setFee((e.target as HTMLInputElement).value.replace(/[^0-9]/g, ''))}
                />
              ) : (
                <Money value={feeUgx} />
              )}
            </label>
          ) : null}
          <div class="v-so-totals__row v-so-totals__row--total" data-testid="store-order-total" data-total={total}>
            <span>Total</span>
            <Money className="v-money--total" value={total} size="xl" />
          </div>
          <div class="v-so-pay" data-testid="store-order-pay">
            {credit ? <Tag tone="credit">On credit</Tag> : open ? <span class="v-muted">Recorded as paid at checkout</span> : null}
          </div>
        </div>

        {open && !confirmed ? (
          <ConfirmButton testId="store-order-confirm" onConfirm={() => confirmStoreOrder(order.id)} />
        ) : null}
      </div>
    </Sheet>
  );
}

export function StoreOrderSheet({
  order,
  title,
  onClose,
  onCancel,
}: {
  order: StoreOrderRow | null;
  title: string;
  onClose: () => void;
  onCancel: (order: StoreOrderRow) => Promise<void> | void;
}) {
  // Keep the last order while the sheet slides away, so it does not blank mid-close.
  const last = useRef<{ order: StoreOrderRow; title: string } | null>(null);
  if (order) last.current = { order, title };
  const held = last.current;
  if (!held) return null;
  return (
    <StoreOrderBody key={held.order.id} shown={Boolean(order)} order={held.order} title={held.title} onClose={onClose} onCancel={onCancel} />
  );
}
