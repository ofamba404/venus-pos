import { useEffect, useRef, useState } from 'preact/hooks';
import { ensureInventory, inventoryFresh, type StoreOrderRow } from '../../data/entities';
import { checkoutStoreOrder } from '../../data/store-order-checkout';
import { mapStoreOrderToCart } from '../../domain/store-order-map';
import { cartTotal } from '../../domain/cart';
import { lineCount } from '../../domain/line-count';
import { copyLocationText, copyPhoneText } from '../../domain/delivery-copy';
import { itemsImageSlides } from '../../domain/product-art';
import { formatUGX } from '../../domain/format';
import { Button } from '../../ui/Button';
import { CopyButton } from '../../ui/CopyButton';
import { ConfirmButton, ConfirmedTag } from '../../ui/ConfirmOrder';
import { FlavorSwatches } from '../../ui/FlavorSwatches';
import { Money } from '../../ui/Money';
import { ProductGallery } from '../../ui/ProductGallery';
import { ReadPhone } from '../../ui/PhoneField';
import { Sheet } from '../../ui/Sheet';
import { Tag } from '../../ui/Tag';
import { showToast } from '../../ui/ToastHost';
import { saleSummaryLines } from '../../domain/sale-summary';
import { showSaleSuccess } from '../../ui/sale-success';
import { cancelStoreOrder } from './cancel-order';
import { CancelOrderConfirm } from './CancelOrderConfirm';
import { confirmStoreOrder, isOrderConfirmed } from './confirm-order';
import { storeOrderName } from '../../domain/store-order-review';
import { orderLine } from './order-view';

/** A labelled box like the cart's fields, but read only. Copy, when there is one, sits beside the box at the same height. */
function ReadField({ label, value, testId, copy }: { label: string; value: string; testId: string; copy?: preact.ComponentChildren }) {
  return (
    <div class="v-field v-so-field" data-testid={testId}>
      <span class="v-field__label">{label}</span>
      <div class="v-so-field__row">
        <div class="v-field__input v-field__input--ro" data-testid={`${testId}-value`} aria-readonly="true">
          {value}
        </div>
        {copy}
      </div>
    </div>
  );
}

/**
 * A client's storefront order, read only. It is not the cart: items, drop-off, phone and time are as the client
 * placed them. The delivery fee is an editable SafeBoda amount and is not part of the sale. Checkout records the items only.
 */
function StoreOrderBody({
  shown,
  order,
  title,
  queue,
  onClose,
  onSelect,
}: {
  shown: boolean;
  order: StoreOrderRow;
  title: string;
  queue: StoreOrderRow[];
  onClose: () => void;
  onSelect?: (id: string) => void;
}) {
  const mapped = mapStoreOrderToCart({ ...order, items: (order.items || []) as never }, { customerName: title });
  const raw = Array.isArray(order.items) ? order.items : [];
  const delivery = order.delivery_enabled !== false;
  const open = order.status !== 'cancelled' && order.status !== 'checked_out';
  const credit = order.is_credit === true;
  const [fee, setFee] = useState(order.delivery_fee_ugx != null ? String(Math.round(Number(order.delivery_fee_ugx) || 0)) : '');
  const [paying, setPaying] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [askCancel, setAskCancel] = useState(false);
  // Warm the stock read while the sheet is being read, so Checkout does not wait on it.
  useEffect(() => {
    if (open && !inventoryFresh()) void ensureInventory().catch(() => {});
  }, []);
  useEffect(() => {
    setFee(order.delivery_fee_ugx != null ? String(Math.round(Number(order.delivery_fee_ugx) || 0)) : '');
    setPaying(false);
    setCancelling(false);
    setAskCancel(false);
  }, [order.id]);

  const items = cartTotal(mapped.lines);
  const feeUgx = delivery && fee.trim() !== '' ? Math.max(0, parseInt(fee, 10) || 0) : 0;
  const phone = String(order.phone_e164 || order.phone || '');
  const place = delivery ? String(order.location_label || '') : '';
  const lat = order.location_lat;
  const lng = order.location_lng;
  const confirmed = isOrderConfirmed(order);
  const remaining = queue.filter((row) => row.id !== order.id && row.status !== 'checked_out' && row.status !== 'cancelled');

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
    const next = remaining[0];
    if (next && onSelect) onSelect(next.id);
    else onClose();
    showSaleSuccess(
      {
        total: items,
        client: title,
        credit,
        queued: Boolean(result.queued),
        lines: saleSummaryLines(mapped.lines),
        fulfilment: delivery ? 'delivery' : 'pickup',
      },
      result.delivery,
    );
    if (result.orderMarked) {
      void result.orderMarked.then((ok) => {
        if (!ok) showToast('Sale saved, but this order still shows as waiting. Check Orders.');
      });
    }
  }

  async function cancelSelected() {
    if (paying || cancelling) return;
    setCancelling(true);
    const result = await cancelStoreOrder(order.id);
    setCancelling(false);
    setAskCancel(false);
    if (!result.ok) {
      showToast(result.error);
      return;
    }
    showToast(`Cancelled ${title}`);
    const next = remaining[0];
    if (next && onSelect) onSelect(next.id);
    else onClose();
  }

  const footer = open ? (
    <div class="v-so-foot">
      <button
        type="button"
        class="v-so-foot__cancel"
        data-testid="store-order-cancel"
        aria-label="Cancel order"
        disabled={paying || cancelling}
        onClick={() => setAskCancel(true)}
      >
        Cancel
      </button>
      <Button size="xl" data-testid="store-order-checkout" loading={paying} onClick={() => void checkout()}>
        {`Checkout ${formatUGX(items)}`}
      </Button>
    </div>
  ) : null;

  const preface = queue.length > 1 ? (
    <div class="so-queue" data-testid="store-order-queue">
      {queue.map((row) => (
        <button
          type="button"
          key={row.id}
          class={`so-queue__chip${row.id === order.id ? ' is-active' : ''}`}
          data-testid={`store-order-chip-${row.id}`}
          aria-pressed={row.id === order.id}
          onClick={() => (row.id !== order.id && onSelect ? onSelect(row.id) : undefined)}
        >
          {storeOrderName(row)}
        </button>
      ))}
    </div>
  ) : null;

  const lead = (
    <div class="v-so__tags">
      <Tag tone={delivery ? 'bronze' : 'default'}>{delivery ? 'Delivery' : 'Pickup'}</Tag>
      {confirmed ? <ConfirmedTag testId="store-order-confirmed" /> : null}
      {order.status === 'cancelled' ? <Tag tone="danger">Cancelled</Tag> : null}
    </div>
  );

  return (
    <>
    <Sheet open={shown} title={title} titleTestId="store-order-name" preface={preface} lead={lead} swapKey={order.id} onClose={onClose} footer={footer}>
      <div class="v-so" data-testid="store-order-sheet" data-mode={delivery ? 'delivery' : 'pickup'}>
        {open && !confirmed ? (
          <div class="v-so__top">
            <ConfirmButton testId="store-order-confirm" onConfirm={() => confirmStoreOrder(order.id)} />
          </div>
        ) : null}

        <section class="v-so-sec" aria-label="Items">
          <h3 class="v-so-sec__label">Items</h3>
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
        </section>

        {place || phone || delivery ? (
          <section class="v-so-sec" aria-label={delivery ? 'Delivery details' : 'Pickup details'}>
            <h3 class="v-so-sec__label">{delivery ? 'Delivery details' : 'Pickup details'}</h3>
            <div class="v-so-details">
              {place ? (
                <ReadField
                  label="Drop-off"
                  value={place}
                  testId="so-place"
                  copy={
                    <CopyButton kind="place" label="Copy" doneLabel="Copied" ariaLabel="Copy drop-off" compact testId="so-copy-place" value={() => copyLocationText({ place, lat, lng })} />
                  }
                />
              ) : null}
              {phone ? (
                <ReadPhone
                  value={phone}
                  testId="so-phone"
                  copy={<CopyButton kind="phone" label="Copy" doneLabel="Copied" ariaLabel="Copy phone" compact testId="so-copy-phone" value={() => copyPhoneText(phone)} />}
                />
              ) : null}
              {delivery ? (
                open ? (
                  <label class="v-field" data-testid="store-order-fee-field">
                    <span class="v-field__label">Delivery fee (UGX)</span>
                    <input
                      class="v-field__input"
                      inputMode="numeric"
                      data-testid="store-order-fee"
                      value={fee}
                      placeholder="0"
                      onInput={(e) => setFee((e.target as HTMLInputElement).value.replace(/[^0-9]/g, ''))}
                    />
                  </label>
                ) : (
                  <div class="v-field" data-testid="store-order-fee-field">
                    <span class="v-field__label">Delivery fee</span>
                    <div class="v-field__input v-field__input--ro" data-testid="store-order-fee-value">
                      {formatUGX(feeUgx)}
                    </div>
                  </div>
                )
              ) : null}
            </div>
          </section>
        ) : null}

        <section class="v-so-sec v-so-totals" aria-label="Total">
          <h3 class="v-so-sec__label">Total</h3>
          <div class="v-so-totals__row v-so-totals__row--total" data-testid="store-order-total" data-total={items}>
            <span>Total</span>
            <Money className="v-money--total" value={items} size="xl" />
          </div>
          {credit ? (
            <div class="v-so-pay" data-testid="store-order-pay">
              <Tag tone="credit">On credit</Tag>
            </div>
          ) : null}
        </section>
      </div>
    </Sheet>
    <CancelOrderConfirm
      open={askCancel}
      clientName={title}
      busy={cancelling}
      onKeep={() => setAskCancel(false)}
      onConfirm={() => void cancelSelected()}
    />
    </>
  );
}

export function StoreOrderSheet({
  order,
  title,
  queue = [],
  onClose,
  onSelect,
}: {
  order: StoreOrderRow | null;
  title: string;
  queue?: StoreOrderRow[];
  onClose: () => void;
  onSelect?: (id: string) => void;
}) {
  // Keep the last order while the sheet slides away, so it does not blank mid-close.
  const last = useRef<{ order: StoreOrderRow; title: string; queue: StoreOrderRow[] } | null>(null);
  if (order) last.current = { order, title, queue };
  const held = last.current;
  if (!held) return null;
  return (
    <StoreOrderBody
      shown={Boolean(order)}
      order={held.order}
      title={held.title}
      queue={order ? queue : held.queue}
      onClose={onClose}
      onSelect={onSelect}
    />
  );
}
