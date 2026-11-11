import { useEffect } from 'preact/hooks';
import { loadSales, sales } from '../../data/entities';
import { Money } from '../../ui/Money';
import { Tag } from '../../ui/Tag';
import { showToast } from '../../ui/ToastHost';

export function HistoryPage() {
  useEffect(() => {
    void loadSales().catch((e) =>
      showToast(e instanceof Error ? e.message : 'Could not load history'),
    );
  }, []);

  return (
    <section>
      <h1 class="page-title">History</h1>
      {sales.value.map((s) => (
        <div class="v-list-row" key={s.id}>
          <div class="v-list-row__main">
            <div class="v-list-row__title">
              {new Date(s.created_at || '').toLocaleString('en-GB', {
                day: '2-digit',
                month: 'short',
                hour: '2-digit',
                minute: '2-digit',
              })}
            </div>
            <div class="v-list-row__meta">{s.store_order_id ? 'Store order' : 'Counter'}</div>
          </div>
          <Tag tone={s.is_credit && !s.credit_cleared ? 'credit' : 'paid'}>
            {s.is_credit && !s.credit_cleared ? 'Credit' : 'Paid'}
          </Tag>
          <Money value={Number(s.total_ugx) || 0} />
        </div>
      ))}
    </section>
  );
}
