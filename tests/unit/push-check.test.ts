import { afterEach, describe, expect, it, vi } from 'vitest';
import { runNotificationCheck, type CheckLine } from '../../src/data/push-check';
import { VAPID_PUBLIC_KEY } from '../../src/data/env';
import { authSession } from '../../src/data/auth';

function keyBuffer(key: string) {
  const padded = key + '='.repeat((4 - (key.length % 4)) % 4);
  return Uint8Array.from(Buffer.from(padded.replace(/-/g, '+').replace(/_/g, '/'), 'base64')).buffer;
}

function world(opts: {
  permission?: NotificationPermission;
  reg?: 'none' | 'inactive' | 'ok';
  sub?: 'none' | 'old-key' | 'ok';
  show?: 'ok' | 'throws';
  support?: boolean;
}) {
  const showNotification = vi.fn(async () => {
    if (opts.show === 'throws') throw new Error('no icon');
  });
  const sub = {
    endpoint: 'https://push.example/1',
    options: { applicationServerKey: opts.sub === 'old-key' ? new ArrayBuffer(65) : keyBuffer(VAPID_PUBLIC_KEY) },
  };
  const reg = {
    active: opts.reg === 'inactive' ? null : {},
    scope: 'https://posvenus.netlify.app/next/',
    showNotification,
    pushManager: { getSubscription: async () => (opts.sub === 'none' ? null : sub) },
  };
  if (opts.support === false) {
    vi.stubGlobal('navigator', {});
    vi.stubGlobal('window', {});
  } else {
    vi.stubGlobal('navigator', {
      serviceWorker: { getRegistration: async () => (opts.reg === 'none' ? undefined : reg) },
    });
    vi.stubGlobal('window', { PushManager: class {} });
    vi.stubGlobal('Notification', { permission: opts.permission ?? 'granted' });
  }
  return { showNotification };
}

async function run() {
  const seen: CheckLine[] = [];
  const all = await runNotificationCheck((l) => seen.push(l));
  expect(seen).toEqual(all);
  return all;
}

afterEach(() => {
  vi.unstubAllGlobals();
  authSession.value = null;
});

describe('notification check', () => {
  it('stops at the first broken step and says which', async () => {
    world({ support: false });
    expect((await run()).at(-1)).toMatchObject({ id: 'support', ok: false });
    world({ permission: 'denied' });
    expect((await run()).at(-1)).toMatchObject({ id: 'permission', ok: false });
    expect((await run()).at(-1)!.detail).toContain('Blocked');
    world({ permission: 'default' });
    expect((await run()).at(-1)!.detail).toContain('Not asked');
    world({ reg: 'none' });
    expect((await run()).at(-1)).toMatchObject({ id: 'worker', ok: false });
    world({ reg: 'inactive' });
    expect((await run()).at(-1)).toMatchObject({ id: 'worker', ok: false });
    world({ sub: 'none' });
    expect((await run()).at(-1)).toMatchObject({ id: 'subscription', ok: false });
    world({ sub: 'old-key' });
    expect((await run()).at(-1)!.detail).toContain('old key');
  });

  it('reports a phone that refuses to show the local notification', async () => {
    world({ show: 'throws' });
    expect((await run()).at(-1)).toMatchObject({ id: 'local', ok: false, detail: 'no icon' });
  });

  it('shows a local notification, then asks the server for one real push', async () => {
    const w = world({});
    authSession.value = null;
    expect((await run()).at(-1)).toMatchObject({ id: 'server', ok: false, detail: 'Signed out. Sign in again.' });
    expect(w.showNotification).toHaveBeenCalledOnce();

    authSession.value = { access_token: 'staff-token' };
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true, pushService: 'fcm.googleapis.com' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const ok = await run();
    expect(ok.every((l) => l.ok)).toBe(true);
    expect(ok.at(-1)!.detail).toContain('fcm.googleapis.com');
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/push/test');
    expect(JSON.parse(String(init.body))).toEqual({ endpoint: 'https://push.example/1' });

    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'The phone dropped this subscription.' }), { status: 502 })));
    expect((await run()).at(-1)).toMatchObject({ ok: false, detail: 'The phone dropped this subscription.' });
    vi.stubGlobal('fetch', vi.fn(async () => new Response('x', { status: 500 })));
    expect((await run()).at(-1)!.detail).toBe('Server answered 500');
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    expect((await run()).at(-1)!.detail).toBe('Could not reach the server');
  });
});
