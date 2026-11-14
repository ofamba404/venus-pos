import { useEffect, useRef, useState } from 'preact/hooks';
import { PRODUCTS, CAT_MAP, type Product } from '../../domain/catalog';
import { kampalaInputToIso, kampalaLocalInput } from '../../domain/kampala-time';
import { itemToConfigSelection } from '../../domain/pricing/pack-config';
import { stockNotifyDecision } from '../../domain/stock-notify';
import { KEYS } from '../../data/keys';
import { clientOwesLabel } from '../../domain/parity';
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
import { deleteHeld, listHeld, saveHeld } from '../../data/held';
import { flushOutbox, listOutbox, outboxCountLabel } from '../../data/outbox';
import { clients, ensureInventory, inventory, loadClients, loadSales, sales, syncLabel } from '../../data/entities';
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
import { ProductGallery } from '../../ui/ProductGallery';
import { lineCount } from '../../domain/line-count';
import { ProductGrid } from '../../ui/ProductGrid';
import { DeliveryBlock } from '../../ui/DeliveryBlock';
import { CopyButton } from '../../ui/CopyButton';
import { copyAllText, copyLocationText, copyPhoneText } from '../../domain/delivery-copy';
import { TimePicker } from '../../ui/TimePicker';
import { cartFulfilment, saleSummaryLines } from '../../domain/sale-summary';
import { showSaleSuccess } from '../../ui/sale-success';
import { EmptyState } from '../../ui/EmptyState';
import { PlaceSearch } from '../../ui/PlaceSearch';
import { showToast } from '../../ui/ToastHost';
import { IconButton } from '../../ui/IconButton';
import { IconClose, IconPlus } from '../../ui/icons';
import { PhoneField } from '../../ui/PhoneField';

export function SellPage() {
  const [configProduct, setConfigProduct] = useState<Product | null>(null);
  const [selection, setSelection] = useState<Record<string, number>>({});
  const [cartOpen, setCartOpen] = useState(false);
  const [paying, setPaying] = useState(false);
  const [payment, setPayment] = useState<'paid' | 'credit'>('paid');
  const [heldSales, setHeldSales] = useState<HeldSale[]>([]);
  const [waiting, setWaiting] = useState(0);
  const [debtAsk, setDebtAsk] = useState<{ name: string; owed: number } | null>(null);
  const debtClearedRef = useRef(false);
  const placeGen = useRef(0);
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
    if (result.queued) {
      setWaiting((n) => n + 1);
      showToast('Queued offline');
    }
    const soldTotal = cartTotal(lines);
    const soldClient = String(meta.clientName || '').trim() || 'Walk-in';
    const soldOnCredit = payment === 'credit';
    clearCartKeepMeta();
    clearCheckoutDraft();
    setOrderMetaPatch({
      clientName: '',
      clientId: '',
      isCredit: false,
      deliveryLocationLabel: '',
      deliveryTimeLabel: '',
      deliveryDeliverAt: '',
      clientPhone: '',
    });
    setPayment('paid');
    setCartOpen(false);
    setPaying(false);
    showSaleSuccess(
      {
        total: soldTotal,
        client: soldClient,
        credit: soldOnCredit,
        queued: Boolean(result.queued),
        lines: saleSummaryLines(lines),
        fulfilment: cartFulfilment({
          deliveryEnabled: meta.deliveryEnabled !== false,
          place: draft.destText || meta.deliveryLocationLabel,
        }),
      },
      result.delivery,
    );
  }

  async function parkSale() {
    const snap = toHeldSale(cartState.value);
    if (!snap) return;
    try {
      await saveHeld(snap);
    } catch {
      showToast('Could not hold this sale');
      return;
    }
    clearCartKeepMeta();
    setOrderMetaPatch({ clientName: '', clientId: '', isCredit: false });
    setHeldSales(await listHeld());
    showToast('Held on this phone');
  }

  async function resumeSale(id: string) {
    const row = (await listHeld()).find((item) => item.id === id);
    if (!row) return;
    if (lines.length) {
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
        : 'Add a client to continue';

  // The rider collects only when this sale is unpaid: On credit. Paid never shows a Collect line.
  const collectNow = payment === 'credit' ? cartSum.value : 0;
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
        <EmptyState title="No items yet" body="Tap a product to start the sale" />
      ) : (
        <div>
          {lines.map((line) => {
            const { qty, contents } = lineCount(line);
            return (
            <div class="v-cart-line" key={line.key}>
              <ProductGallery productId={line.productId} breakdown={line.breakdown} size={64} testId="line-gallery" />
              <div class="v-cart-line__main">
                <div class="v-cart-line__head">
                  <div class="v-list-row__title">
                    {line.name}
                    {qty > 1 ? (
                      <span class="v-qty-inline" aria-label={`Quantity ${qty}`} data-testid="line-qty">
                        ×{qty}
                      </span>
                    ) : null}
                  </div>
                  <Money className="v-money--total" value={line.isReward ? 0 : line.lineTotal} />
                </div>
                {contents ? (
                  <div class="v-cart-line__contents" data-testid="line-contents">
                    {contents}
                  </div>
                ) : null}
                <FlavorSwatches breakdown={line.breakdown} productId={line.productId} />
              </div>
              <IconButton size="sm" label={`Edit ${line.name}`} onClick={() => openLine(line)}>
                <IconPlus size={18} />
              </IconButton>
              <IconButton
                size="sm"
                label={`Remove ${line.name}`}
                onClick={() => {
                  dispatchCart({ type: 'remove_line', key: line.key });
                  showToast('Removed', {
                    actionLabel: 'Undo',
                    onAction: () => dispatchCart({ type: 'add_line', line }),
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
          label="Client"
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
        {(features.walkInClient || recentClients.length) ? (
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
            <div class="v-field-copy">
              <PlaceSearch
                value={draft.destText || meta.deliveryLocationLabel || ''}
                onPick={onPlacePick}
              />
              <CopyButton
                kind="place"
                label="Copy"
                ariaLabel="Copy location"
                compact
                testId="copy-location"
                value={() =>
                  copyLocationText({
                    place: checkoutDraft.value.destText || orderMeta.value.deliveryLocationLabel || '',
                    lat: checkoutDraft.value.dest?.lat ?? null,
                    lng: checkoutDraft.value.dest?.lng ?? null,
                  })
                }
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
            <div class="v-field-copy">
              <PhoneField
                testId="delivery-phone"
                value={meta.clientPhone}
                onChange={(clientPhone) => setOrderMetaPatch({ clientPhone })}
              />
              <CopyButton
                kind="phone"
                label="Copy"
                ariaLabel="Copy phone"
                compact
                testId="copy-phone"
                value={() => copyPhoneText(orderMeta.value.clientPhone)}
              />
            </div>
            <TimePicker
              value={kampalaLocalInput(meta.deliveryDeliverAt)}
              onChange={(value) => setOrderMetaPatch({ deliveryDeliverAt: kampalaInputToIso(value) })}
            />
            <div class="v-copy-row v-copy-row--end">
              <CopyButton
                kind="all"
                label="Copy all"
                testId="copy-all"
                value={() =>
                  copyAllText({
                    name: orderMeta.value.clientName,
                    phone: orderMeta.value.clientPhone,
                    place: checkoutDraft.value.destText || orderMeta.value.deliveryLocationLabel || '',
                    lat: checkoutDraft.value.dest?.lat ?? null,
                    lng: checkoutDraft.value.dest?.lng ?? null,
                    collect: collectNow,
                  })
                }
              />
            </div>
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
          <Money className="v-money--total" value={cartSum.value} size="xl" />
        </div>
        {features.holdSale && lines.length ? (
          <Button size="md" variant="ghost" data-testid="hold-sale" onClick={() => void parkSale()}>
            Hold on this phone
          </Button>
        ) : null}
      </div>
    </>
  );

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
        <ProductGrid onPick={openConfig} />
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
            disabled={!lines.length || !canCharge}
            loading={paying}
            onClick={() => void charge()}
          >
            {payment === 'credit'
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
              disabled={!lines.length || !canCharge}
            loading={paying}
              onClick={() => void charge()}
            >
              {payment === 'credit'
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
