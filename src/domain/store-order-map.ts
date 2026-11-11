/**
 * Storefront order row → cart lines + meta + checkout seed.
 * Pure port of `rowsToCartLines` / `resolveStoreLineName` /
 * `applyStorefrontOrderToCart` core (no DOM / session writes).
 */
import { PRODUCTS, cookieLineDisplayName, type Product } from './catalog';
import type { CartLine, OrderMeta } from './cart';
import { defaultOrderMeta } from './cart';
import type { CheckoutDeliveryInput, LatLng } from './sale-payload';

export const STORE_COOKIE_TITLES: Record<string, string> = {
  'butterscotch-cookie': 'Butterscotch Cookie',
  'strawberry-cookie': 'Strawberry Cookie',
  'mint-cookie': 'Mint Cookie',
  'chocolate-cookie': 'Chocolate Cookie',
  'cookie-duet': 'Cookie Duet',
  'cookie-trio': 'Cookie Trio',
  'cookie-quartet': 'Cookie Quartet',
};

export type StoreOrderLine = {
  product_id?: string;
  store_product_id?: string;
  product_name?: string;
  detail?: string;
  breakdown?: Record<string, unknown>;
  line_total?: number;
  is_reward?: boolean;
  reward_key?: string;
  points_cost?: number;
};

export type StoreOrderLike = {
  id?: string;
  phone_e164?: string;
  delivery_enabled?: boolean;
  delivery?: {
    mode?: string;
    label?: string;
    deliverAt?: string;
    stock_reservation?: { state?: string };
  };
  delivery_fee_ugx?: number | null;
  delivery_distance_km?: number | null;
  delivery_duration_min?: number | null;
  location_label?: string;
  location_lat?: number | null;
  location_lng?: number | null;
  items?: StoreOrderLine[];
  customer_name?: string;
};

export type MappedStoreOrder = {
  lines: CartLine[];
  meta: OrderMeta;
  checkout: CheckoutDeliveryInput & {
    dest: LatLng | null;
    destText: string;
    feeValue: string;
    feeManuallyEdited: boolean;
    predictedFee: number | null;
  };
};

export function resolveStoreLineName(
  line: StoreOrderLine,
  product: Product | undefined,
): string {
  const storeId = String(line.store_product_id || '').toLowerCase();
  if (STORE_COOKIE_TITLES[storeId]) return STORE_COOKIE_TITLES[storeId]!;

  const synced = String(line.product_name || '').trim();
  const productId = String(line.product_id || product?.id || '');
  const breakdown =
    line.breakdown && typeof line.breakdown === 'object' ? line.breakdown : {};

  if (synced && synced !== 'Cookies') return synced;

  const fromFlavor = cookieLineDisplayName(productId, breakdown, '');
  if (fromFlavor) return fromFlavor;

  return synced || product?.name || 'Item';
}

export function rowsToCartLines(
  items: StoreOrderLine[] | null | undefined,
  opts: { now?: number; rand?: () => number; stockClaimed?: boolean } = {},
): CartLine[] {
  const now = opts.now ?? Date.now();
  const rand = opts.rand ?? Math.random;
  const stockClaimed = Boolean(opts.stockClaimed);
  return (Array.isArray(items) ? items : []).map((line, index) => {
    const productId = String(line.product_id || '');
    const product = PRODUCTS.find((p) => p.id === productId);
    const isReward = Boolean(line.is_reward) || Boolean(line.reward_key);
    return {
      key: `store-${productId}-${now}-${index}-${rand().toString(36).slice(2, 6)}`,
      productId,
      name: resolveStoreLineName(line, product),
      detail: String(line.detail || ''),
      breakdown:
        line.breakdown && typeof line.breakdown === 'object'
          ? ({ ...line.breakdown } as Record<string, number>)
          : {},
      lineTotal: isReward ? 0 : Math.round(Number(line.line_total) || 0),
      stockDeferred: true,
      ...(stockClaimed ? { stockClaimed: true } : {}),
      isReward,
      rewardKey: isReward ? String(line.reward_key || '') : '',
      pointsCost: isReward ? Math.max(0, Math.round(Number(line.points_cost) || 0)) : 0,
    };
  });
}

/**
 * Pure mapping of a storefront order into cart state + checkout seed.
 * Does not predict boda fees (that stays in delivery-fee domain / data layer).
 */
export function mapStoreOrderToCart(
  order: StoreOrderLike,
  opts: {
    customerName?: string;
    now?: number;
    rand?: () => number;
  } = {},
): MappedStoreOrder {
  const wantsDelivery = order.delivery_enabled !== false;
  const delivery = order.delivery || {};
  const deliveryLabel = String(delivery.label || '').trim();
  const locationText = wantsDelivery ? String(order.location_label || '').trim() : '';

  const meta: OrderMeta = {
    ...defaultOrderMeta(),
    clientName: String(opts.customerName || order.customer_name || '').trim(),
    clientId: '',
    isCredit: false,
    clientPhone: String(order.phone_e164 || '').trim(),
    deliveryEnabled: wantsDelivery,
    deliveryTimeLabel: deliveryLabel,
    deliveryLocationLabel: locationText,
    deliveryTimeMode: String(delivery.mode || ''),
    deliveryDeliverAt: String(delivery.deliverAt || ''),
    storeOrderId: String(order.id || ''),
  };

  const checkout: MappedStoreOrder['checkout'] = {
    dest: null,
    destText: '',
    feeValue: '',
    distanceKm: null,
    durationMin: null,
    feeManuallyEdited: false,
    predictedFee: null,
  };

  if (wantsDelivery) {
    checkout.destText = locationText;
    const locationLat = order.location_lat;
    const locationLng = order.location_lng;
    if (
      locationLat != null &&
      locationLng != null &&
      !Number.isNaN(Number(locationLat)) &&
      !Number.isNaN(Number(locationLng))
    ) {
      checkout.dest = { lat: Number(locationLat), lng: Number(locationLng) };
    }
    if (order.delivery_fee_ugx != null && !Number.isNaN(Number(order.delivery_fee_ugx))) {
      const seeded = Math.round(Number(order.delivery_fee_ugx));
      checkout.feeValue = String(seeded);
      checkout.feeManuallyEdited = false;
      checkout.predictedFee = seeded;
    }
    if (
      order.delivery_distance_km != null &&
      !Number.isNaN(Number(order.delivery_distance_km))
    ) {
      checkout.distanceKm = Number(order.delivery_distance_km);
    }
    if (
      order.delivery_duration_min != null &&
      !Number.isNaN(Number(order.delivery_duration_min))
    ) {
      checkout.durationMin = Number(order.delivery_duration_min);
    }
  }

  const reservationState = order.delivery?.stock_reservation?.state;
  const stockClaimed = reservationState === 'held' || reservationState === 'consumed';

  return {
    lines: rowsToCartLines(order.items, { now: opts.now, rand: opts.rand, stockClaimed }),
    meta,
    checkout,
  };
}
