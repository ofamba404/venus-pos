import { useEffect, useState } from 'preact/hooks';
import { loadStoreOrders, storeOrders, ensureInventory, type StoreOrderRow } from '../../data/entities';
import { patchStoreOrder } from '../../data/writes/store-orders';
import { Button } from '../../ui/Button';
import { Tag } from '../../ui/Tag';
import { Segmented } from '../../ui/Segmented';
import { showToast } from '../../ui/ToastHost';
import { itemsImageSlides } from '../../domain/product-art';
import { EmptyState } from '../../ui/EmptyState';
import { OrderCard } from '../../ui/OrderCard';
import { KEYS } from '../../data/keys';
import { deliveryTimePill } from '../../domain/delivery-time';
import { ConfirmButton, ConfirmedTag } from '../../ui/ConfirmOrder';
import { cancelStoreOrder } from './cancel-order';
import { CancelOrderConfirm } from './CancelOrderConfirm';
import { confirmStoreOrder, isOrderConfirmed } from './confirm-order';
import { closeStoreOrder, openStoreOrder, openStoreOrderId } from './open-store-order';
import { StoreOrderSheet } from './StoreOrderSheet';
import { orderLine, orderTotal } from './order-view';
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

/** Where a closed order ended up: Cancelled (red), Completed or Closed (neutral). Open orders carry Delivery/Pickup, time, and Confirmed tags instead. */
function statusTag(seg: OrderSegment, o: StoreOrderRow) {
  if (seg !== 'closed') return null;
  if (o.status === 'cancelled') return <Tag tone="danger" testId={`status-${o.id}`}>Cancelled</Tag>;
  if (o.status === 'checked_out') return <Tag tone="default" testId={`status-${o.id}`}>Completed</Tag>;
  return <Tag tone="default" testId={`status-${o.id}`}>Closed</Tag>;
}

export function OrdersPage() {
  const [seg, setSeg] = useState<Segment>('waiting');
  const [labels, setLabels] = useState<PosLabelIndex>(posLabels);
  const [cancelAsk, setCancelAsk] = useState<StoreOrderRow | null>(null);
  // The order whose sheet is open. A push notification, an old link, or Next on the success sheet lands here with #order=<id>.
  const viewId = openStoreOrderId.value;

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
      .catch((e) => showToast(e instanceof Error ? e.message : 'Could not load orders'));
  }, []);

  const list = storeOrders.value.filter((o) => orderSegment(o) === seg);
  const counts = { waiting: 0, in_sale: 0, closed: 0 } as Record<OrderSegment, number>;
  for (const o of storeOrders.value) counts[orderSegment(o)] += 1;
  const viewing = storeOrders.value.find((o) => o.id === viewId) || null;

  useEffect(() => {
    const open = () => {
      const hash = window.location.hash.replace(/^#/, '');
      const params = new URLSearchParams(hash);
      const id = params.get('order') || params.get('load-store-order');
      if (id) openStoreOrder(id);
    };
    open();
    window.addEventListener('hashchange', open);
    return () => window.removeEventListener('hashchange', open);
  }, []);

  function closeSheet() {
    closeStoreOrder();
    if (/order=|load-store-order=/.test(window.location.hash)) {
      history.replaceState(null, '', window.location.pathname + window.location.search);
    }
  }

  async function cancelOrder(order: StoreOrderRow) {
    const result = await cancelStoreOrder(order.id);
    setCancelAsk(null);
    if (!result.ok) {
      showToast(result.error);
      return;
    }
    showToast(`Cancelled ${orderTitle(order, labels)}`);
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

      {!list.length ? (
        <EmptyState
          title="No orders here"
          body={
            seg === 'in_sale'
              ? 'Confirmed orders you are ringing up will show up in In sale'
              : seg === 'closed'
                ? 'Cancelled and completed orders will show up in Closed'
                : 'New storefront orders will show up in Waiting'
          }
        />
      ) : null}

      <div class="v-stagger">
        {list.map((o) => {
          const items = Array.isArray(o.items) ? o.items : [];
          // Storefront orders spell products and flavours their own way (cookie-duet, flavors: [...]). Read them like the lines below do.
          const photos = itemsImageSlides(items.map(orderLine));
          const when = deliveryTimePill(o.delivery);
          return (
          <OrderCard
            key={o.id}
            testId={`order-card-${o.id}`}
            onOpen={() => openStoreOrder(o.id)}
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
                {when ? (
                  <Tag tone="default" testId={`time-pill-${o.id}`}>
                    {when}
                  </Tag>
                ) : null}
                {isOrderConfirmed(o) ? <ConfirmedTag testId={`confirmed-${o.id}`} /> : null}
              </>
            }
          >
            <div class="v-order-card__actions">
              {seg === 'waiting' || seg === 'in_sale' ? (
                <>
                  {seg === 'waiting' && !isOrderConfirmed(o) ? (
                    <ConfirmButton
                      testId={`confirm-order-${o.id}`}
                      onConfirm={() => confirmStoreOrder(o.id)}
                    />
                  ) : null}
                  <Button
                    size="md"
                    variant={seg === 'in_sale' || isOrderConfirmed(o) ? 'primary' : 'secondary'}
                    data-testid={`view-order-${o.id}`}
                    onClick={() => openStoreOrder(o.id)}
                  >
                    View order
                  </Button>
                  <Button size="md" variant="ghost" data-testid={`cancel-order-${o.id}`} onClick={() => setCancelAsk(o)}>
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

      <CancelOrderConfirm
        open={Boolean(cancelAsk)}
        clientName={cancelAsk ? orderTitle(cancelAsk, labels) : ''}
        onKeep={() => setCancelAsk(null)}
        onConfirm={() => cancelAsk && void cancelOrder(cancelAsk)}
      />

      <StoreOrderSheet
        order={viewing}
        title={viewing ? orderTitle(viewing, labels) : ''}
        queue={storeOrders.value.filter((row) => orderSegment(row) === 'in_sale')}
        onClose={closeSheet}
        onSelect={openStoreOrder}
      />
    </section>
  );
}
