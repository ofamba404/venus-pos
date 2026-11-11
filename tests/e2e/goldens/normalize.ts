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

export function normalizeWrites(writes: RecordedWrite[]): NormalizedWrite[] {
  const ids = new Map<string, string>();
  return writes.map((w) => {
    const headers = w.headers || {};
    return {
      method: w.method.toUpperCase(),
      path: sortQuery(w.url),
      prefer: headers.Prefer || headers.prefer,
      contentType: headers['Content-Type'] || headers['content-type'],
      body: rewriteIds(w.body, ids),
    };
  });
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
