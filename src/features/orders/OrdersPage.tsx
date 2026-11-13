import { useEffect, useState } from 'preact/hooks';
import { loadStoreOrders, storeOrders, ensureInventory, type StoreOrderRow } from '../../data/entities';
import { deviceId } from '../../data/device-id';
import { postStoreReserve } from '../../data/store-reserve';
import { mapStoreOrderToCart } from '../../domain/store-order-map';
import { orderMeta, replaceCart, setOrderMetaPatch } from '../../data/session-cart';
import { replaceCheckoutDraft } from '../../data/checkout-draft';
import { patchStoreOrder } from '../../data/writes/store-orders';
import { requestCartOpen } from '../../data/cart-request';
import { go } from '../../app/router';
import { Button } from '../../ui/Button';
import { Tag } from '../../ui/Tag';
import { Segmented } from '../../ui/Segmented';
import { showToast } from '../../ui/ToastHost';
import { itemsImageSlides } from '../../domain/product-art';
import { EmptyState } from '../../ui/EmptyState';
import { OrderCard } from '../../ui/OrderCard';
import { DeliveryCopyRow } from '../../ui/DeliveryCopyRow';
import { KEYS } from '../../data/keys';
import { ConfirmButton, ConfirmedTag } from '../../ui/ConfirmOrder';
import { confirmStoreOrder, isOrderConfirmed } from './confirm-order';
import { orderSegment, type OrderSegment } from '../../domain/order-segment';
import { writePaint } from '../../domain/parity';
import { SUPABASE_ANON_JWT, SUPABASE_URL } from '../../data/env';
import {
  buildPosLabelIndex,
  labelsAreStale,
  posCustomerLabel,
  POS_LABEL_STALE_MS,
  type PosLabelIndex,
  type PosLabelRow,
} from '../../domain/pos-labels';

type Segment = OrderSegment;

let posLabels: PosLabelIndex = buildPosLabelIndex([]);
let posLabelsAt = 0;

async function loadPosLabels(now = Date.now()) {
  if (!labelsAreStale(posLabelsAt, now, POS_LABEL_STALE_MS)) return posLabels;
  const res = await fetch(`${SUPABASE_URL}/functions/v1/store-auth`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_ANON_JWT,
      Authorization: `Bearer ${SUPABASE_ANON_JWT}`,
    },
    body: JSON.stringify({ action: 'admin_list_pos_labels' }),
  });
  const data = (await res.json().catch(() => ({}))) as { labels?: PosLabelRow[]; users?: PosLabelRow[] };
  const rows = Array.isArray(data.labels) ? data.labels : Array.isArray(data.users) ? data.users : [];
  posLabels = buildPosLabelIndex(rows);
  posLabelsAt = Date.now();
  return posLabels;
}

function orderTitle(o: StoreOrderRow, labels: PosLabelIndex) {
  return posCustomerLabel(
    {
      account_id: (o as { account_id?: string }).account_id,
      customer_name: o.customer_name,
      pos_display_name: (o as { pos_display_name?: string }).pos_display_name,
    },
    labels,
    'Store order',
  );
}

function orderLine(raw: unknown): { name: string; productId?: string; breakdown?: Record<string, unknown> } {
  if (!raw || typeof raw !== 'object') return { name: '' };
  const item = raw as {
    product_id?: string;
    store_product_id?: string;
    product_name?: string;
    name?: string;
    breakdown?: Record<string, unknown>;
    flavors?: string[];
  };
  const productId = String(item.product_id || item.store_product_id || '')
    .replace(/-/g, '_')
    .replace(/_pack$/, '');
  let breakdown = item.breakdown;
  if ((!breakdown || !Object.keys(breakdown).length) && Array.isArray(item.flavors)) {
    breakdown = {};
    for (const flavor of item.flavors) {
      const key = String(flavor).replace(/-/g, '_');
      const id = productId.startsWith('cookie') && !key.startsWith('cookie') ? `cookie_${key}` : key;
      breakdown[id] = (Number(breakdown[id]) || 0) + 1;
    }
  }
  return { name: String(item.product_name || item.name || '').trim(), productId, breakdown };
}

function orderTotal(o: StoreOrderRow): number {
  const items = Array.isArray(o.items) ? o.items : [];
  return items.reduce<number>((sum, it) => {
    const row = it as { line_total?: number; unit_price_ugx?: number; quantity?: number; is_reward?: boolean };
    if (row.is_reward) return sum;
    const line = Math.round(Number(row.line_total) || 0);
    if (line) return sum + line;
    return sum + Math.round((Number(row.unit_price_ugx) || 0) * (Number(row.quantity) || 1));
  }, 0);
}

/** Where the order stands, as a tag: In sale (bronze), Cancelled (red), Completed or Closed (neutral). */
function statusTag(seg: OrderSegment, o: StoreOrderRow) {
  if (seg === 'in_sale') return <Tag tone="bronze" testId={`status-${o.id}`}>In sale</Tag>;
  if (seg !== 'closed') return null;
  if (o.status === 'cancelled') return <Tag tone="danger" testId={`status-${o.id}`}>Cancelled</Tag>;
  if (o.status === 'checked_out') return <Tag tone="default" testId={`status-${o.id}`}>Completed</Tag>;
  return <Tag tone="default" testId={`status-${o.id}`}>Closed</Tag>;
}

export function OrdersPage() {
  const [seg, setSeg] = useState<Segment>('waiting');
  const [loading, setLoading] = useState(true);
  const [labels, setLabels] = useState<PosLabelIndex>(posLabels);

  useEffect(() => {
    void loadPosLabels()
      .then((index) => setLabels(index))
      .catch(() => {});
    void loadStoreOrders()
      .then((rows) => {
        try {
          sessionStorage.setItem(KEYS.storeOrdersPaint, writePaint(rows, Date.now()));
        } catch {
          /* private mode */
        }
        return ensureInventory();
      })
      .catch((e) => showToast(e instanceof Error ? e.message : 'Could not load orders'))
      .finally(() => setLoading(false));
  }, []);

  const loadedId = orderMeta.value.storeOrderId || '';
  const list = storeOrders.value.filter((o) => orderSegment(o, loadedId) === seg);
  const counts = { waiting: 0, in_sale: 0, closed: 0 } as Record<OrderSegment, number>;
  for (const o of storeOrders.value) counts[orderSegment(o, loadedId)] += 1;

  /** The order is already in the cart. Go to Sell and open the Review sale sheet in place, keeping any edits. */
  function openLoadedCart() {
    requestCartOpen();
    go('/sell');
  }

  async function loadIntoSale(order: StoreOrderRow) {
    const device_id = deviceId();
    const previous = orderMeta.value.storeOrderId;
    const claim = await postStoreReserve({ op: 'claim', id: order.id, device_id });
    if (claim.network) {
      showToast('No signal — open this order when you are back online');
      return;
    }
    if (!claim.ok && !claim.unsupported) {
      showToast(claim.message || claim.error || 'Another phone is ringing this order up');
      return;
    }
    if (previous && previous !== order.id) {
      void postStoreReserve({ op: 'unclaim', id: previous, device_id });
    }
    const mapped = mapStoreOrderToCart(
      {
        ...order,
        items: (order.items || []) as never,
      },
      { customerName: orderTitle(order, labels) },
    );
    replaceCart(mapped.lines, mapped.meta);
    setOrderMetaPatch(mapped.meta);
    replaceCheckoutDraft(mapped.checkout);
    if (order.status === 'pending' || order.status === 'confirmed') {
      void patchStoreOrder(order.id, { status: 'accepted' }).catch(() => {});
    }
    go('/sell');
  }

  async function cancelOrder(order: StoreOrderRow) {
    const result = await postStoreReserve({ op: 'release', id: order.id, cancel: true });
    if (result.unsupported) {
      const res = await patchStoreOrder(order.id, {
        status: 'cancelled',
        cancelled_at: new Date().toISOString(),
      });
      if (!res.ok) {
        showToast('Could not cancel order');
        return;
      }
    } else if (!result.ok) {
      showToast(result.message || result.error || 'Could not cancel order');
      return;
    }
    showToast(`Cancelled ${orderTitle(order, labels)}`);
    await Promise.allSettled([loadStoreOrders(), ensureInventory()]);
  }

  async function dismissOrder(order: StoreOrderRow) {
    const res = await patchStoreOrder(order.id, { dismissed_at: new Date().toISOString() });
    if (!res.ok) {
      showToast('Could not dismiss order');
      return;
    }
    await loadStoreOrders().catch(() => {});
  }

  return (
    <section>
      <h1 class="page-title">Orders</h1>
      <div style={{ marginBottom: 16 }}>
        <Segmented
          value={seg}
          onChange={setSeg}
          options={[
            { id: 'waiting', label: 'Waiting', count: counts.waiting },
            { id: 'in_sale', label: 'In sale', count: counts.in_sale },
            { id: 'closed', label: 'Closed', count: counts.closed },
          ]}
        />
      </div>

      {loading ? <div class="v-skeleton" data-testid="orders-loading" /> : null}
      {!loading && !list.length ? (
        <EmptyState title="No orders here" body="New storefront orders will show up in Waiting" />
      ) : null}

      <div class="v-stagger">
        {list.map((o) => {
          const items = Array.isArray(o.items) ? o.items : [];
          // Storefront orders spell products and flavours their own way (cookie-duet, flavors: [...]). Read them like the lines below do.
          const photos = itemsImageSlides(items.map(orderLine));
          const phone = String(o.phone_e164 || o.phone || '');
          const place = String(o.location_label || '');
          return (
          <OrderCard
            key={o.id}
            title={orderTitle(o, labels)}
            total={orderTotal(o)}
            photos={photos}
            lines={items.slice(0, 3).map(orderLine)}
            tags={
              <>
                {statusTag(seg, o)}
                <Tag tone={o.delivery_enabled === false ? 'default' : 'bronze'}>
                  {o.delivery_enabled === false ? 'Pickup' : 'Delivery'}
                </Tag>
                {isOrderConfirmed(o) ? <ConfirmedTag testId={`confirmed-${o.id}`} /> : null}
              </>
            }
            copies={
              <DeliveryCopyRow
                compact
                allOnly
                delivery={o.delivery_enabled !== false}
                name={orderTitle(o, labels)}
                phone={phone}
                place={place}
                lat={o.location_lat}
                lng={o.location_lng}
                // Store orders have no paid / unpaid field (status, sale_id, delivery_fee_ugx and items only),
                // so Copy all leaves Collect out. Showing it could send a rider to collect money already paid.
                collect={0}
                idPrefix="copy-"
                idSuffix={`-${o.id}`}
              />
            }
          >
            <div class="v-order-card__actions">
              {seg === 'waiting' ? (
                <>
                  {/* One primary action at a time: Confirm while the order is pending, Load into sale once it is confirmed. */}
                  {!isOrderConfirmed(o) ? (
                    <ConfirmButton
                      testId={`confirm-order-${o.id}`}
                      onConfirm={() => confirmStoreOrder(o.id)}
                    />
                  ) : null}
                  <Button
                    size="md"
                    variant={isOrderConfirmed(o) ? 'primary' : 'secondary'}
                    data-testid={`load-order-${o.id}`}
                    onClick={() => void loadIntoSale(o)}
                  >
                    Load into sale
                  </Button>
                  <Button size="md" variant="ghost" data-testid={`cancel-order-${o.id}`} onClick={() => void cancelOrder(o)}>
                    Cancel
                  </Button>
                </>
              ) : null}
              {seg === 'in_sale' ? (
                <>
                  <Button size="md" data-testid={`load-order-${o.id}`} onClick={() => openLoadedCart()}>
                    Review sale
                  </Button>
                  <Button size="md" variant="ghost" data-testid={`cancel-order-${o.id}`} onClick={() => void cancelOrder(o)}>
                    Cancel
                  </Button>
                </>
              ) : null}
              {seg === 'closed' && !o.dismissed_at ? (
                <Button
                  size="md"
                  variant="secondary"
                  data-testid={`dismiss-order-${o.id}`}
                  onClick={() => void dismissOrder(o)}
                >
                  Dismiss
                </Button>
              ) : null}
            </div>
          </OrderCard>
          );
        })}
      </div>
    </section>
  );
}
