/**
 * Minimal in-memory PostgREST for POS E2E.
 * Supports the query shapes listed in QUERIES.md.
 */

export type Row = Record<string, unknown>;
export type TableMap = Record<string, Row[]>;

type Filter = { col: string; op: string; value: string };

function parseFilters(searchParams: URLSearchParams): Filter[] {
  const filters: Filter[] = [];
  for (const [key, raw] of searchParams.entries()) {
    if (['select', 'order', 'limit', 'offset', 'and', 'or'].includes(key)) continue;
    const m = String(raw).match(/^(eq|neq|gte|lte|gt|lt|is|in)\.(.+)$/);
    if (!m) continue;
    filters.push({ col: key, op: m[1]!, value: m[2]! });
  }
  return filters;
}

function matchFilter(row: Row, f: Filter): boolean {
  const cell = row[f.col];
  if (f.op === 'is') {
    if (f.value === 'null') return cell == null;
    if (f.value === 'true') return cell === true;
    if (f.value === 'false') return cell === false;
    return false;
  }
  if (f.op === 'in') {
    const inner = f.value.replace(/^\(/, '').replace(/\)$/, '');
    const parts = inner.split(',').map((s) => s.replace(/^"|"$/g, '').trim());
    return parts.includes(String(cell));
  }
  const left = cell == null ? '' : String(cell);
  const right = f.value;
  switch (f.op) {
    case 'eq':
      return left === right;
    case 'neq':
      return left !== right;
    case 'gte':
      return left >= right;
    case 'lte':
      return left <= right;
    case 'gt':
      return left > right;
    case 'lt':
      return left < right;
    default:
      return false;
  }
}

function applyOrder(rows: Row[], order: string | null): Row[] {
  if (!order) return rows;
  const specs = order.split(',').map((part) => {
    const [col, dir] = part.split('.');
    return { col: col!, desc: dir === 'desc' };
  });
  return [...rows].sort((a, b) => {
    for (const s of specs) {
      const av = a[s.col];
      const bv = b[s.col];
      const as = av == null ? '' : String(av);
      const bs = bv == null ? '' : String(bv);
      if (as === bs) continue;
      const cmp = as < bs ? -1 : 1;
      return s.desc ? -cmp : cmp;
    }
    return 0;
  });
}

function project(row: Row, select: string | null): Row {
  if (!select || select === '*') return { ...row };
  const cols = select.split(',').map((c) => c.trim());
  const out: Row = {};
  for (const col of cols) {
    // Skip embeds for now; return base cols only.
    if (col.includes('(')) continue;
    if (col in row) out[col] = row[col];
  }
  return out;
}

let idSeq = 1000;
export function resetRowIds() {
  idSeq = 1000;
}
function genId(): string {
  idSeq += 1;
  return `00000000-0000-4000-8000-${String(idSeq).padStart(12, '0')}`;
}

export class MemoryDb {
  tables: TableMap;
  now: string;

  constructor(seed: TableMap, now: string) {
    this.tables = structuredClone(seed);
    this.now = now;
  }

  table(name: string): Row[] {
    if (!this.tables[name]) this.tables[name] = [];
    return this.tables[name]!;
  }

  handle(method: string, pathAndQuery: string, body: unknown, prefer?: string | null): {
    status: number;
    body: unknown;
  } {
    const url = new URL(pathAndQuery, 'http://mock.local/');
    const table = url.pathname.replace(/^\//, '').split('/')[0] || '';
    const params = url.searchParams;
    const filters = parseFilters(params);
    const select = params.get('select');
    const order = params.get('order');
    const limit = params.get('limit') ? Number(params.get('limit')) : null;
    const rows = this.table(table);
    const matched = rows.filter((r) => filters.every((f) => matchFilter(r, f)));

    if (method === 'GET') {
      let out = applyOrder(matched, order).map((r) => project(r, select));
      if (limit != null) out = out.slice(0, limit);
      return { status: 200, body: out };
    }

    if (method === 'POST') {
      const items = Array.isArray(body) ? body : [body];
      const inserted: Row[] = [];
      for (const item of items) {
        const row: Row = { ...(item as Row) };
        if (row.id == null) row.id = genId();
        if (row.created_at == null) row.created_at = this.now;
        if (row.updated_at == null) row.updated_at = this.now;
        rows.push(row);
        inserted.push(row);
      }
      if (prefer?.includes('return=minimal')) return { status: 201, body: null };
      return { status: 201, body: Array.isArray(body) ? inserted : inserted[0] };
    }

    if (method === 'PATCH') {
      const patch = (body || {}) as Row;
      const updated: Row[] = [];
      for (const row of matched) {
        Object.assign(row, patch, { updated_at: this.now });
        updated.push(row);
      }
      if (prefer?.includes('return=minimal')) return { status: 204, body: null };
      return { status: 200, body: updated };
    }

    if (method === 'DELETE') {
      const keep: Row[] = [];
      const removed: Row[] = [];
      for (const row of rows) {
        if (filters.every((f) => matchFilter(row, f))) removed.push(row);
        else keep.push(row);
      }
      this.tables[table] = keep;
      if (prefer?.includes('return=representation')) {
        return { status: 200, body: removed };
      }
      return { status: 204, body: null };
    }

    return { status: 405, body: { error: `method ${method} not allowed` } };
  }
}
