import type { RecordedWrite } from '../../mock';

const ID_RE =
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi;
const ISO_RE = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})/g;

export type NormalizedWrite = {
  method: string;
  path: string;
  prefer?: string;
  contentType?: string;
  body: unknown;
};

function sortQuery(url: string): string {
  try {
    const u = new URL(url);
    const entries = [...u.searchParams.entries()].sort(([a], [b]) => a.localeCompare(b));
    u.search = '';
    for (const [k, v] of entries) u.searchParams.append(k, v);
    return `${u.pathname}${u.search}`;
  } catch {
    return url;
  }
}

function rewriteIds(value: unknown, ids: Map<string, string>): unknown {
  if (typeof value === 'string') {
    return value.replace(ID_RE, (id) => {
      const key = id.toLowerCase();
      if (!ids.has(key)) ids.set(key, `<id:${ids.size}>`);
      return ids.get(key)!;
    }).replace(ISO_RE, '<ts>');
  }
  if (Array.isArray(value)) return value.map((v) => rewriteIds(v, ids));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = rewriteIds(v, ids);
    }
    return out;
  }
  return value;
}

function isBootstrap(row: NormalizedWrite): boolean {
  const body = row.body as { op?: string; action?: string } | null;
  if (row.path.includes('/api/inventory/write') && body?.op === 'ensure') return true;
  if (
    row.path.includes('/functions/v1/store-auth') &&
    (body?.action === 'admin_list_pos_labels' || body?.action === 'admin_list_users')
  ) {
    return true;
  }
  return false;
}

export function normalizeWrites(writes: RecordedWrite[]): NormalizedWrite[] {
  const ids = new Map<string, string>();
  const out: NormalizedWrite[] = [];
  for (const w of writes) {
    const headers = w.headers || {};
    const prefer = headers.Prefer || headers.prefer;
    const contentType = headers['Content-Type'] || headers['content-type'];
    const row: NormalizedWrite = {
      method: w.method.toUpperCase(),
      path: rewriteIds(sortQuery(w.url), ids) as string,
      body: rewriteIds(w.body, ids),
    };
    if (prefer) row.prefer = prefer;
    if (contentType) row.contentType = contentType;
    // Boot reads overlap (QUIRKS 10). The scenario contract is the other writes.
    if (isBootstrap(row)) continue;
    out.push(row);
  }
  return out;
}

export function assertCausalOrder(writes: NormalizedWrite[]) {
  const saleIdx = writes.findIndex((w) => w.method === 'POST' && w.path.includes('/sales'));
  const invIdx = writes.findIndex(
    (w) => w.path.includes('/api/inventory/write') && (w.body as { op?: string })?.op === 'delta',
  );
  if (saleIdx >= 0 && invIdx >= 0 && invIdx < saleIdx) {
    throw new Error('inventory delta before sales POST');
  }
}
