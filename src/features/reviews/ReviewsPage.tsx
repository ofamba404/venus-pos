import { useEffect, useState } from 'preact/hooks';
import { sbFetch } from '../../data/api';
import { Button } from '../../ui/Button';
import { showToast } from '../../ui/ToastHost';

type Review = {
  id: string;
  rating?: number;
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
    void refresh().catch((e) => showToast(e instanceof Error ? e.message : 'Could not load reviews'));
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
            <div class="v-list-row__meta">{r.comment || 'No comment'}</div>
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
