import { useEffect, useState } from 'preact/hooks';
import { sbFetch } from '../../data/api';
import { Button } from '../../ui/Button';
import { showToast } from '../../ui/ToastHost';

type Review = {
  id: string;
  rating?: number;
  body?: string;
  comment?: string;
  created_at?: string;
  customer_name?: string;
};

export function ReviewsPage() {
  const [rows, setRows] = useState<Review[]>([]);

  async function refresh() {
    const res = await sbFetch('store_reviews?select=*&order=created_at.desc&limit=100');
    if (!res.ok) throw new Error(`reviews ${res.status}`);
    setRows((await res.json()) as Review[]);
  }

  useEffect(() => {
    let primed = false;
    const seen = new Set<string>();
    let timer = 0;
    const tick = async () => {
      const res = await sbFetch('store_reviews?select=*&order=created_at.desc&limit=100');
      if (!res.ok) throw new Error(`reviews ${res.status}`);
      const next = (await res.json()) as Review[];
      setRows(next);
      if (!primed) {
        primed = true;
        for (const row of next) seen.add(row.id);
        return;
      }
      const fresh = next.filter((row) => row.id && !seen.has(row.id));
      for (const row of next) seen.add(row.id);
      if (fresh.length === 1) showToast('New review');
      else if (fresh.length > 1) showToast(`${fresh.length} new reviews`);
    };
    void tick().catch((e) => showToast(e instanceof Error ? e.message : 'Could not load reviews'));
    timer = window.setInterval(() => {
      void tick().catch(() => {});
    }, 4000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <section>
      <h1 class="page-title">Reviews</h1>
      <p class="v-muted" style={{ marginTop: -8 }} data-testid="review-count">
        {rows.length} review{rows.length === 1 ? '' : 's'}
      </p>
      <Button
        size="md"
        variant="secondary"
        data-testid="reviews-refresh"
        onClick={() =>
          void refresh()
            .then(() => showToast('Reviews refreshed'))
            .catch((e) => showToast(e instanceof Error ? e.message : 'Could not load reviews'))
        }
      >
        Refresh
      </Button>
      {rows.map((r) => (
        <div class="v-list-row" key={r.id}>
          <div class="v-list-row__main">
            <div class="v-list-row__title">
              {r.customer_name || 'Customer'} · {r.rating ?? '—'}★
            </div>
            <div class="v-list-row__meta">{r.body || r.comment || 'No comment'}</div>
          </div>
          <span class="v-muted">
            {r.created_at
              ? new Date(r.created_at).toLocaleDateString('en-GB', {
                  day: '2-digit',
                  month: 'short',
                })
              : ''}
          </span>
        </div>
      ))}
      {!rows.length ? (
        <div class="v-empty">
          <p class="v-empty__title">No reviews yet</p>
        </div>
      ) : null}
    </section>
  );
}
