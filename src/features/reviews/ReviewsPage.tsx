import { useEffect, useState } from 'preact/hooks';
import { sbFetch } from '../../data/api';
import { SUPABASE_KEY, SUPABASE_URL } from '../../data/env';
import { connectSupabaseRealtime, startFeed } from '../../data/realtime';
import { Button } from '../../ui/Button';
import { showToast } from '../../ui/ToastHost';

type Review = {
  id: string;
  rating?: number;
  body?: string;
  comment?: string;
  created_at?: string;
  customer_name?: string;
  display_name?: string | null;
  status?: string | null;
};

function stars(rating: number) {
  const n = Math.max(0, Math.min(5, Math.round(rating || 0)));
  return `${'★'.repeat(n)}${'☆'.repeat(5 - n)}`;
}

export function ReviewsPage() {
  const [rows, setRows] = useState<Review[]>([]);
  const [tab, setTab] = useState<'all' | 'pending' | 'approved' | 'hidden'>('all');
  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');

  async function refresh() {
    const res = await sbFetch('store_reviews?select=*&order=created_at.desc&limit=100');
    if (!res.ok) throw new Error(`reviews ${res.status}`);
    setRows((await res.json()) as Review[]);
  }

  useEffect(() => {
    let primed = false;
    const seen = new Set<string>();
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
    return startFeed({
      connect: () =>
        connectSupabaseRealtime(
          `${SUPABASE_URL.replace(/^https:/, 'wss:')}/realtime/v1/websocket?apikey=${SUPABASE_KEY}`,
        ),
      refetch: () => {
        void tick().catch((e) => {
          if (!primed) showToast(e instanceof Error ? e.message : 'Could not load reviews');
        });
      },
      pollMs: 4000,
    });
  }, []);

  async function patchReview(id: string, body: Record<string, unknown>, toast: string) {
    const res = await sbFetch(`store_reviews?id=eq.${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      showToast('Could not update review');
      return;
    }
    showToast(toast);
    setEditId(null);
    await refresh().catch(() => {});
  }

  async function removeReview(id: string) {
    const res = await sbFetch(`store_reviews?id=eq.${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: { Prefer: 'return=representation' },
    });
    if (!res.ok) {
      showToast('Could not delete review');
      return;
    }
    showToast('Review deleted');
    await refresh().catch(() => {});
  }

  const visible = rows.filter((row) => {
    if (tab === 'all') return true;
    const status = row.status || 'approved';
    return status === tab;
  });

  return (
    <section>
      <h1 class="page-title">Reviews</h1>
      <p class="v-muted" style={{ marginTop: -8 }} data-testid="review-count">
        {rows.length} review{rows.length === 1 ? '' : 's'}
      </p>
      <div class="v-chip-row" style={{ marginBottom: 12 }}>
        {(['all', 'pending', 'approved', 'hidden'] as const).map((id) => (
          <Button key={id} size="md" variant={tab === id ? 'primary' : 'secondary'} onClick={() => setTab(id)}>
            {id[0]!.toUpperCase() + id.slice(1)}
          </Button>
        ))}
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
      </div>
      <div class="v-stagger">
      {visible.map((r) => {
        const name = r.display_name || r.customer_name || 'Guest';
        const status = r.status || 'approved';
        return (
          <article class="v-review" key={r.id} data-testid={`review-${r.id}`}>
            <div class="v-review__stars" aria-label={`${r.rating || 0} stars`}>{stars(r.rating || 0)}</div>
            <div class="v-list-row__title">{name}</div>
            <p style={{ margin: 0 }}>{r.body || r.comment || 'No comment'}</p>
            <div class="v-muted">{status}</div>
            {editId === r.id ? (
              <div class="v-add-row">
                <label class="v-field" style={{ flex: 1 }}>
                  <span class="v-field__label">Display name</span>
                  <input
                    class="v-field__input"
                    data-testid="review-name"
                    value={editName}
                    onInput={(e) => setEditName((e.target as HTMLInputElement).value)}
                  />
                </label>
                <Button size="md" data-testid="review-name-save" onClick={() => void patchReview(r.id, { display_name: editName.trim() }, 'Name updated')}>
                  Save
                </Button>
              </div>
            ) : (
              <div class="v-chip-row">
                <Button size="md" variant="secondary" data-testid={`review-edit-${r.id}`} onClick={() => { setEditId(r.id); setEditName(name === 'Guest' ? '' : name); }}>
                  Edit name
                </Button>
                {status !== 'approved' ? (
                  <Button size="md" data-testid={`review-approve-${r.id}`} onClick={() => void patchReview(r.id, { status: 'approved' }, 'Approved')}>
                    Approve
                  </Button>
                ) : null}
                {status !== 'hidden' ? (
                  <Button size="md" variant="secondary" data-testid={`review-hide-${r.id}`} onClick={() => void patchReview(r.id, { status: 'hidden' }, 'Hidden')}>
                    Hide
                  </Button>
                ) : null}
                <Button size="md" variant="danger" data-testid={`review-delete-${r.id}`} onClick={() => void removeReview(r.id)}>
                  Delete
                </Button>
              </div>
            )}
          </article>
        );
      })}
      </div>
      {!visible.length ? (
        <div class="v-empty">
          <p class="v-empty__title">No reviews yet</p>
        </div>
      ) : null}
    </section>
  );
}
