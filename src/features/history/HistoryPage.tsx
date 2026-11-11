import { useEffect, useState } from 'preact/hooks';
import { loadSales, sales } from '../../data/entities';
import { groupSalesByDay, partitionThisWeek } from '../../domain/history-groups';
import { Money } from '../../ui/Money';
import { Tag } from '../../ui/Tag';
import { Segmented } from '../../ui/Segmented';
import { showToast } from '../../ui/ToastHost';

type Filter = 'all' | 'week' | 'credit';

export function HistoryPage() {
  const [filter, setFilter] = useState<Filter>('all');

  useEffect(() => {
    void loadSales().catch((e) =>
      showToast(e instanceof Error ? e.message : 'Could not load history'),
    );
  }, []);

  const base =
    filter === 'credit'
      ? sales.value.filter((s) => s.is_credit && !s.credit_cleared)
      : filter === 'week'
        ? partitionThisWeek(sales.value).thisWeek.flatMap((g) => g.sales)
        : sales.value;

  const groups = groupSalesByDay(base);

  return (
    <section>
      <h1 class="page-title">History</h1>
      <div style={{ marginBottom: 16 }}>
        <Segmented
          value={filter}
          onChange={setFilter}
          options={[
            { id: 'all', label: 'All' },
            { id: 'week', label: 'This week' },
            { id: 'credit', label: 'Credit' },
          ]}
        />
      </div>
      {!groups.length ? (
        <div class="v-empty">
          <p class="v-empty__title">No sales yet</p>
        </div>
      ) : null}
      {groups.map((g) => (
        <div key={g.key}>
          <div class="v-section-label">
            {g.dateObj.toLocaleDateString('en-GB', {
              weekday: 'short',
              day: '2-digit',
              month: 'short',
            })}{' '}
            · {g.count} · <Money value={g.total} />
          </div>
          {g.sales.map((s) => {
            const full = sales.value.find((row) => row.id === s.id) || s;
            const credit = Boolean(
              (full as { is_credit?: boolean }).is_credit &&
                !(full as { credit_cleared?: boolean }).credit_cleared,
            );
            return (
              <div class="v-list-row" key={s.id}>
                <div class="v-list-row__main">
                  <div class="v-list-row__title">
                    {new Date(s.created_at || '').toLocaleString('en-GB', {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </div>
                  <div class="v-list-row__meta">
                    {(full as { store_order_id?: string }).store_order_id
                      ? 'Store order'
                      : 'Counter'}
                  </div>
                </div>
                <Tag tone={credit ? 'credit' : 'paid'}>{credit ? 'Credit' : 'Paid'}</Tag>
                <Money value={Number(s.total_ugx) || 0} />
              </div>
            );
          })}
        </div>
      ))}
    </section>
  );
}
