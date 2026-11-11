import { useEffect, useState } from 'preact/hooks';
import { loadStoreOrders, storeOrders, type StoreOrderRow } from '../../data/entities';
import { mapStoreOrderToCart } from '../../domain/store-order-map';
import { replaceCart, setOrderMetaPatch } from '../../data/session-cart';
import { sbFetch } from '../../data/api';
import { go } from '../../app/router';
import { Button } from '../../ui/Button';
import { Tag } from '../../ui/Tag';
import { Money } from '../../ui/Money';
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
      .catch((e) => showToast(e instanceof Error ? e.message : 'Could not load orders'))
      .finally(() => setLoading(false));
  }, []);

  const list = storeOrders.value.filter((o) => segmentOf(o) === seg);

  async function loadIntoSale(order: StoreOrderRow) {
    const mapped = mapStoreOrderToCart(
      {
        ...order,
        items: (order.items || []) as never,
      },
      { customerName: orderTitle(order) },
    );
    replaceCart(mapped.lines, mapped.meta);
    setOrderMetaPatch(mapped.meta);
    if (order.status === 'pending' || order.status === 'confirmed') {
      void sbFetch(`store_orders?id=eq.${encodeURIComponent(order.id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'accepted' }),
      }).catch(() => {});
    }
    showToast(`Loaded ${orderTitle(order)}`);
    go('/sell');
  }

  return (
    <section>
      <h1 class="page-title">Orders</h1>
      <div class="v-seg" style={{ marginBottom: 16 }}>
        {(
          [
            ['waiting', 'Waiting'],
            ['in_sale', 'In sale'],
            ['closed', 'Closed'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            class={`v-seg__btn ${seg === id ? 'is-on' : ''}`}
            onClick={() => setSeg(id)}
          >
            {label}
          </button>
        ))}
      </div>

      {loading ? <p style={{ color: 'var(--fg-3)' }}>Loading…</p> : null}
      {!loading && !list.length ? (
        <div class="v-empty">
          <p class="v-empty__title">No orders here</p>
          <p>New storefront orders will show up in Waiting</p>
        </div>
      ) : null}

      <div>
        {list.map((o) => (
          <article
            key={o.id}
            style={{
              background: 'var(--surface)',
              borderRadius: 'var(--r-lg)',
              boxShadow: 'inset 0 0 0 1px var(--line)',
              padding: 16,
              marginBottom: 12,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
              <div>
                <div style={{ font: 'var(--t-title-sm)' }}>{orderTitle(o)}</div>
                <div style={{ font: 'var(--t-meta)', color: 'var(--fg-3)' }}>
                  {o.status} · {o.delivery_enabled === false ? 'Pickup' : 'Delivery'}
                </div>
              </div>
              <Money value={orderTotal(o)} />
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
              <Tag tone={o.delivery_enabled === false ? 'default' : 'paid'}>
                {o.delivery_enabled === false ? 'Pickup' : 'Delivery'}
              </Tag>
              {seg === 'waiting' ? (
                <Button size="md" onClick={() => void loadIntoSale(o)}>
                  Load into sale
                </Button>
              ) : null}
              {seg === 'in_sale' ? (
                <Button size="md" variant="secondary" onClick={() => void loadIntoSale(o)}>
                  Open cart
                </Button>
              ) : null}
            </div>
            {o.location_label ? (
              <p style={{ font: 'var(--t-meta)', color: 'var(--fg-2)', margin: '8px 0 0' }}>
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
