import { deviceId } from './device-id';
import { postStoreReserve } from './store-reserve';
import { runCheckout, type CheckoutResult, type StockOverride } from './checkout';
import { ensureInventory, inventory, loadSales, loadStoreOrders, syncLabel, type StoreOrderRow } from './entities';
import { mapStoreOrderToCart } from '../domain/store-order-map';
import { cartStockShortfalls, sellAnywayMessage } from '../domain/stock-shortfall';

export type StoreOrderCheckoutResult = CheckoutResult | { ok: false; error: string; restored: false; cancelled?: boolean };

/**
 * Records the sale for a storefront order. It is the write path Load-into-sale then Checkout used, in one step:
 * claim the order for this phone, rebuild the lines from the order's own items, then runCheckout, which consumes
 * the stock hold, deducts what the hold did not cover, posts the sale and marks the order checked_out with its sale_id.
 * Only the delivery fee can differ from the order. A failed checkout hands the claim back.
 */
export async function checkoutStoreOrder(
  order: StoreOrderRow,
  opts: {
    customerName: string;
    /** Delivery fee in UGX after any edit. Null leaves the order's own fee (or none). */
    feeUgx: number | null;
    isCredit?: boolean;
    confirmShort?: (message: string) => boolean;
  },
): Promise<StoreOrderCheckoutResult> {
  const device_id = deviceId();
  const claim = await postStoreReserve({ op: 'claim', id: order.id, device_id });
  if (claim.network) {
    return { ok: false, error: 'No signal — this sale was not saved. Try again when you are back online.', restored: false };
  }
  if (!claim.ok && !claim.unsupported) {
    return { ok: false, error: claim.message || claim.error || 'Another phone is ringing this order up', restored: false };
  }
  const release = () => void postStoreReserve({ op: 'unclaim', id: order.id, device_id }).catch(() => {});

  const mapped = mapStoreOrderToCart({ ...order, items: (order.items || []) as never }, { customerName: opts.customerName });
  const delivery = mapped.meta.deliveryEnabled !== false;
  const checkout = { ...mapped.checkout };
  if (delivery && opts.feeUgx != null) {
    checkout.feeValue = String(Math.max(0, Math.round(opts.feeUgx)));
    checkout.feeManuallyEdited = true;
  }

  await ensureInventory().catch(() => {});
  // Units the hold already took out of stock are not short at checkout.
  const open = mapped.lines.filter((line) => !line.stockClaimed);
  const shortfalls = cartStockShortfalls(open, inventory.value, syncLabel.value === 'live');
  let stockOverride: StockOverride | undefined;
  if (shortfalls.length) {
    const ask = opts.confirmShort ?? ((message: string) => window.confirm(message));
    if (!ask(sellAnywayMessage(shortfalls))) {
      release();
      return { ok: false, error: 'Not sold', restored: false, cancelled: true };
    }
    stockOverride = {
      at: new Date().toISOString(),
      short: Object.fromEntries(shortfalls.map((row) => [row.id, row.short])),
    };
  }

  const isCredit = Boolean(opts.isCredit);
  const result = await runCheckout({
    lines: mapped.lines,
    meta: { ...mapped.meta, isCredit },
    isCredit,
    clientId: null,
    checkout,
    allowShortfall: Boolean(stockOverride),
    stockOverride,
  });
  if (!result.ok) {
    release();
    return result;
  }
  void loadSales({ force: true }).catch(() => {});
  await loadStoreOrders().catch(() => {});
  return result;
}
