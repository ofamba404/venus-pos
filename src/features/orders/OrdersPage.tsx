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
import { Segmented } from '../../ui/Segmented';
import { showToast } from '../../ui/ToastHost';
import { formatUGX } from '../../domain/format';
import { productImageSrc } from '../../domain/product-art';
import { localPhoneDigits } from '../../domain/phone';
import { EmptyState } from '../../ui/EmptyState';
import { OrderCard } from '../../ui/OrderCard';
import { KEYS } from '../../data/keys';
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

type Segment = 'waiting' | 'in_sale' | 'closed';

function segmentOf(o: StoreOrderRow): Segment {
  if (o.status === 'accepted') return 'in_sale';
  if (o.status === 'cancelled' || o.status === 'checked_out') return 'closed';
  return 'waiting';
}

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
      { customerName: orderTitle(order, labels) },
    );
    replaceCart(mapped.lines, mapped.meta);
    setOrderMetaPatch(mapped.meta);
    replaceCheckoutDraft(mapped.checkout);
    if (order.status === 'pending' || order.status === 'confirmed') {
      void patchStoreOrder(order.id, { status: 'accepted' }).catch(() => {});
    }
    showToast(`Loaded ${orderTitle(order, labels)}`);
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
    showToast(`Dismissed ${orderTitle(order, labels)}`);
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

      {loading ? <div class="v-skeleton" data-testid="orders-loading" /> : null}
      {!loading && !list.length ? (
        <EmptyState title="No orders here" body="New storefront orders will show up in Waiting" />
      ) : null}

      <div class="v-stagger">
        {list.map((o) => {
          const items = Array.isArray(o.items) ? o.items : [];
          const first = items[0] as {
            product_id?: string;
            breakdown?: Record<string, unknown>;
          } | undefined;
          const thumb = first?.product_id ? productImageSrc(first.product_id, first.breakdown) : '';
          return (
          <OrderCard
            key={o.id}
            title={orderTitle(o, labels)}
            status={String(o.status || 'open')}
            total={orderTotal(o)}
            image={thumb}
            lines={items.slice(0, 3).map((raw) => {
              const item = raw as {
                product_id?: string;
                product_name?: string;
                breakdown?: Record<string, unknown>;
              };
              return {
                name: item.product_name || 'Item',
                productId: item.product_id,
                breakdown: item.breakdown,
              };
            })}
          >
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
                <>
                  <Button size="md" variant="secondary" data-testid={`load-order-${o.id}`} onClick={() => void loadIntoSale(o)}>
                    Open cart
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
              <div class="v-chip-row" style={{ marginTop: 8 }}>
                <span class="v-muted">
                  {String(o.location_label)}
                  {o.delivery_fee_ugx !== undefined && o.delivery_fee_ugx !== null
                    ? ` · ${formatUGX(Number(o.delivery_fee_ugx))}`
                    : ''}
                </span>
                <Button
                  size="md"
                  variant="secondary"
                  data-testid={`copy-location-${o.id}`}
                  onClick={() => {
                    const text = String(o.location_label);
                    void navigator.clipboard?.writeText(text).then(
                      () => showToast('Location copied'),
                      () => showToast(text),
                    );
                  }}
                >
                  Copy location
                </Button>
              </div>
            ) : null}
            {o.phone_e164 ? (
              <Button
                size="md"
                variant="secondary"
                data-testid={`copy-phone-${o.id}`}
                onClick={() => {
                  const digits = localPhoneDigits(o.phone_e164);
                  void navigator.clipboard?.writeText(digits).then(
                    () => showToast('Phone copied'),
                    () => showToast(digits),
                  );
                }}
              >
                Copy phone
              </Button>
            ) : null}
          </OrderCard>
          );
        })}
      </div>
    </section>
  );
}
