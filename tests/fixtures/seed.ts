/**
 * Synthetic seed data for the mock backend. No real customer PII.
 * Fixed clock for tests: 2026-11-10T10:30:00+03:00
 */
import { CATEGORIES } from '../../src/domain/catalog';

export const FIXED_NOW = '2026-11-10T07:30:00.000Z'; // 10:30 Africa/Kampala

let idCounter = 0;
export function resetIds() {
  idCounter = 0;
}
export function nextId(prefix = '00000000-0000-4000-8000-'): string {
  idCounter += 1;
  return `${prefix}${String(idCounter).padStart(12, '0')}`;
}

function daysAgo(n: number): string {
  const d = new Date(FIXED_NOW);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString();
}

export type SeedDb = ReturnType<typeof buildDefaultSeed>;

export function buildDefaultSeed() {
  resetIds();

  const inventory = CATEGORIES.map((c) => {
    let stock = 40;
    // Sale scenarios check out mint. The counter stops at zero, so the seed keeps it in stock.
    if (c.id === 'mint') stock = 20;
    else if (c.id === 'strawberry') stock = 3;
    else if (c.id === 'classic') stock = 5;
    else if (c.id === 'cookie_mint') stock = 25;
    else if (c.id === 'cookie_butterscotch') stock = 80;
    else if (c.id === 'cookie_chocolate') stock = 12;
    return {
      category_id: c.id,
      stock,
      display_name: c.name,
      category_sub: c.sub,
      color: c.color,
      updated_at: FIXED_NOW,
    };
  });
  // Legacy aggregate key for normalisation tests
  inventory.push({
    category_id: 'cookie',
    stock: 0,
    display_name: 'Cookie (legacy)',
    category_sub: '',
    color: '#D4A355',
    updated_at: FIXED_NOW,
  });

  const clients = Array.from({ length: 10 }, (_, i) => ({
    id: nextId(),
    name: `Test Client ${String.fromCharCode(65 + i)}`,
    phone: i === 1 ? '0772111222' : null,
    created_at: daysAgo(90 - i),
  }));
  // Near-duplicate names for merge logic
  clients.push({
    id: nextId(),
    name: 'Test Client A',
    phone: null,
    created_at: daysAgo(10),
  });
  const clientDebt = {
    id: nextId(),
    name: 'Client With Debt',
    phone: '0700333444',
    created_at: daysAgo(12),
  };
  clients.push(clientDebt);

  const clientA = clients[0]!;
  const clientB = clients[1]!;

  const sales = [
    {
      id: nextId(),
      created_at: daysAgo(0),
      client_id: clientA.id,
      total_ugx: 15000,
      is_credit: false,
      credit_cleared: false,
      amount_paid_ugx: 15000,
      cleared_at: null,
      items: [
        {
          product_id: 'cookie_duet',
          product_name: 'Cookie Duet',
          detail: 'Mint, Chocolate',
          line_total: 15000,
          breakdown: { cookie_mint: 1, cookie_chocolate: 1 },
        },
      ],
      client_phone: null,
      delivery_enabled: false,
      delivery: null,
      location_label: null,
      location_lat: null,
      location_lng: null,
      delivery_fee_ugx: null,
      delivery_distance_km: null,
      delivery_duration_min: null,
      store_order_id: null,
    },
    {
      id: nextId(),
      created_at: daysAgo(2),
      client_id: clientB.id,
      total_ugx: 26000,
      is_credit: true,
      credit_cleared: false,
      amount_paid_ugx: 0,
      cleared_at: null,
      items: [
        {
          product_id: 'cookie_single',
          product_name: 'Cookies',
          detail: '4 × Mint',
          line_total: 26000,
          breakdown: { cookie_mint: 4 },
        },
      ],
      client_phone: null,
      delivery_enabled: false,
      delivery: null,
      location_label: null,
      location_lat: null,
      location_lng: null,
      delivery_fee_ugx: null,
      delivery_distance_km: null,
      delivery_duration_min: null,
      store_order_id: null,
    },
    {
      id: nextId(),
      created_at: daysAgo(5),
      client_id: clientB.id,
      total_ugx: 8000,
      is_credit: true,
      credit_cleared: false,
      amount_paid_ugx: 0,
      cleared_at: null,
      items: [
        {
          product_id: 'scout',
          product_name: 'Scout Pack',
          detail: 'Mint',
          line_total: 8000,
          breakdown: { mint: 1 },
        },
      ],
      client_phone: null,
      delivery_enabled: false,
      delivery: null,
      location_label: null,
      location_lat: null,
      location_lng: null,
      delivery_fee_ugx: null,
      delivery_distance_km: null,
      delivery_duration_min: null,
      store_order_id: null,
    },
    {
      id: nextId(),
      created_at: daysAgo(4),
      client_id: clientDebt.id,
      total_ugx: 15000,
      is_credit: true,
      credit_cleared: false,
      amount_paid_ugx: 0,
      cleared_at: null,
      items: [
        {
          product_id: 'pilot',
          product_name: 'Pilot Pack',
          detail: 'Mint, Strawberry',
          line_total: 15000,
          breakdown: { mint: 1, strawberry: 1 },
        },
      ],
      client_phone: null,
      delivery_enabled: false,
      delivery: null,
      location_label: null,
      location_lat: null,
      location_lng: null,
      delivery_fee_ugx: null,
      delivery_distance_km: null,
      delivery_duration_min: null,
      store_order_id: null,
    },
    {
      id: 'seed-sale-1',
      created_at: daysAgo(8),
      client_id: clientA.id,
      total_ugx: 8000,
      is_credit: false,
      credit_cleared: false,
      amount_paid_ugx: 8000,
      cleared_at: null,
      items: [
        {
          product_id: 'scout',
          product_name: 'Scout Pack',
          detail: 'Mint',
          line_total: 8000,
          breakdown: { mint: 1 },
        },
      ],
      client_phone: null,
      delivery_enabled: false,
      delivery: null,
      location_label: null,
      location_lat: null,
      location_lng: null,
      delivery_fee_ugx: null,
      delivery_distance_km: null,
      delivery_duration_min: null,
      store_order_id: null,
    },
    {
      id: 'seed-delivery-sale',
      created_at: daysAgo(9),
      client_id: clientA.id,
      total_ugx: 8000,
      is_credit: false,
      credit_cleared: false,
      amount_paid_ugx: 8000,
      cleared_at: null,
      items: [
        {
          product_id: 'scout',
          product_name: 'Scout Pack',
          detail: 'Mint',
          line_total: 8000,
          breakdown: { mint: 1 },
        },
      ],
      client_phone: '0700333444',
      delivery_enabled: true,
      delivery: null,
      location_label: 'Kololo',
      location_lat: 0.3328,
      location_lng: 32.5978,
      delivery_fee_ugx: 8000,
      delivery_distance_km: 3.1,
      delivery_duration_min: 14,
      store_order_id: null,
    },
  ];

  // Cookie volume after partner track start for settlement tests
  for (let i = 0; i < 30; i++) {
    sales.push({
      id: nextId(),
      created_at: daysAgo(20 - (i % 15)),
      client_id: clientA.id,
      total_ugx: 5000,
      is_credit: false,
      credit_cleared: false,
      amount_paid_ugx: 5000,
      cleared_at: null,
      items: [
        {
          product_id: 'cookie_single',
          product_name: 'Butterscotch Cookie',
          detail: '1 × Butterscotch',
          line_total: 5000,
          breakdown: { cookie_butterscotch: 1 },
        },
      ],
      client_phone: null,
      delivery_enabled: false,
      delivery: null,
      location_label: null,
      location_lat: null,
      location_lng: null,
      delivery_fee_ugx: null,
      delivery_distance_km: null,
      delivery_duration_min: null,
      store_order_id: null,
    });
  }

  const credit_payments: Array<Record<string, unknown>> = [];

  const deliveries = [
    {
      id: 'seed-trip-1',
      created_at: daysAgo(9),
      client_id: clientA.id,
      client_name: 'Test Client A',
      sale_id: 'seed-delivery-sale',
      origin_lat: 0.3476,
      origin_lng: 32.5825,
      origin_label: 'Prisca Honey',
      dest_lat: 0.3328,
      dest_lng: 32.5978,
      dest_label: 'Kololo',
      distance_km: 3.1,
      duration_min: 14,
      fee_ugx: 8000,
      predicted_fee_ugx: 8000,
      fee_was_edited: false,
    },
    {
      id: nextId(),
      created_at: daysAgo(1),
      client_id: clientA.id,
      client_name: 'Test Client A',
      sale_id: sales[0]!.id,
      origin_lat: 0.3476,
      origin_lng: 32.5825,
      origin_label: 'Prisca Honey',
      dest_lat: 0.32,
      dest_lng: 32.58,
      dest_label: 'Test Dest A',
      distance_km: 4.2,
      duration_min: 18,
      fee_ugx: 8000,
      predicted_fee_ugx: 7500,
      fee_was_edited: true,
    },
    {
      id: nextId(),
      created_at: daysAgo(3),
      client_id: null,
      client_name: 'SafeBoda test',
      sale_id: null,
      origin_lat: 0.3476,
      origin_lng: 32.5825,
      origin_label: 'Prisca Honey',
      dest_lat: 0.3,
      dest_lng: 32.6,
      dest_label: 'Test route',
      distance_km: 6.1,
      duration_min: 22,
      fee_ugx: 9000,
      predicted_fee_ugx: 9000,
      fee_was_edited: false,
    },
  ];

  const store_orders = [
    {
      id: 'so-pending-1',
      status: 'pending',
      customer_name: 'Test Buyer One',
      account_id: 'acc-1',
      phone: '0700123456',
      item_count: 2,
      subtotal_ugx: 15000,
      created_at: daysAgo(0),
      confirmed_at: null,
      dismissed_at: null,
      sale_id: null,
      items: [
        {
          product_id: 'cookie-duet',
          name: 'Cookie Duet',
          quantity: 1,
          unit_price_ugx: 15000,
          flavors: ['mint', 'chocolate'],
        },
      ],
      delivery_enabled: false,
      location_label: null,
      location_lat: null,
      location_lng: null,
      delivery_fee_ugx: null,
    },
    {
      id: 'so-confirmed-1',
      status: 'confirmed',
      customer_name: 'Test Buyer Two',
      account_id: 'acc-2',
      phone: '0700654321',
      item_count: 1,
      subtotal_ugx: 8000,
      created_at: daysAgo(0),
      confirmed_at: FIXED_NOW,
      dismissed_at: null,
      sale_id: null,
      items: [
        {
          product_id: 'scout-pack',
          name: 'Scout Pack',
          quantity: 1,
          unit_price_ugx: 8000,
          flavors: ['strawberry'],
        },
      ],
      delivery_enabled: true,
      location_label: 'Kololo Test',
      location_lat: 0.33,
      location_lng: 32.59,
      delivery_fee_ugx: 7000,
    },
    {
      id: 'so-accepted-1',
      status: 'accepted',
      customer_name: 'Test Buyer Three',
      account_id: 'acc-3',
      phone: null,
      item_count: 1,
      subtotal_ugx: 5000,
      created_at: daysAgo(0),
      confirmed_at: FIXED_NOW,
      dismissed_at: null,
      sale_id: null,
      items: [
        {
          product_id: 'plain-single',
          name: 'Plain',
          quantity: 1,
          unit_price_ugx: 5000,
          flavors: ['classic'],
        },
      ],
      delivery_enabled: false,
      location_label: null,
      location_lat: null,
      location_lng: null,
      delivery_fee_ugx: null,
    },
    {
      id: 'so-cancelled-1',
      status: 'cancelled',
      customer_name: 'Test Buyer Cancelled',
      account_id: 'acc-4',
      phone: null,
      item_count: 1,
      subtotal_ugx: 8000,
      created_at: daysAgo(0),
      confirmed_at: null,
      dismissed_at: null,
      sale_id: null,
      items: [],
      delivery_enabled: false,
      location_label: null,
      location_lat: null,
      location_lng: null,
      delivery_fee_ugx: null,
    },
    {
      id: 'seed-pending-order',
      status: 'pending',
      customer_name: 'Store Customer',
      phone_e164: '+256700000099',
      created_at: daysAgo(0),
      confirmed_at: null,
      dismissed_at: null,
      sale_id: null,
      items: [
        {
          product_id: 'scout',
          product_name: 'Scout Pack',
          detail: 'Mint',
          line_total: 8000,
          breakdown: { mint: 1 },
        },
      ],
      delivery_enabled: false,
      location_label: null,
      location_lat: null,
      location_lng: null,
      delivery_fee_ugx: null,
    },
    {
      id: 'seed-order-with-reward',
      status: 'pending',
      customer_name: 'Store Customer',
      phone_e164: '+256700000098',
      created_at: daysAgo(0),
      confirmed_at: null,
      dismissed_at: null,
      sale_id: null,
      items: [
        {
          product_id: 'scout',
          product_name: 'Scout Pack',
          detail: 'Mint',
          line_total: 8000,
          breakdown: { mint: 1 },
        },
        {
          product_id: 'plain_single',
          product_name: 'Plain',
          detail: 'Reward',
          line_total: 5000,
          is_reward: true,
          reward_key: 'plain',
          points_cost: 1,
          breakdown: { classic: 1 },
        },
      ],
      delivery_enabled: false,
      location_label: null,
      location_lat: null,
      location_lng: null,
      delivery_fee_ugx: null,
    },
    {
      id: 'seed-order-a',
      status: 'pending',
      customer_name: 'Store Customer A',
      phone_e164: '+256700000097',
      created_at: daysAgo(0),
      confirmed_at: null,
      dismissed_at: null,
      sale_id: null,
      items: [
        {
          product_id: 'scout',
          product_name: 'Scout Pack',
          detail: 'Mint',
          line_total: 8000,
          breakdown: { mint: 1 },
        },
      ],
      delivery_enabled: false,
      location_label: null,
      location_lat: null,
      location_lng: null,
      delivery_fee_ugx: null,
    },
    {
      id: 'seed-order-b',
      status: 'pending',
      customer_name: 'Store Customer B',
      phone_e164: '+256700000096',
      created_at: daysAgo(0),
      confirmed_at: null,
      dismissed_at: null,
      sale_id: null,
      items: [
        {
          product_id: 'pilot',
          product_name: 'Pilot Pack',
          detail: 'Mint, Strawberry',
          line_total: 15000,
          breakdown: { mint: 1, strawberry: 1 },
        },
      ],
      delivery_enabled: false,
      location_label: null,
      location_lat: null,
      location_lng: null,
      delivery_fee_ugx: null,
    },
    {
      id: 'seed-cancelled-order',
      status: 'cancelled',
      customer_name: 'Cancelled Customer',
      phone_e164: null,
      created_at: daysAgo(1),
      confirmed_at: null,
      dismissed_at: null,
      sale_id: null,
      items: [],
      delivery_enabled: false,
      location_label: null,
      location_lat: null,
      location_lng: null,
      delivery_fee_ugx: null,
    },
  ];

  const store_reviews = [
    {
      id: nextId(),
      created_at: daysAgo(1),
      rating: 5,
      body: 'Great cookies',
      customer_name: 'Reviewer A',
    },
    {
      id: nextId(),
      created_at: daysAgo(4),
      rating: 3,
      body: 'Okay',
      customer_name: 'Reviewer B',
    },
  ];

  const store_fulfillment = [
    {
      id: 'default',
      open_time: '07:00',
      close_time: '22:00',
      busy_until: null,
      busy_for: null,
      suggest_start: null,
      suggest_end: null,
      updated_at: FIXED_NOW,
    },
  ];

  const store_accounts = [
    {
      id: 'acc-1',
      phone: '0700111111',
      pos_display_name: 'Buyer One',
      verified: true,
    },
    {
      id: 'acc-2',
      phone: '0700222222',
      pos_display_name: null,
      verified: false,
    },
  ];

  const staff_settlements = [
    { id: 'seed-payout-1', staff_id: 'seed-helper', amount_ugx: 3000, paid_at: daysAgo(6), note: 'First payout' },
    { id: 'seed-payout-2', staff_id: 'seed-helper', amount_ugx: 2000, paid_at: daysAgo(2), note: null },
  ];

  return {
    inventory,
    clients,
    sales,
    credit_payments,
    deliveries,
    store_orders,
    store_reviews,
    store_fulfillment,
    store_accounts,
    staff_settlements,
  };
}

export function buildEmptySeed() {
  resetIds();
  return {
    inventory: CATEGORIES.map((c) => ({
      category_id: c.id,
      stock: 0,
      display_name: c.name,
      category_sub: c.sub,
      color: c.color,
      updated_at: FIXED_NOW,
    })),
    clients: [] as Array<Record<string, unknown>>,
    sales: [] as Array<Record<string, unknown>>,
    credit_payments: [] as Array<Record<string, unknown>>,
    deliveries: [] as Array<Record<string, unknown>>,
    store_orders: [] as Array<Record<string, unknown>>,
    store_reviews: [] as Array<Record<string, unknown>>,
    store_fulfillment: [
      {
        id: 'default',
        open_time: '07:00',
        close_time: '22:00',
        busy_until: null,
        busy_for: null,
        suggest_start: null,
        suggest_end: null,
        updated_at: FIXED_NOW,
      },
    ],
    store_accounts: [] as Array<Record<string, unknown>>,
    staff_settlements: [] as Array<Record<string, unknown>>,
  };
}
