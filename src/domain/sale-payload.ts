/**
 * Sale POST body + fulfillment fields — pure port of
 * `legacy/js/orders.js` checkout body (`2454-2485`) and
 * `buildSaleFulfillmentFields` (`298-334`).
 */
import type { CartLine, OrderMeta } from './cart';
import { cartTotal } from './cart';

export type LatLng = { lat?: number | null; lng?: number | null };

export type CheckoutDeliveryInput = {
  dest?: LatLng | null;
  destText?: string;
  feeValue?: string | number | null;
  distanceKm?: number | null;
  durationMin?: number | null;
};

export type SaleItemPayload = {
  product_id: string;
  product_name: string;
  detail: string;
  line_total: number;
  breakdown: Record<string, number>;
  is_reward?: boolean;
  reward_key?: string;
  points_cost?: number;
  wholesale_unit_price?: number;
  stock_override?: {
    at: string;
    short: Record<string, number>;
    name?: string;
  };
};

export type SaleFulfillmentFields = {
  client_phone: string | null;
  delivery_enabled: boolean;
  delivery: { mode?: string; label?: string; deliverAt?: string };
  location_label: string | null;
  location_lat: number | null;
  location_lng: number | null;
  delivery_fee_ugx: number | null;
  delivery_distance_km: number | null;
  delivery_duration_min: number | null;
  store_order_id: string | null;
};

export type SalePostBody = SaleFulfillmentFields & {
  items: SaleItemPayload[];
  total_ugx: number;
  client_id: string | null;
  is_credit: boolean;
  credit_cleared: boolean;
  amount_paid_ugx: number;
  cleared_at: null;
};

export function buildSaleItems(lines: CartLine[] | null | undefined): SaleItemPayload[] {
  return (lines || []).map((i) => ({
    product_id: i.productId,
    product_name: i.name,
    detail: i.detail,
    line_total: Boolean(i.isReward) ? 0 : i.lineTotal,
    breakdown: i.breakdown,
    ...(Boolean(i.isReward)
      ? {
          is_reward: true,
          reward_key: String(i.rewardKey || ''),
          points_cost: Math.max(0, Math.round(Number(i.pointsCost) || 0)),
        }
      : {}),
    ...(i.wholesaleUnitPrice
      ? { wholesale_unit_price: Math.round(Number(i.wholesaleUnitPrice) || 0) }
      : {}),
  }));
}

/** Snapshot review-cart / storefront fulfillment for the `sales` row. */
export function buildSaleFulfillmentFields(
  meta: Partial<OrderMeta> | null | undefined,
  checkout: CheckoutDeliveryInput = {},
): SaleFulfillmentFields {
  const m = meta || {};
  const phone = String(m.clientPhone || '').trim();
  const locationLabel = String(m.deliveryLocationLabel || checkout.destText || '').trim();
  const deliveryLabel = String(m.deliveryTimeLabel || '').trim();
  const deliveryMode = String(m.deliveryTimeMode || '').trim();
  const deliverAt = String(m.deliveryDeliverAt || '').trim();
  const linkedStoreOrderId = String(m.storeOrderId || '').trim();
  const feeParsed = parseInt(String(checkout.feeValue ?? ''), 10);
  const lat = checkout.dest?.lat != null ? Number(checkout.dest.lat) : NaN;
  const lng = checkout.dest?.lng != null ? Number(checkout.dest.lng) : NaN;

  const delivery: { mode?: string; label?: string; deliverAt?: string } = {};
  if (deliveryMode) delivery.mode = deliveryMode;
  if (deliveryLabel) delivery.label = deliveryLabel;
  if (deliverAt) delivery.deliverAt = deliverAt;

  return {
    client_phone: phone || null,
    delivery_enabled: m.deliveryEnabled !== false,
    delivery,
    location_label: locationLabel || null,
    location_lat: Number.isFinite(lat) ? lat : null,
    location_lng: Number.isFinite(lng) ? lng : null,
    delivery_fee_ugx: Number.isFinite(feeParsed) && feeParsed >= 0 ? feeParsed : null,
    delivery_distance_km:
      checkout.distanceKm == null || Number.isNaN(Number(checkout.distanceKm))
        ? null
        : Number(checkout.distanceKm),
    delivery_duration_min:
      checkout.durationMin == null || Number.isNaN(Number(checkout.durationMin))
        ? null
        : Number(checkout.durationMin),
    store_order_id: linkedStoreOrderId || null,
  };
}

export function buildSalePostBody(input: {
  lines: CartLine[];
  meta: Partial<OrderMeta>;
  clientId: string | null;
  isCredit: boolean;
  checkout?: CheckoutDeliveryInput;
}): SalePostBody {
  const total = cartTotal(input.lines);
  const isCredit = Boolean(input.isCredit);
  return {
    items: buildSaleItems(input.lines),
    total_ugx: total,
    client_id: input.clientId,
    is_credit: isCredit,
    credit_cleared: !isCredit,
    amount_paid_ugx: isCredit ? 0 : total,
    cleared_at: null,
    ...buildSaleFulfillmentFields(input.meta, input.checkout),
  };
}
