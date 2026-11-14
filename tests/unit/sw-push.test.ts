/** Runs the shipped /next/sw.js with a fake worker scope: what a push shows, and where a tap lands. */
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { nextNotificationPath } from '../../src/domain/push-target';

type Handler = (event: Record<string, unknown>) => void;

function boot(openClients: Array<{ url: string; focus: () => Promise<void>; navigate?: (u: string) => Promise<void> }> = []) {
  const handlers: Record<string, Handler> = {};
  const shown: Array<{ title: string; options: Record<string, unknown> }> = [];
  const opened: string[] = [];
  const self = {
    location: new URL('https://posvenus.netlify.app/next/sw.js'),
    addEventListener: (type: string, fn: Handler) => {
      handlers[type] = fn;
    },
    registration: {
      showNotification: async (title: string, options: Record<string, unknown>) => {
        shown.push({ title, options });
      },
    },
    clients: {
      matchAll: async () => openClients,
      openWindow: async (u: string) => {
        opened.push(u);
      },
    },
  };
  vm.runInNewContext(readFileSync('public/sw.js', 'utf8'), { self, URL, decodeURIComponent, encodeURIComponent, Date, Array });
  return { handlers, shown, opened };
}

async function push(sw: ReturnType<typeof boot>, data: unknown) {
  const waits: Promise<unknown>[] = [];
  sw.handlers.push!({
    data: { json: () => data, text: () => '' },
    waitUntil: (p: Promise<unknown>) => waits.push(p),
  });
  await Promise.all(waits);
}

describe('/next service worker push handling', () => {
  it('shows a store order the way the server sends it, and keeps it on screen until tapped', async () => {
    const sw = boot();
    await push(sw, {
      type: 'storefront-order',
      title: 'Order placed',
      body: 'Muza · 2 items',
      url: '/#load-store-order=ord_1',
      orderId: 'ord_1',
      tag: 'storefront-order-ord_1',
      requireInteraction: true,
      vibrate: [220, 80, 220],
    });
    expect(sw.shown).toHaveLength(1);
    expect(sw.shown[0]!.title).toBe('Order placed');
    expect(sw.shown[0]!.options).toMatchObject({
      body: 'Muza · 2 items',
      tag: 'storefront-order-ord_1',
      renotify: true,
      requireInteraction: true,
      vibrate: [220, 80, 220],
      icon: '/next/notif/venus-notif-icon-r2-192.png',
      badge: '/next/notif/venus-notif-badge-r2-96.png',
      data: { url: '/next/orders#order=ord_1' },
    });
  });

  it('shows the test push without pinning it, and a bare payload still shows something', async () => {
    const sw = boot();
    await push(sw, { type: 'test', title: 'Venus test', body: 'ok', requireInteraction: false });
    expect(sw.shown[0]!.options).toMatchObject({ requireInteraction: false, data: { url: '/next/settings' } });
    await push(sw, undefined);
    expect(sw.shown[1]!.title).toBe('New order');
  });

  it('uses the ink brand icon and a monochrome badge, never the old green /assets art', async () => {
    const sw = boot();
    await push(sw, { title: 't' });
    const { icon, badge } = sw.shown[0]!.options as { icon: string; badge: string };
    expect(icon).not.toMatch(/assets\/logo/);
    expect(badge).not.toMatch(/assets\/logo/);
    for (const [url, size, mono] of [[icon, 192, false], [badge, 96, true]] as const) {
      const file = readFileSync(`public/${url.replace('/next/', '')}`);
      expect(file.readUInt32BE(16)).toBe(size);
      expect(file.readUInt32BE(20)).toBe(size);
      expect(file[25]).toBe(6); // RGBA, so it has transparency
      void mono;
    }
  });

  it('uses the same landing page as src/domain/push-target', async () => {
    const cases = [
      { type: 'storefront-order', url: '/#load-store-order=a%20b' },
      { type: 'store-review', url: '/#reviews' },
      { type: 'store-signup', url: '/' },
      { type: 'test', url: '/next/settings' },
      { type: 'storefront-order', orderId: 'plain' },
    ];
    for (const c of cases) {
      const sw = boot();
      await push(sw, { title: 't', ...c });
      expect((sw.shown[0]!.options.data as { url: string }).url).toBe(nextNotificationPath(c));
    }
  });

  it('opens the order on tap, reusing an open /next window when there is one', async () => {
    const closed: boolean[] = [];
    const cold = boot();
    const waits: Promise<unknown>[] = [];
    cold.handlers.notificationclick!({
      notification: { data: { url: '/next/orders#order=ord_1' }, close: () => closed.push(true) },
      waitUntil: (p: Promise<unknown>) => waits.push(p),
    });
    await Promise.all(waits);
    expect(closed).toEqual([true]);
    expect(cold.opened).toEqual(['https://posvenus.netlify.app/next/orders#order=ord_1']);

    const nav: string[] = [];
    let focused = 0;
    const warm = boot([
      { url: 'https://posvenus.netlify.app/next/sell', focus: async () => void (focused += 1), navigate: async (u) => void nav.push(u) },
    ]);
    const w2: Promise<unknown>[] = [];
    warm.handlers.notificationclick!({
      notification: { data: { url: '/next/orders#order=ord_2' }, close: () => {} },
      waitUntil: (p: Promise<unknown>) => w2.push(p),
    });
    await Promise.all(w2);
    expect(focused).toBe(1);
    expect(nav).toEqual(['https://posvenus.netlify.app/next/orders#order=ord_2']);
    expect(warm.opened).toEqual([]);
  });
});
