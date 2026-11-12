import { useEffect, useRef, useState } from 'preact/hooks';
import { PRODUCTS, CAT_MAP, type Product } from '../../domain/catalog';
import { productImageSrc } from '../../domain/product-art';
import { localPhoneDigits } from '../../domain/phone';
import { kampalaInputToIso, kampalaLocalInput } from '../../domain/kampala-time';
import { itemToConfigSelection } from '../../domain/pricing/pack-config';
import { stockNotifyDecision } from '../../domain/stock-notify';
import { KEYS } from '../../data/keys';
import { cancelledOrderBanner, clientOwesLabel, successCopy } from '../../domain/parity';
import { cartStockShortfalls, sellAnywayMessage } from '../../domain/stock-shortfall';
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
import { configReady, configTarget } from '../../domain/pricing/pack-config';
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
import { patchStoreOrder } from '../../data/writes/store-orders';
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
import { FlavorSwatches } from '../../ui/FlavorSwatches';
import { FlavorPicker } from '../../ui/FlavorPicker';
import { CopyButton } from '../../ui/CopyButton';
import { LoadedOrderCard } from '../../ui/LoadedOrderCard';
import { ProductCard } from '../../ui/ProductCard';
import { DeliveryBlock } from '../../ui/DeliveryBlock';
import { TimePicker } from '../../ui/TimePicker';
import { Celebration } from '../../ui/Celebration';
import { EmptyState } from '../../ui/EmptyState';
import { PlaceSearch } from '../../ui/PlaceSearch';
import { showToast } from '../../ui/ToastHost';
import { IconButton } from '../../ui/IconButton';
import { IconClose, IconPlus } from '../../ui/icons';

const PACKS = PRODUCTS.filter(
  (p) => !p.retired && (p.rule === 'choose_any' || p.rule === 'choose_variety'),
);
const SINGLES = PRODUCTS.filter(
  (p) => p.rule === 'single_qty' || p.rule === 'spliff_qty' || p.rule === 'cookie_qty',
);
const WHOLESALE = PRODUCTS.filter((p) => p.rule === 'cookie_wholesale');

function productKind(p: Product) {
  return String(p.id).startsWith('cookie') ? 'cookie' : 'joint';
}

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
  const [deliveryPending, setDeliveryPending] = useState(false);
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
    if (!configReady(configProduct, selection)) {
      const target = configTarget(configProduct);
      showToast(target === null ? 'Pick at least one' : `Pick exactly ${target}`);
      return;
    }
    const line = buildCartLine(configProduct, selection, { otherLines: lines });
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
    const shortfalls = cartStockShortfalls(lines, inventory.value, syncLabel.value === 'live');
    let stockOverride: { at: string; short: Record<string, number> } | undefined;
    if (shortfalls.length) {
      const ok = window.confirm(sellAnywayMessage(shortfalls));
      if (!ok) return;
      stockOverride = {
        at: new Date().toISOString(),
        short: Object.fromEntries(shortfalls.map((row) => [row.id, row.short])),
      };
    }
    setPaying(true);
    const beforeStock = { ...inventory.value };
    const result = await runCheckout({
      lines,
      meta: { ...meta, isCredit: payment === 'credit' },
      isCredit: payment === 'credit',
      clientId: meta.clientId || null,
      checkout: draft,
      allowShortfall: Boolean(stockOverride),
      stockOverride,
    });
    if (!result.ok) {
      setPaying(false);
      showToast(result.error);
      return;
    }
    if (!result.queued) {
      let fired: Record<string, string> = {};
      try {
        fired = JSON.parse(localStorage.getItem(KEYS.notifStock) || '{}') as Record<string, string>;
      } catch {
        fired = {};
      }
      const prefs = (() => {
        try {
          return JSON.parse(localStorage.getItem(KEYS.notifPrefs) || '{}') as { stock?: boolean };
        } catch {
          return {};
        }
      })();
      if (prefs.stock !== false) {
        for (const [id, prev] of Object.entries(beforeStock)) {
          const next = inventory.value[id] ?? 0;
          if (next === prev) continue;
          const decision = stockNotifyDecision(id, Number(prev), next, fired);
          fired = decision.fired;
          const label = CAT_MAP[id]?.name || id;
          if (decision.toast === 'out') showToast(`${label} is out of stock`);
          else if (decision.toast === 'low') showToast(`${label} is running low`);
        }
        try {
          localStorage.setItem(KEYS.notifStock, JSON.stringify(fired));
        } catch {
          /* private mode */
        }
      }
    }
    haptic(15);
    setQueuedNote(Boolean(result.queued));
    if (result.queued) {
      setWaiting((n) => n + 1);
      showToast('Queued offline');
    }
    const delivery = result.delivery;
    setDeliveryPending(Boolean(delivery));
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
    void loadSales({ force: true }).catch(() => {});
    if (delivery) {
      await delivery;
      setDeliveryPending(false);
    }
    setPaying(false);
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
    const res = await patchStoreOrder(id, {
      status: 'confirmed',
      confirmed_at: new Date().toISOString(),
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
  const chargeReason = !lines.length
    ? ''
    : canCharge
      ? ''
      : credit && isWalkInCheckout(meta, false)
        ? 'Credit needs a client name'
        : 'Add a customer to continue';

  const loadedOrderProps = {
    name: meta.clientName,
    delivery: meta.deliveryEnabled !== false,
    timeLabel: meta.deliveryTimeLabel,
    place: draft.destText || meta.deliveryLocationLabel || '',
    phone: meta.clientPhone,
    itemCount: cartCount.value,
    total: cartSum.value,
  };

  const cartBody = (
    <>
      {meta.storeOrderId ? (
        <div style={{ marginBottom: 'var(--s-3)' }}>
          <LoadedOrderCard {...loadedOrderProps} testId="loaded-order-cart" />
        </div>
      ) : null}
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
        <EmptyState title="No items yet" body="Tap a product to start the sale" />
      ) : (
        <div>
          {lines.map((line) => {
            const qty = Object.values(line.breakdown || {}).reduce((sum, n) => sum + (Number(n) || 0), 0);
            const art = productImageSrc(line.productId, line.breakdown);
            return (
            <div class="v-cart-line" key={line.key}>
              {art ? <img class="v-thumb" src={art} alt="" /> : null}
              {qty > 0 ? (
                <span class="v-qty" aria-label={`Quantity ${qty}`}>
                  {qty}
                </span>
              ) : null}
              <div class="v-cart-line__main">
                <div class="v-cart-line__head">
                  <div class="v-list-row__title">{line.name}</div>
                  <Money className="v-money--amber" value={line.isReward ? 0 : line.lineTotal} />
                </div>
                <FlavorSwatches breakdown={line.breakdown} productId={line.productId} />
              </div>
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
            );
          })}
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
        {!meta.storeOrderId && (features.walkInClient || recentClients.length) ? (
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
            {recentClients.map((c) => {
              const owes = clientOwesLabel(openDebtForClientName(c.name || '', clients.value, sales.value));
              return (
                <button
                  key={c.id}
                  type="button"
                  class="v-tag"
                  onClick={() => setOrderMetaPatch({ clientName: c.name || '', clientId: c.id })}
                >
                  {owes ? `${c.name} · ${owes}` : c.name}
                </button>
              );
            })}
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
          <DeliveryBlock>
            <Button size="md" variant="secondary" data-testid="pickup-locate" onClick={locatePickup}>
              Use GPS
            </Button>
            <button type="button" class="pickup-control" data-testid="pickup-label" onClick={locatePickup}>
              {draft.originText || 'Shop pickup'}
            </button>
            <div class="v-fact">
              <PlaceSearch
                value={draft.destText || meta.deliveryLocationLabel || ''}
                onPick={onPlacePick}
              />
              <CopyButton
                kind="place"
                ariaLabel="Copy delivery location"
                testId="copy-location"
                value={() => draft.destText || meta.deliveryLocationLabel || ''}
              />
            </div>
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
            <div class="v-fact">
              <Field
                label="Phone"
                data-testid="delivery-phone"
                value={meta.clientPhone}
                placeholder="+256…"
                onInput={(e) => setOrderMetaPatch({ clientPhone: (e.target as HTMLInputElement).value })}
              />
              <CopyButton
                kind="phone"
                ariaLabel="Copy phone number"
                testId="copy-phone"
                value={() => localPhoneDigits(meta.clientPhone)}
              />
            </div>
            <TimePicker
              value={kampalaLocalInput(meta.deliveryDeliverAt)}
              onChange={(value) => setOrderMetaPatch({ deliveryDeliverAt: kampalaInputToIso(value) })}
            />
            {draft.distanceKm != null ? (
              <p class="v-muted">
                {Number(draft.distanceKm).toFixed(1)} km
                {draft.durationMin != null ? ` · ~${Math.round(Number(draft.durationMin))} min` : ''}
                {draft.predictedFee != null && !draft.feeManuallyEdited
                  ? ` · Delivery est. ${formatUGX(Number(draft.predictedFee))}`
                  : ''}
              </p>
            ) : null}
          </DeliveryBlock>
        ) : null}
        <div class="cart-total">
          <span class="cart-total__label">Total</span>
          <Money className="v-money--amber" value={cartSum.value} size="xl" />
        </div>
        {meta.storeOrderId ? (
          <div class="v-action-stack">
            <div class="v-section-label">Store order</div>
            {cancelledOrderBanner(storeOrders.value.find((row) => row.id === meta.storeOrderId)?.status) ? (
              <p data-testid="cancelled-banner">
                {cancelledOrderBanner(storeOrders.value.find((row) => row.id === meta.storeOrderId)?.status)}
              </p>
            ) : null}
            <Button size="md" variant="secondary" data-testid="confirm-store-order" onClick={() => void confirmLoadedOrder()}>
              Confirm
            </Button>
            <Button
              size="md"
              variant="secondary"
              data-testid="release-store-order"
              onClick={() => setOrderMetaPatch({ storeOrderId: '' })}
            >
              Unlink order
            </Button>
            <p class="v-muted">
              Checkout records the sale. Confirm tells the store the order is accepted. Unlink keeps these items but stops
              treating them as a store order.
            </p>
          </div>
        ) : null}
        {features.holdSale && lines.length && !meta.storeOrderId ? (
          <Button size="md" variant="ghost" data-testid="hold-sale" onClick={() => void parkSale()}>
            Hold on this phone
          </Button>
        ) : null}
      </div>
    </>
  );

  if (successTotal != null) {
    return (
      <Celebration
        total={formatUGX(successTotal)}
        message={successCopy({ queued: queuedNote, credit: payment === 'credit', savingDelivery: deliveryPending })}
        onNext={() => {
          setSuccessTotal(null);
          setQueuedNote(false);
          setDeliveryPending(false);
          setPayment('paid');
        }}
      />
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
        {meta.storeOrderId ? (
          <div class="v-loaded-order--page">
            <LoadedOrderCard
              {...loadedOrderProps}
              onReview={() => setCartOpen(true)}
              onUnlink={() => setOrderMetaPatch({ storeOrderId: '' })}
            />
          </div>
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
            <ProductCard
              key={p.id}
              id={p.id}
              name={p.name}
              kind={productKind(p)}
              image={productImageSrc(p.id)}
              meta={`${p.joints} ${p.slotNoun || (Number(p.joints) === 1 ? 'joint' : 'joints')}`}
              price={productPriceLabel(p)}
              onClick={() => openConfig(p)}
            />
          ))}
        </div>
        <div class="v-section-label">Singles</div>
        <div class="tile-grid">
          {SINGLES.map((p) => (
            <ProductCard
              key={p.id}
              id={p.id}
              name={p.name}
              kind={productKind(p)}
              image={productImageSrc(p.id)}
              meta={p.unitLabel || 'per joint'}
              price={productPriceLabel(p)}
              onClick={() => openConfig(p)}
            />
          ))}
        </div>
        {WHOLESALE.length ? (
          <>
            <div class="v-section-label">Wholesale</div>
            <div class="tile-grid">
              {WHOLESALE.map((p) => (
                <ProductCard
                  key={p.id}
                  id={p.id}
                  name={p.name}
                  kind={productKind(p)}
                  image={productImageSrc(p.id)}
                  art="swatches"
                  price={productPriceLabel(p)}
                  onClick={() => openConfig(p)}
                />
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
            className={chargeReason ? 'v-btn--reason' : ''}
            disabled={!lines.length || !canCharge || paying}
            onClick={() => void charge()}
          >
            {paying
              ? 'Saving…'
              : payment === 'credit'
                ? `Record on credit · ${formatUGX(cartSum.value)}`
                : `Checkout ${formatUGX(cartSum.value)}`}
          </Button>
          {chargeReason ? (
            <p class="charge-reason" data-testid="charge-reason">
              {chargeReason}
            </p>
          ) : null}
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
          <Button
            size="xl"
            data-testid="config-add"
            disabled={!configProduct || !configReady(configProduct, selection)}
            onClick={addConfigured}
          >
            {configProduct && configTarget(configProduct) !== null && !configReady(configProduct, selection)
              ? `Pick ${configTarget(configProduct)} to add`
              : 'Add to sale'}
          </Button>
        }
      >
        {configProduct ? (
          <FlavorPicker
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
          <div>
            <Button
              size="xl"
              data-testid="charge"
              className={chargeReason ? 'v-btn--reason' : ''}
              disabled={!lines.length || !canCharge || paying}
              onClick={() => void charge()}
            >
              {paying
                ? 'Saving…'
                : payment === 'credit'
                  ? `Record on credit · ${formatUGX(cartSum.value)}`
                  : `Checkout ${formatUGX(cartSum.value)}`}
            </Button>
            {chargeReason ? (
              <p class="charge-reason" data-testid="charge-reason">
                {chargeReason}
              </p>
            ) : null}
          </div>
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
