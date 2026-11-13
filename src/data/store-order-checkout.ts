import { deviceId } from './device-id';
import { postStoreReserve } from './store-reserve';
import { runCheckout, type CheckoutResult, type StockOverride } from './checkout';
import { ensureInventory, inventory, inventoryFresh, loadStoreOrders, syncLabel, type StoreOrderRow } from './entities';
import { mapStoreOrderToCart } from '../domain/store-order-map';
import { cartStockShortfalls, sellAnywayMessage } from '../domain/stock-shortfall';

export type StoreOrderCheckoutResult = CheckoutResult | { ok: false; error: string; restored: false; cancelled?: boolean };

/**
 * Records the sale for a storefront order. It is the write path Load-into-sale then Checkout used, in one step:
 * rebuild the lines from the order's own items, then runCheckout, which consumes
 * the stock hold, deducts what the hold did not cover, posts the sale and marks the order checked_out with its sale_id.
 * Only the delivery fee can differ from the order. A failed checkout hands the claim back in the background.
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
  // No separate claim round trip: runCheckout's consume refuses an order another phone holds and keeps or sets this
  // phone as the claimant, which is the state claim-then-consume left. A failed charge hands the claim back.
  const release = () => void postStoreReserve({ op: 'unclaim', id: order.id, device_id }).catch(() => {});

  const mapped = mapStoreOrderToCart({ ...order, items: (order.items || []) as never }, { customerName: opts.customerName });
  const delivery = mapped.meta.deliveryEnabled !== false;
  const checkout = { ...mapped.checkout };
  if (delivery && opts.feeUgx != null) {
    checkout.feeValue = String(Math.max(0, Math.round(opts.feeUgx)));
    checkout.feeManuallyEdited = true;
  }

  if (!inventoryFresh()) await ensureInventory().catch(() => {});
  // Units the hold already took out of stock are not short at checkout.
  const open = mapped.lines.filter((line) => !line.stockClaimed);
  const shortfalls = cartStockShortfalls(open, inventory.value, syncLabel.value === 'live');
  let stockOverride: StockOverride | undefined;
  if (shortfalls.length) {
    const ask = opts.confirmShort ?? ((message: string) => window.confirm(message));
    if (!ask(sellAnywayMessage(shortfalls))) {
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
  // runCheckout already refreshes sales and flips the order locally; the order list re-syncs in the background.
  void loadStoreOrders().catch(() => {});
  return result;
}
