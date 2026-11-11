import { useEffect, useState } from 'preact/hooks';
import { sbFetch } from '../../data/api';
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

  useEffect(() => {
    void (async () => {
      try {
        const res = await sbFetch('store_reviews?select=*&order=created_at.desc&limit=100');
        if (!res.ok) throw new Error(`reviews ${res.status}`);
        setRows((await res.json()) as Review[]);
      } catch (e) {
        showToast(e instanceof Error ? e.message : 'Could not load reviews');
      }
    })();
  }, []);

  return (
    <section>
      <h1 class="page-title">Reviews</h1>
      {rows.map((r) => (
        <div class="v-list-row" key={r.id}>
          <div style={{ flex: 1 }}>
            <div class="v-list-row__title">
              {r.customer_name || 'Customer'} · {r.rating ?? '—'}★
            </div>
            <div class="v-list-row__meta">{r.comment || 'No comment'}</div>
          </div>
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
