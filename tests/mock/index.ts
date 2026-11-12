import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page, Route } from '@playwright/test';
import { MemoryDb, type Row, type TableMap } from './postgrest';
import { FIXED_NOW, buildDefaultSeed, buildEmptySeed } from '../fixtures/seed';

const mockDir = path.dirname(fileURLToPath(import.meta.url));
const PLACES_JSON = readFileSync(path.join(mockDir, '../fixtures/places.json'), 'utf8');
const GMAPS_STUB = readFileSync(path.join(mockDir, 'gmaps-stub.js'), 'utf8');
const GMAPS_SCRIPT = `window.__VENUS_PLACE_FIXTURES = ${PLACES_JSON};\n${GMAPS_STUB}`;

export type FailureRule = {
  method: string;
  table?: string;
  pathIncludes?: string;
  status: number;
  times?: number;
};

export type RecordedWrite = {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: unknown;
};

export type MockHandle = {
  db: MemoryDb;
  writes: RecordedWrite[];
  requests: Array<{ method: string; url: string }>;
  setFailure: (rule: FailureRule) => void;
  setOffline: (offline: boolean) => void;
};

const SUPABASE = 'https://xiangrykfxlnacthjcad.supabase.co';
const STORE_PUSH = 'https://venus-store.netlify.app/api/push/notify';

function b64url(obj: unknown): string {
  return Buffer.from(JSON.stringify(obj)).toString('base64url');
}

function makeJwt(role: 'pos_admin' | 'pos_staff'): string {
  const header = b64url({ alg: 'none', typ: 'JWT' });
  const payload = b64url({
    sub: 'test-user',
    role: 'authenticated',
    app_metadata: { role },
    exp: Math.floor(Date.parse(FIXED_NOW) / 1000) + 3600,
    iat: Math.floor(Date.parse(FIXED_NOW) / 1000),
  });
  return `${header}.${payload}.sig`;
}

function seedToTables(seed: ReturnType<typeof buildDefaultSeed>): TableMap {
  return {
    inventory: seed.inventory as Row[],
    clients: seed.clients as Row[],
    sales: seed.sales as Row[],
    credit_payments: seed.credit_payments as Row[],
    deliveries: seed.deliveries as Row[],
    store_orders: seed.store_orders as Row[],
    store_reviews: seed.store_reviews as Row[],
    store_fulfillment: seed.store_fulfillment as Row[],
    store_accounts: seed.store_accounts as Row[],
  };
}

export async function installMockBackend(
  page: Page,
  opts: {
    seed?: 'default' | 'empty';
    role?: 'pos_admin' | 'pos_staff';
    failures?: FailureRule[];
  } = {},
): Promise<MockHandle> {
  const role = opts.role || 'pos_admin';
  const seedData = opts.seed === 'empty' ? buildEmptySeed() : buildDefaultSeed();
  const db = new MemoryDb(seedToTables(seedData), FIXED_NOW);
  const writes: RecordedWrite[] = [];
  const requests: Array<{ method: string; url: string }> = [];
  const failures = [...(opts.failures || [])];
  let networkOff = false;

  const handle: MockHandle = {
    db,
    writes,
    requests,
    setFailure(rule) {
      failures.push(rule);
    },
    setOffline(offline) {
      networkOff = offline;
    },
  };

  const token = makeJwt(role);

  await page.addInitScript(
    ({ storageKey, session }) => {
      localStorage.setItem(storageKey, JSON.stringify(session));
    },
    {
      storageKey: 'venus-pos-auth',
      session: {
        access_token: token,
        refresh_token: 'refresh-test',
        expires_at: Math.floor(Date.parse(FIXED_NOW) / 1000) + 3600,
        token_type: 'bearer',
        user: {
          id: 'test-user',
          email: 'staff@test.local',
          app_metadata: { role },
        },
      },
    },
  );

  const consumeFailure = (method: string, url: string): number | null => {
    const idx = failures.findIndex((f) => {
      if (f.method.toUpperCase() !== method.toUpperCase()) return false;
      if (f.table && !url.includes(`/rest/v1/${f.table}`)) return false;
      if (f.pathIncludes && !url.includes(f.pathIncludes)) return false;
      return true;
    });
    if (idx < 0) return null;
    const rule = failures[idx]!;
    const left = (rule.times ?? 1) - 1;
    if (left <= 0) failures.splice(idx, 1);
    else rule.times = left;
    return rule.status;
  };

  const fulfillJson = async (route: Route, status: number, body: unknown) => {
    await route.fulfill({
      status,
      contentType: 'application/json',
      body: body == null ? '' : JSON.stringify(body),
    });
  };

  await page.route('**/*', async (route) => {
    const req = route.request();
    const method = req.method();
    const url = req.url();
    requests.push({ method, url });

    // Allow same-origin app assets
    const u = new URL(url);
    const local = u.hostname === '127.0.0.1' || u.hostname === 'localhost';
    if (networkOff && (!local || u.pathname.startsWith('/api/'))) {
      await route.abort('internetdisconnected');
      return;
    }
    if (local && (u.port === '4173' || u.port === '5173' || u.port === '')) {
      if (!u.pathname.startsWith('/api/')) {
        await route.continue();
        return;
      }
    }

    const failStatus = consumeFailure(method, url);
    if (failStatus != null) {
      await fulfillJson(route, failStatus, { error: 'injected failure' });
      return;
    }

    // Auth
    if (url.includes('/auth/v1/token')) {
      await fulfillJson(route, 200, {
        access_token: token,
        refresh_token: 'refresh-test',
        expires_in: 3600,
        token_type: 'bearer',
        user: { id: 'test-user', email: 'staff@test.local', app_metadata: { role } },
      });
      return;
    }
    if (url.includes('/auth/v1/user')) {
      await fulfillJson(route, 200, {
        id: 'test-user',
        email: 'staff@test.local',
        app_metadata: { role },
      });
      return;
    }
    if (url.includes('/auth/v1/logout')) {
      await route.fulfill({ status: 204, body: '' });
      return;
    }

    // PostgREST
    if (url.startsWith(`${SUPABASE}/rest/v1/`)) {
      const path = url.slice(`${SUPABASE}/rest/v1/`.length);
      let body: unknown = null;
      if (method !== 'GET' && method !== 'HEAD') {
        try {
          body = req.postDataJSON();
        } catch {
          body = null;
        }
        writes.push({
          method,
          url,
          headers: {
            Prefer: req.headers()['prefer'] || '',
            'Content-Type': req.headers()['content-type'] || '',
          },
          body,
        });
      }
      const prefer = req.headers()['prefer'] || null;
      const result = db.handle(method, path, body, prefer);
      if (result.status === 204) {
        await route.fulfill({ status: 204, body: '' });
        return;
      }
      await fulfillJson(route, result.status, result.body);
      return;
    }

    // store-auth edge
    if (url.includes('/functions/v1/store-auth')) {
      let body: Record<string, unknown> = {};
      try {
        body = req.postDataJSON() as Record<string, unknown>;
      } catch {
        body = {};
      }
      writes.push({ method, url, headers: {}, body });
      const action = String(body.action || '');
      if (action === 'admin_list_users' || action === 'admin_list_pos_labels') {
        await fulfillJson(route, 200, { users: db.table('store_accounts') });
        return;
      }
      await fulfillJson(route, 200, { ok: true });
      return;
    }

    if (u.pathname === '/api/store-order/reserve') {
      let body: unknown = null;
      try {
        body = req.postDataJSON();
      } catch {
        body = null;
      }
      writes.push({ method, url, headers: {}, body });
      await fulfillJson(route, 200, { ok: true, locked: true, consumed: true, released: true });
      return;
    }

    // Netlify functions
    if (u.pathname === '/api/inventory/write') {
      let body: Record<string, unknown> = {};
      try {
        body = req.postDataJSON() as Record<string, unknown>;
      } catch {
        body = {};
      }
      writes.push({ method, url, headers: {}, body });
      if (body.op === 'ensure') {
        await fulfillJson(route, 200, { rows: db.table('inventory') });
        return;
      }
      // delta: { category_id, delta } or array
      const deltas = Array.isArray(body.deltas) ? body.deltas : [body];
      for (const d of deltas) {
        const id = String((d as Row).category_id || '');
        const delta = Number((d as Row).delta || 0);
        const row = db.table('inventory').find((r) => r.category_id === id);
        if (row) row.stock = Number(row.stock || 0) + delta;
        else if (id) {
          db.table('inventory').push({ category_id: id, stock: Math.max(0, delta) });
        }
      }
      await fulfillJson(route, 200, { ok: true, rows: db.table('inventory') });
      return;
    }

    if (u.pathname.startsWith('/api/push/') || u.pathname === '/api/cookie-partner/settle') {
      let body: unknown = null;
      try {
        body = req.postDataJSON();
      } catch {
        body = null;
      }
      writes.push({ method, url, headers: {}, body });
      await fulfillJson(route, 200, { ok: true });
      return;
    }

    if (url.startsWith(STORE_PUSH)) {
      let body: unknown = null;
      try {
        body = req.postDataJSON();
      } catch {
        body = null;
      }
      writes.push({ method, url, headers: {}, body });
      await fulfillJson(route, 200, { ok: true });
      return;
    }

    // Google Fonts → empty CSS
    if (url.includes('fonts.googleapis.com') || url.includes('fonts.gstatic.com')) {
      await route.fulfill({ status: 200, contentType: 'text/css', body: '/* mock */' });
      return;
    }

    // CDN supabase-js → abort (forces poll)
    if (url.includes('cdn.jsdelivr.net') || url.includes('unpkg.com')) {
      await route.abort();
      return;
    }

    // Maps stub — script callback plus any follow-up Maps HTTP (no live key).
    if (url.includes('maps.googleapis.com') || url.includes('maps.gstatic.com')) {
      const isScript = url.includes('/maps/api/js') || url.includes('callback=');
      if (isScript) {
        await route.fulfill({
          status: 200,
          contentType: 'application/javascript',
          body: GMAPS_SCRIPT,
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: '{}',
      });
      return;
    }

    // Realtime websocket handled separately; other unknown off-origin → fail
    if (u.origin !== 'http://127.0.0.1:4173' && u.origin !== 'http://localhost:4173') {
      throw new Error(`Mock backend: unrecognised request ${method} ${url}`);
    }

    await route.continue();
  });

  await page.routeWebSocket(/realtime\/v1\/websocket/, (ws) => {
    ws.close();
  });

  return handle;
}
