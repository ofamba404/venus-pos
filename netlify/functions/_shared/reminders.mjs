/** Shared quote-lab reminder slots (Kampala wall clock). Keep in sync with js/delivery-test-routes.js */

export const DELIVERY_TEST_REMINDERS = [
  {
    id: 'dl-test-morning',
    type: 'delivery-test',
    hour: 7,
    minute: 30,
    title: 'SafeBoda quote check · morning peak',
    body: 'Log 1–2 preset routes from Prisca Honey while SafeBoda shows morning prices.',
    path: '/pages/delivery.html#quote-lab',
  },
  {
    id: 'dl-test-day',
    type: 'delivery-test',
    hour: 12,
    minute: 0,
    title: 'SafeBoda quote check · daytime',
    body: 'Midday prices — open Delivery → Quote lab and log the next priority drop-off.',
    path: '/pages/delivery.html#quote-lab',
  },
  {
    id: 'dl-test-evening',
    type: 'delivery-test',
    hour: 17,
    minute: 30,
    title: 'SafeBoda quote check · evening peak',
    body: 'Evening peak — check SafeBoda and log a mid or long preset route.',
    path: '/pages/delivery.html#quote-lab',
  },
  {
    id: 'dl-test-night',
    type: 'delivery-test',
    hour: 21,
    minute: 0,
    title: 'SafeBoda quote check · night',
    body: 'Night band — you already have many night quotes; still log a gap if the matrix shows red.',
    path: '/pages/delivery.html#quote-lab',
  },
];

/** Kampala is UTC+3 year-round (no DST). */
export function kampalaParts(date = new Date()) {
  const utc = date.getTime() + 3 * 60 * 60 * 1000;
  const d = new Date(utc);
  return {
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes(),
    minuteOfDay: d.getUTCHours() * 60 + d.getUTCMinutes(),
    dateKey: `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`,
  };
}

export function remindersDueNow(date = new Date(), windowMin = 8) {
  const { minuteOfDay, dateKey } = kampalaParts(date);
  return DELIVERY_TEST_REMINDERS.filter((s) => {
    const target = s.hour * 60 + (s.minute || 0);
    return minuteOfDay >= target && minuteOfDay <= target + windowMin;
  }).map((s) => ({ ...s, dateKey }));
}

export function subscriptionKey(endpoint) {
  // Stable blob key from endpoint (URL-safe).
  let hash = 0;
  const str = String(endpoint || '');
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 31 + str.charCodeAt(i)) >>> 0;
  }
  return `sub-${hash.toString(16)}`;
}
