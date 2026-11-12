import { useEffect, useRef, useState } from 'preact/hooks';
import { PRODUCTS, CAT_MAP, type Product } from '../../domain/catalog';
import { itemToConfigSelection } from '../../domain/pricing/pack-config';
import { stockCrossing } from '../../domain/stock-state';
import { formatUGX } from '../../domain/format';
import {
  buildCartLine,
  cartTotal,
  clientReadyForCharge,
  isWalkInCheckout,
  resumeHeldSale,
  toHeldSale,
  WALK_IN_NAME,
  type HeldSale,
} from '../../domain/cart';
import { configFlavorPool, configTotalSelected } from '../../domain/pricing/pack-config';
import { getProgress } from '../../domain/pricing/flavored-bulk';
import { computeTodayStats } from '../../domain/today';
import {
  cartLines,
  cartSum,
  cartCount,
  cartState,
  orderMeta,
  dispatchCart,
  setOrderMetaPatch,
  clearCartKeepMeta,
  replaceCart,
} from '../../data/session-cart';
import { checkoutDraft, clearCheckoutDraft, setCheckoutDraft } from '../../data/checkout-draft';
import { ensureDeliveryModel, quoteFeeForDest } from '../../data/delivery-model';
import { runCheckout } from '../../data/checkout';
import { features } from '../../data/env';
import { deviceId } from '../../data/device-id';
import { deleteHeld, listHeld, saveHeld } from '../../data/held';
import { flushOutbox, listOutbox, outboxCountLabel } from '../../data/outbox';
import { mapStoreOrderToCart } from '../../domain/store-order-map';
import { sbFetch } from '../../data/api';
import { postStoreReserve } from '../../data/store-reserve';
import { clients, ensureInventory, inventory, loadClients, loadSales, loadStoreOrders, sales, storeOrders, syncLabel } from '../../data/entities';
import { openDebtForClientName } from '../../domain/credit';
import { counterSellable } from '../../domain/stock-reservation';
import { haptic } from '../../platform/haptics';
import { Button } from '../../ui/Button';
import { Money } from '../../ui/Money';
import { Sheet } from '../../ui/Sheet';
import { Field } from '../../ui/Field';
import { Segmented } from '../../ui/Segmented';
import { FlavorDot } from '../../ui/FlavorDot';
import { PlaceSearch } from '../../ui/PlaceSearch';
import { showToast } from '../../ui/ToastHost';
import { IconButton } from '../../ui/IconButton';
import { IconCheck, IconClose, IconMinus, IconPlus } from '../../ui/icons';

const PACKS = PRODUCTS.filter((p) => p.rule === 'choose_any' || p.rule === 'choose_variety');
const SINGLES = PRODUCTS.filter(
  (p) => p.rule === 'single_qty' || p.rule === 'spliff_qty' || p.rule === 'cookie_qty',
);
const WHOLESALE = PRODUCTS.filter((p) => p.rule === 'cookie_wholesale');

function productPriceLabel(p: Product) {
  if (p.priceLabel) return p.priceLabel;
  const amount = p.price != null ? p.price : p.unitPrice;
  if (amount == null) return '';
  return p.priceFrom ? `from ${formatUGX(amount)}` : formatUGX(amount);
}

export function SellPage() {
  const [configProduct, setConfigProduct] = useState<Product | null>(null);
  const [selection, setSelection] = useState<Record<string, number>>({});
  const [cartOpen, setCartOpen] = useState(false);
  const [paying, setPaying] = useState(false);
  const [successTotal, setSuccessTotal] = useState<number | null>(null);
  const [payment, setPayment] = useState<'paid' | 'credit'>('paid');
  const [heldSales, setHeldSales] = useState<HeldSale[]>([]);
  const [waiting, setWaiting] = useState(0);
  const [queuedNote, setQueuedNote] = useState(false);
  const [debtAsk, setDebtAsk] = useState<{ name: string; owed: number } | null>(null);
  const debtClearedRef = useRef(false);
  const placeGen = useRef(0);
  const pickupLocateGen = useRef(0);
  const [editingKey, setEditingKey] = useState<string | null>(null);

  const lines = cartLines.value;
  const meta = orderMeta.value;
  const progress = getProgress(lines);
  const draft = checkoutDraft.value;
  const today = computeTodayStats(sales.value as Parameters<typeof computeTodayStats>[0]);

  useEffect(() => {
    void loadSales().catch(() => {});
    void loadClients().catch(() => {});
    void listHeld().then(setHeldSales).catch(() => {});
    const refreshQueue = () => {
      void flushOutbox()
        .catch(() => {})
        .finally(() => {
          void listOutbox()
            .then((rows) => setWaiting(rows.length))
            .catch(() => {});
        });
    };
    refreshQueue();
    void ensureDeliveryModel().catch(() => {});
    void ensureInventory().catch(() => {});
    const openLinkedOrder = () => {
      const hash = window.location.hash.replace(/^#/, '');
      const deepId = new URLSearchParams(hash).get('load-store-order');
      if (!deepId) return;
      void loadStoreOrders()
        .then((rows) => {
          const order = rows.find((row) => row.id === deepId);
          if (!order) return;
          const mapped = mapStoreOrderToCart(
            { ...order, items: (order.items || []) as never },
            { customerName: String(order.customer_name || 'Store order') },
          );
          replaceCart(mapped.lines, mapped.meta);
          setOrderMetaPatch(mapped.meta);
          setCartOpen(true);
        })
        .catch(() => {});
    };
    openLinkedOrder();
    window.addEventListener('hashchange', openLinkedOrder);
    const timer = window.setInterval(() => {
      void ensureInventory().catch(() => {});
    }, 15000);
    const onFocus = () => {
      void ensureInventory().catch(() => {});
      refreshQueue();
    };
    const onOnline = () => refreshQueue();
    const onVisible = () => {
      if (document.visibilityState === 'visible') refreshQueue();
    };
    window.addEventListener('focus', onFocus);
    window.addEventListener('online', onOnline);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('hashchange', openLinkedOrder);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('online', onOnline);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  useEffect(() => {
    let seen = new Set<string>();
    let primed = false;
    let timer = 0;
    const tick = () => {
      void loadStoreOrders()
        .then((rows) => {
          const ids = rows.map((row) => row.id);
          if (!primed) {
            seen = new Set(ids);
            primed = true;
            return;
          }
          const fresh = rows.filter(
            (row) => !seen.has(row.id) && (row.status === 'pending' || row.status === 'confirmed'),
          );
          for (const id of ids) seen.add(id);
          if (fresh.length === 1) showToast('New order');
          else if (fresh.length > 1) showToast(`${fresh.length} new orders`);
        })
        .catch(() => {});
    };
    tick();
    timer = window.setInterval(tick, 4000);
    return () => window.clearInterval(timer);
  }, []);

  async function onPlacePick(place: { label: string; lat: number; lng: number }) {
    const gen = placeGen.current + 1;
    placeGen.current = gen;
    setOrderMetaPatch({
      deliveryEnabled: true,
      deliveryLocationLabel: place.label,
    });
    const origin = checkoutDraft.value.origin;
    const pred = await quoteFeeForDest(
      { lat: place.lat, lng: place.lng },
      origin && Number.isFinite(origin.lat) && Number.isFinite(origin.lng) ? origin : undefined,
    );
    if (gen !== placeGen.current) return;
    setCheckoutDraft({
      dest: { lat: place.lat, lng: place.lng },
      destText: place.label,
      distanceKm: pred.km,
      durationMin: pred.durationMin,
      feeValue: pred.predicted != null ? String(pred.predicted) : '',
      predictedFee: pred.predicted,
      feeManuallyEdited: false,
    });
    if (pred.predicted == null) showToast('Place set — log more quotes to predict fee');
  }

  function locatePickup() {
    const gen = pickupLocateGen.current + 1;
    pickupLocateGen.current = gen;
    placeGen.current += 1;
    const quoteGen = placeGen.current;
    setCheckoutDraft({ originText: 'Locating…' });
    if (!navigator.geolocation) {
      showToast('Location is off');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        if (gen !== pickupLocateGen.current) return;
        const origin = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        const label = `${origin.lat.toFixed(2)}, ${origin.lng.toFixed(2)}`;
        setCheckoutDraft({ origin, originText: label });
        const dest = checkoutDraft.value.dest;
        if (dest?.lat == null || dest.lng == null) return;
        void quoteFeeForDest({ lat: Number(dest.lat), lng: Number(dest.lng) }, origin).then((pred) => {
          if (gen !== pickupLocateGen.current || quoteGen !== placeGen.current) return;
          setCheckoutDraft({
            origin,
            originText: label,
            distanceKm: pred.km,
            durationMin: pred.durationMin,
            feeValue: pred.predicted != null ? String(pred.predicted) : checkoutDraft.value.feeValue,
            predictedFee: pred.predicted,
            feeManuallyEdited: false,
          });
        });
      },
      () => {
        if (gen !== pickupLocateGen.current) return;
        showToast('Could not read location');
      },
      { enableHighAccuracy: false, maximumAge: 15000, timeout: 8000 },
    );
  }

  function openConfig(p: Product) {
    void ensureInventory().catch(() => {});
    setEditingKey(null);
    setConfigProduct(p);
    if (p.rule === 'single_qty') setSelection({ qty: 1 });
    else if (p.rule === 'cookie_wholesale') setSelection({ _unitPrice: 2500 });
    else setSelection({});
  }

  function openLine(line: { key: string; productId: string; breakdown: Record<string, number>; wholesaleUnitPrice?: number; lineTotal: number }) {
    const product = PRODUCTS.find((p) => p.id === line.productId);
    if (!product) return;
    void ensureInventory().catch(() => {});
    setEditingKey(line.key);
    setConfigProduct(product);
    setSelection(itemToConfigSelection(product, line));
    setCartOpen(false);
  }

  function sellableNow() {
    if (syncLabel.value !== 'live') return null;
    return counterSellable(inventory.value, lines);
  }

  function addConfigured() {
    if (!configProduct) return;
    const sellable = sellableNow();
    if (sellable && selectionOverStock(configProduct, selection, sellable)) {
      showToast('Not enough in stock for that quantity');
      return;
    }
    const line = buildCartLine(configProduct, selection, { otherLines: lines });
    if (configTotalSelected(selection) <= 0 && configProduct.rule !== 'choose_variety') {
      showToast('Pick at least one');
      return;
    }
    if (editingKey) {
      dispatchCart({ type: 'update_line', key: editingKey, line: { ...line, key: editingKey } });
    } else {
      dispatchCart({ type: 'add_line', line });
    }
    haptic(10);
    setEditingKey(null);
    setConfigProduct(null);
    setCartOpen(true);
  }

  function bumpFlavor(id: string, delta: number) {
    setSelection((prev) => {
      const next = { ...prev };
      const n = Math.max(0, (Number(next[id]) || 0) + delta);
      if (n === 0) delete next[id];
      else next[id] = n;
      return next;
    });
  }

  async function charge() {
    if (payment === 'credit' && !debtClearedRef.current) {
      const owed = openDebtForClientName(meta.clientName, clients.value, sales.value);
      if (owed > 0) {
        setDebtAsk({ name: meta.clientName.trim(), owed });
        return;
      }
    }
    setDebtAsk(null);
    setPaying(true);
    const beforeStock = { ...inventory.value };
    const result = await runCheckout({
      lines,
      meta: { ...meta, isCredit: payment === 'credit' },
      isCredit: payment === 'credit',
      clientId: meta.clientId || null,
      checkout: draft,
    });
    setPaying(false);
    if (!result.ok) {
      showToast(result.error);
      return;
    }
    if (!result.queued) {
      for (const [id, prev] of Object.entries(beforeStock)) {
        const next = inventory.value[id] ?? 0;
        if (next === prev) continue;
        const cross = stockCrossing(id, prev, next);
        const label = CAT_MAP[id]?.name || id;
        if (cross.crossedOut) showToast(`${label} is out of stock`);
        else if (cross.crossedLow) showToast(`${label} is running low`);
      }
    }
    haptic(15);
    setQueuedNote(Boolean(result.queued));
    if (result.queued) {
      setWaiting((n) => n + 1);
      showToast('Queued offline');
    }
    setSuccessTotal(cartTotal(lines));
    clearCartKeepMeta();
    clearCheckoutDraft();
    setOrderMetaPatch({
      clientName: '',
      clientId: '',
      isCredit: false,
      storeOrderId: '',
      deliveryLocationLabel: '',
      deliveryTimeLabel: '',
      deliveryDeliverAt: '',
      clientPhone: '',
    });
    void loadSales().catch(() => {});
  }

  async function parkSale() {
    if (meta.storeOrderId) {
      showToast('Store orders stay on the counter');
      return;
    }
    const snap = toHeldSale(cartState.value);
    if (!snap) return;
    try {
      await saveHeld(snap);
    } catch {
      showToast('Could not hold this sale');
      return;
    }
    clearCartKeepMeta();
    setOrderMetaPatch({ clientName: '', clientId: '', isCredit: false, storeOrderId: '' });
    setHeldSales(await listHeld());
    showToast('Held on this phone');
  }

  async function confirmLoadedOrder() {
    const id = meta.storeOrderId;
    if (!id) return;
    const res = await sbFetch(`store_orders?id=eq.${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'confirmed', confirmed_at: new Date().toISOString() }),
    });
    if (!res.ok) {
      showToast('Could not confirm order');
      return;
    }
    showToast('Order confirmed');
  }

  async function resumeSale(id: string) {
    const row = (await listHeld()).find((item) => item.id === id);
    if (!row) return;
    if (meta.storeOrderId) {
      void postStoreReserve({ op: 'unclaim', id: meta.storeOrderId, device_id: deviceId() });
    } else if (lines.length) {
      const current = toHeldSale(cartState.value);
      if (current) await saveHeld(current);
    }
    const next = resumeHeldSale(row);
    replaceCart(next.lines, next.meta);
    setPayment(next.meta.isCredit ? 'credit' : 'paid');
    await deleteHeld(id);
    setHeldSales(await listHeld());
  }

  const recentClients = clients.value.slice(0, 6);
  const credit = payment === 'credit';
  const canCharge = clientReadyForCharge(meta, credit);

  const cartBody = (
    <>
      {features.holdSale && heldSales.length ? (
        <div class="v-chip-row" data-testid="held-sales">
          {heldSales.map((sale) => (
            <button
              key={sale.id}
              type="button"
              class="v-tag"
              onClick={() => void resumeSale(sale.id)}
            >
              {sale.name}
            </button>
          ))}
        </div>
      ) : null}
      {lines.length === 0 ? (
        <div class="v-empty">
          <p class="v-empty__title">No items yet</p>
          <p>Tap a product to start the sale</p>
        </div>
      ) : (
        <div>
          {lines.map((line) => (
            <div class="v-list-row" key={line.key}>
              <div class="v-list-row__main">
                <div class="v-list-row__title">{line.name}</div>
                <div class="v-list-row__meta">{line.detail}</div>
              </div>
              <Money value={line.isReward ? 0 : line.lineTotal} />
              <IconButton size="sm" label={`Edit ${line.name}`} onClick={() => openLine(line)}>
                <IconPlus size={18} />
              </IconButton>
              <IconButton
                size="sm"
                label={`Remove ${line.name}`}
                onClick={() => {
                  const storeId = meta.storeOrderId;
                  const emptying = lines.length === 1 && Boolean(storeId);
                  dispatchCart({ type: 'remove_line', key: line.key });
                  if (emptying && storeId) {
                    void postStoreReserve({ op: 'unclaim', id: storeId, device_id: deviceId() });
                    setOrderMetaPatch({ storeOrderId: '' });
                  }
                  showToast('Removed', {
                    actionLabel: 'Undo',
                    onAction: () => {
                      dispatchCart({ type: 'add_line', line });
                      if (emptying && storeId) {
                        setOrderMetaPatch({ storeOrderId: storeId });
                        void postStoreReserve({
                          op: 'claim',
                          id: storeId,
                          device_id: deviceId(),
                        });
                      }
                    },
                  });
                }}
              >
                <IconClose size={18} />
              </IconButton>
            </div>
          ))}
          {progress.hasAny ? (
            <p style={{ font: 'var(--t-meta)', color: 'var(--fg-2)' }}>{progress.message}</p>
          ) : null}
        </div>
      )}

      <div style={{ display: 'grid', gap: 'var(--s-3)', marginTop: 'var(--s-4)' }}>
        <Field
          label="Customer"
          data-testid="cart-client"
          value={meta.clientName}
          placeholder="Name"
          onInput={(e) => {
            debtClearedRef.current = false;
            setOrderMetaPatch({
              clientName: (e.target as HTMLInputElement).value,
              clientId: '',
            });
          }}
        />
        {features.walkInClient || recentClients.length ? (
          <div class="v-chip-row">
            {features.walkInClient && !credit ? (
              <button
                type="button"
                class={isWalkInCheckout(meta, false) ? 'v-tag is-active' : 'v-tag'}
                data-testid="walk-in"
                onClick={() =>
                  setOrderMetaPatch({ clientName: WALK_IN_NAME, clientId: '', isCredit: false })
                }
              >
                Walk-in
              </button>
            ) : null}
            {recentClients.map((c) => (
              <button
                key={c.id}
                type="button"
                class="v-tag"
                onClick={() => setOrderMetaPatch({ clientName: c.name || '', clientId: c.id })}
              >
                {c.name}
              </button>
            ))}
          </div>
        ) : null}
        <Segmented
          value={payment}
          onChange={(id) => {
            setPayment(id);
            debtClearedRef.current = false;
            if (id === 'credit' && isWalkInCheckout(meta, false)) {
              setOrderMetaPatch({ clientName: '', clientId: '' });
            }
          }}
          options={[
            { id: 'paid', label: 'Paid' },
            { id: 'credit', label: 'On credit' },
          ]}
        />
        <Segmented
          value={meta.deliveryEnabled === false ? 'pickup' : 'delivery'}
          onChange={(id) => {
            const deliveryEnabled = id === 'delivery';
            if (!deliveryEnabled) {
              setCheckoutDraft({
                dest: null,
                destText: '',
                feeValue: '',
                distanceKm: null,
                predictedFee: null,
                feeManuallyEdited: false,
              });
              setOrderMetaPatch({ deliveryEnabled: false, deliveryLocationLabel: '' });
            } else {
              setOrderMetaPatch({ deliveryEnabled: true });
            }
          }}
          options={[
            { id: 'delivery', label: 'Delivery' },
            { id: 'pickup', label: 'Pickup' },
          ]}
        />
        {meta.deliveryEnabled !== false ? (
          <>
            <button type="button" class="v-tag" data-testid="pickup-locate" onClick={locatePickup}>
              Use GPS
            </button>
            <p class="v-muted" data-testid="pickup-label">
              {draft.originText || 'Shop pickup'}
            </p>
            <PlaceSearch
              value={draft.destText || meta.deliveryLocationLabel || ''}
              onPick={onPlacePick}
            />
            <Field
              label="Delivery fee (UGX)"
              inputMode="numeric"
              data-testid="delivery-fee"
              value={String(draft.feeValue ?? '')}
              placeholder="0"
              onInput={(e) => {
                const feeValue = (e.target as HTMLInputElement).value;
                setCheckoutDraft({ feeValue, feeManuallyEdited: true });
              }}
            />
            <Field
              label="Phone"
              data-testid="delivery-phone"
              value={meta.clientPhone}
              placeholder="+256…"
              onInput={(e) => setOrderMetaPatch({ clientPhone: (e.target as HTMLInputElement).value })}
            />
            <Field
              label="Deliver at"
              data-testid="delivery-at"
              value={meta.deliveryDeliverAt}
              placeholder="2026-11-12T15:00:00+03:00"
              onInput={(e) =>
                setOrderMetaPatch({ deliveryDeliverAt: (e.target as HTMLInputElement).value })
              }
            />
            {draft.distanceKm != null ? (
              <p class="v-muted">
                {Number(draft.distanceKm).toFixed(1)} km
                {draft.durationMin != null ? ` · ~${Math.round(Number(draft.durationMin))} min` : ''}
                {draft.predictedFee != null && !draft.feeManuallyEdited
                  ? ` · model ${formatUGX(Number(draft.predictedFee))}`
                  : ''}
              </p>
            ) : null}
          </>
        ) : null}
        <div class="cart-total">
          <span class="cart-total__label">Total</span>
          <Money value={cartSum.value} size="xl" />
        </div>
        {meta.storeOrderId ? (
          <Button size="md" variant="secondary" data-testid="confirm-store-order" onClick={() => void confirmLoadedOrder()}>
            Confirm order
          </Button>
        ) : null}
        {features.holdSale && lines.length && !meta.storeOrderId ? (
          <Button size="md" variant="secondary" data-testid="hold-sale" onClick={() => void parkSale()}>
            Hold on this phone
          </Button>
        ) : null}
      </div>
    </>
  );

  if (successTotal != null) {
    return (
      <section>
        <div class="success-check" aria-hidden="true">
          <IconCheck />
        </div>
        <p class="success-total">{formatUGX(successTotal)}</p>
        <p style={{ textAlign: 'center', color: 'var(--fg-2)', marginBottom: 24 }}>
          {queuedNote
            ? 'Saved on this phone. It will sync when the signal returns.'
            : payment === 'credit'
              ? 'Recorded on credit'
              : 'Sale recorded'}
        </p>
        <Button
          size="xl"
          onClick={() => {
            setSuccessTotal(null);
            setQueuedNote(false);
            setPayment('paid');
          }}
        >
          New sale
        </Button>
      </section>
    );
  }

  return (
    <section class="sell-layout">
      <div>
        {waiting > 0 ? (
          <p class="v-muted" data-testid="sync-chip">
            {outboxCountLabel(waiting)}
          </p>
        ) : null}
        <button
          type="button"
          class="today-pill"
          data-testid="today-pill"
          data-revenue={today.revenue}
          data-joints={today.joints}
          data-cookies={today.cookies}
        >
          <span class="today-pill__kicker">Today</span>
          <span class="today-pill__value">
            <Money value={today.revenue} />
          </span>
          <span class="today-pill__meta">
            {today.salesCount} sold
            {today.joints ? ` · ${today.joints} joints` : ''}
            {today.cookies ? ` · ${today.cookies} cookies` : ''}
          </span>
        </button>
        <div class="v-section-label">Packs</div>
        <div class="tile-grid">
          {PACKS.map((p) => (
            <button
              key={p.id}
              type="button"
              class="v-tile"
              data-testid={`product-${p.id}`}
              onClick={() => openConfig(p)}
            >
              <span class="v-tile__name">{p.name}</span>
              <span class="v-tile__meta">
                {p.joints} {p.slotNoun || (Number(p.joints) === 1 ? 'joint' : 'joints')}
              </span>
              <span class="v-tile__price">{productPriceLabel(p)}</span>
            </button>
          ))}
        </div>
        <div class="v-section-label">Singles</div>
        <div class="tile-grid">
          {SINGLES.map((p) => (
            <button
              key={p.id}
              type="button"
              class="v-tile"
              data-testid={`product-${p.id}`}
              onClick={() => openConfig(p)}
            >
              <span class="v-tile__name">{p.name}</span>
              <span class="v-tile__meta">{p.unitLabel || 'per joint'}</span>
              <span class="v-tile__price">{productPriceLabel(p)}</span>
            </button>
          ))}
        </div>
        {WHOLESALE.length ? (
          <>
            <div class="v-section-label">Wholesale</div>
            <div class="tile-grid">
              {WHOLESALE.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  class="v-tile"
                  data-testid={`product-${p.id}`}
                  onClick={() => openConfig(p)}
                >
                  <span class="v-tile__name">{p.name}</span>
                  <span class="v-tile__price">{productPriceLabel(p)}</span>
                </button>
              ))}
            </div>
          </>
        ) : null}
      </div>

      <aside class="sell-cart-pane" data-desktop-cart>
        <h2 class="page-title" style={{ marginTop: 0 }}>
          Cart
        </h2>
        {cartBody}
        <div style={{ marginTop: 16 }}>
          <Button
            size="xl"
            data-testid="charge"
            disabled={!lines.length || !canCharge || paying}
            onClick={() => void charge()}
          >
            {paying
              ? 'Saving…'
              : payment === 'credit'
                ? `Record on credit · ${formatUGX(cartSum.value)}`
                : `Charge ${formatUGX(cartSum.value)}`}
          </Button>
        </div>
      </aside>

      {cartCount.value > 0 ? (
        <button type="button" class="cart-bar" data-testid="cart-bar" onClick={() => setCartOpen(true)}>
          <span class="cart-bar__meta">
            {cartCount.value} item{cartCount.value === 1 ? '' : 's'} · {formatUGX(cartSum.value)}
          </span>
          <span class="cart-bar__cta">Review sale</span>
        </button>
      ) : null}

      <Sheet
        open={Boolean(configProduct)}
        title={configProduct?.name || 'Configure'}
        onClose={() => {
          setConfigProduct(null);
          setEditingKey(null);
        }}
        footer={
          <Button size="xl" data-testid="config-add" onClick={addConfigured}>
            Add to sale
          </Button>
        }
      >
        {configProduct ? (
          <ConfigBody
            product={configProduct}
            selection={selection}
            sellable={sellableNow()}
            onBump={bumpFlavor}
            onQty={(qty) => setSelection({ qty })}
            onUnit={(n) => setSelection((s) => ({ ...s, _unitPrice: n }))}
          />
        ) : null}
      </Sheet>

      <Sheet
        open={cartOpen}
        title="Review sale"
        onClose={() => setCartOpen(false)}
        dismissible={false}
        footer={
          <Button
            size="xl"
            data-testid="charge"
            disabled={!lines.length || !canCharge || paying}
            onClick={() => void charge()}
          >
            {paying
              ? 'Saving…'
              : payment === 'credit'
                ? `Record on credit · ${formatUGX(cartSum.value)}`
                : `Charge ${formatUGX(cartSum.value)}`}
          </Button>
        }
      >
        {cartBody}
      </Sheet>

      <Sheet
        open={Boolean(debtAsk)}
        title="Already owes"
        onClose={() => setDebtAsk(null)}
      >
        <p>
          {debtAsk?.name} already owes {formatUGX(debtAsk?.owed || 0)} on credit. Recording this sale
          adds another unpaid balance.
        </p>
        <div style={{ display: 'grid', gap: 'var(--s-2)', marginTop: 'var(--s-4)' }}>
          <Button
            size="lg"
            onClick={() => {
              debtClearedRef.current = true;
              setDebtAsk(null);
            }}
          >
            Record another credit
          </Button>
          <Button size="lg" variant="secondary" onClick={() => setDebtAsk(null)}>
            Not now
          </Button>
        </div>
      </Sheet>
    </section>
  );
}

function selectionOverStock(
  product: Product,
  selection: Record<string, number>,
  sellable: Record<string, number>,
) {
  if (product.rule === 'single_qty') {
    const id = product.categoryId || '';
    return (selection.qty || 0) > (sellable[id] || 0);
  }
  if (product.rule === 'choose_variety') {
    const fixed = product.fixedFlavor || 'classic';
    if ((sellable[fixed] || 0) < 1) return true;
  }
  return Object.entries(selection).some(([id, qty]) => {
    if (id === 'qty' || id === '_unitPrice' || qty <= 0) return false;
    return qty > (sellable[id] || 0);
  });
}

function ConfigBody({
  product,
  selection,
  sellable,
  onBump,
  onQty,
  onUnit,
}: {
  product: Product;
  selection: Record<string, number>;
  sellable: Record<string, number> | null;
  onBump: (id: string, d: number) => void;
  onQty: (n: number) => void;
  onUnit: (n: number) => void;
}) {
  if (product.rule === 'single_qty') {
    const max = sellable && product.categoryId ? sellable[product.categoryId] ?? 0 : null;
    const qty = selection.qty || 0;
    return (
      <div class="config-flavor">
        <span>
          Quantity
          {max != null ? <span class="v-muted"> · {max} in stock</span> : null}
        </span>
        <div class="stepper">
          <button
            type="button"
            aria-label="Decrease quantity"
            data-testid="config-qty-dec"
            onClick={() => onQty(Math.max(0, qty - 1))}
          >
            <IconMinus size={18} />
          </button>
          <span class="stepper__n">{qty}</span>
          <button
            type="button"
            aria-label="Increase quantity"
            data-testid="config-qty-inc"
            disabled={max != null && qty >= max}
            onClick={() => onQty(qty + 1)}
          >
            <IconPlus size={18} />
          </button>
        </div>
      </div>
    );
  }

  if (product.rule === 'cookie_wholesale') {
    const pool = configFlavorPool(product);
    return (
      <div style={{ display: 'grid', gap: 12 }}>
        <Field
          label="Unit price (UGX)"
          inputMode="numeric"
          value={String(selection._unitPrice || '')}
          onInput={(e) => onUnit(Math.max(0, Math.round(Number((e.target as HTMLInputElement).value) || 0)))}
        />
        {pool.map((id) => (
          <FlavorRow
            key={id}
            id={id}
            count={selection[id] || 0}
            max={sellable ? sellable[id] ?? 0 : null}
            onBump={onBump}
          />
        ))}
      </div>
    );
  }

  const pool = configFlavorPool(product);
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      {pool.map((id) => (
        <FlavorRow
          key={id}
          id={id}
          count={selection[id] || 0}
          max={sellable ? sellable[id] ?? 0 : null}
          onBump={onBump}
        />
      ))}
      {product.rule === 'choose_variety' ? (
        <p style={{ font: 'var(--t-meta)', color: 'var(--fg-3)' }}>
          Includes fixed {product.fixedFlavor || 'classic'}
        </p>
      ) : null}
    </div>
  );
}

function FlavorRow({
  id,
  count,
  max,
  onBump,
}: {
  id: string;
  count: number;
  max: number | null;
  onBump: (id: string, d: number) => void;
}) {
  const cat = CAT_MAP[id];
  const label =
    cat?.sub && cat.sub !== 'Cookie' ? `${cat.name} ${cat.sub}` : cat?.name || id;
  const atCap = max != null && count >= max;
  return (
    <div class="config-flavor">
      <span class="config-flavor__label">
        <FlavorDot color={cat?.color || '#ccc'} size="lg" />
        {label}
        {max != null ? <span class="v-muted"> · {max} in stock</span> : null}
      </span>
      <div class="stepper">
        <button
          type="button"
          aria-label={`Fewer ${label}`}
          data-testid={`config-flavor-${id}-dec`}
          onClick={() => onBump(id, -1)}
        >
          <IconMinus size={18} />
        </button>
        <span class="stepper__n">{count}</span>
        <button
          type="button"
          aria-label={`More ${label}`}
          data-testid={`config-flavor-${id}-inc`}
          disabled={atCap}
          onClick={() => {
            if (atCap) return;
            onBump(id, 1);
          }}
        >
          <IconPlus size={18} />
        </button>
      </div>
    </div>
  );
}
