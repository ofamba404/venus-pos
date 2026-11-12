import { useEffect, useState } from 'preact/hooks';
import { loadStoreOrders, storeOrders, ensureInventory, type StoreOrderRow } from '../../data/entities';
import { deviceId } from '../../data/device-id';
import { postStoreReserve } from '../../data/store-reserve';
import { mapStoreOrderToCart } from '../../domain/store-order-map';
import { orderMeta, replaceCart, setOrderMetaPatch } from '../../data/session-cart';
import { replaceCheckoutDraft } from '../../data/checkout-draft';
import { patchStoreOrder } from '../../data/writes/store-orders';
import { go } from '../../app/router';
import { Button } from '../../ui/Button';
import { Tag } from '../../ui/Tag';
import { Money } from '../../ui/Money';
import { Segmented } from '../../ui/Segmented';
import { showToast } from '../../ui/ToastHost';
import { formatUGX } from '../../domain/format';

type Segment = 'waiting' | 'in_sale' | 'closed';

function segmentOf(o: StoreOrderRow): Segment {
  if (o.status === 'accepted') return 'in_sale';
  if (o.status === 'cancelled' || o.status === 'checked_out') return 'closed';
  return 'waiting';
}

function orderTitle(o: StoreOrderRow) {
  return String(o.customer_name || o.phone_e164 || 'Store order');
}

function orderTotal(o: StoreOrderRow): number {
  const items = Array.isArray(o.items) ? o.items : [];
  return items.reduce<number>((sum, it) => {
    const row = it as { line_total?: number; is_reward?: boolean };
    return sum + (row.is_reward ? 0 : Math.round(Number(row.line_total) || 0));
  }, 0);
}

export function OrdersPage() {
  const [seg, setSeg] = useState<Segment>('waiting');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void loadStoreOrders()
      .then(() => ensureInventory())
      .catch((e) => showToast(e instanceof Error ? e.message : 'Could not load orders'))
      .finally(() => setLoading(false));
  }, []);

  const list = storeOrders.value.filter((o) => segmentOf(o) === seg);

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
      { customerName: orderTitle(order) },
    );
    replaceCart(mapped.lines, mapped.meta);
    setOrderMetaPatch(mapped.meta);
    replaceCheckoutDraft(mapped.checkout);
    if (order.status === 'pending' || order.status === 'confirmed') {
      void patchStoreOrder(order.id, { status: 'accepted' }).catch(() => {});
    }
    showToast(`Loaded ${orderTitle(order)}`);
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
    showToast(`Cancelled ${orderTitle(order)}`);
    await Promise.allSettled([loadStoreOrders(), ensureInventory()]);
  }

  async function dismissOrder(order: StoreOrderRow) {
    const res = await patchStoreOrder(order.id, { dismissed_at: new Date().toISOString() });
    if (!res.ok) {
      showToast('Could not dismiss order');
      return;
    }
    showToast(`Dismissed ${orderTitle(order)}`);
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
            { id: 'waiting', label: 'Waiting' },
            { id: 'in_sale', label: 'In sale' },
            { id: 'closed', label: 'Closed' },
          ]}
        />
      </div>

      {loading ? <p class="v-muted">Loading…</p> : null}
      {!loading && !list.length ? (
        <div class="v-empty">
          <p class="v-empty__title">No orders here</p>
          <p>New storefront orders will show up in Waiting</p>
        </div>
      ) : null}

      <div>
        {list.map((o) => (
          <article key={o.id} class="v-order-card">
            <div class="v-order-card__top">
              <div>
                <div class="v-list-row__title">{orderTitle(o)}</div>
                <div class="v-list-row__meta">
                  {o.status} · {o.delivery_enabled === false ? 'Pickup' : 'Delivery'}
                </div>
              </div>
              <Money value={orderTotal(o)} />
            </div>
            <div class="v-order-card__actions">
              <Tag tone={o.delivery_enabled === false ? 'default' : 'paid'}>
                {o.delivery_enabled === false ? 'Pickup' : 'Delivery'}
              </Tag>
              {seg === 'waiting' ? (
                <>
                  <Button size="md" data-testid={`load-order-${o.id}`} onClick={() => void loadIntoSale(o)}>
                    Load into sale
                  </Button>
                  <Button
                    size="md"
                    variant="secondary"
                    data-testid={`cancel-order-${o.id}`}
                    onClick={() => void cancelOrder(o)}
                  >
                    Cancel
                  </Button>
                </>
              ) : null}
              {seg === 'in_sale' ? (
                <Button size="md" variant="secondary" data-testid={`load-order-${o.id}`} onClick={() => void loadIntoSale(o)}>
                  Open cart
                </Button>
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
            {o.location_label ? (
              <p class="v-muted" style={{ margin: '8px 0 0' }}>
                {String(o.location_label)}
                {o.delivery_fee_ugx != null ? ` · ${formatUGX(Number(o.delivery_fee_ugx))}` : ''}
              </p>
            ) : null}
          </article>
        ))}
      </div>
    </section>
  );
}
