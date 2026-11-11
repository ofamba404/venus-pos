import { useEffect, useMemo } from 'preact/hooks';
import { loadSales, sales } from '../../data/entities';
import { Money } from '../../ui/Money';
import { showToast } from '../../ui/ToastHost';

export function InsightsPage() {
  useEffect(() => {
    void loadSales().catch((e) =>
      showToast(e instanceof Error ? e.message : 'Could not load insights'),
    );
  }, []);

  const stats = useMemo(() => {
    const today = new Date();
    const start = new Date(today);
    start.setHours(0, 0, 0, 0);
    const todays = sales.value.filter((s) => new Date(s.created_at || 0) >= start);
    const revenue = todays.reduce((sum, s) => {
      if (s.is_credit && !s.credit_cleared) return sum + (Number(s.amount_paid_ugx) || 0);
      return sum + (Number(s.total_ugx) || 0);
    }, 0);
    return { count: todays.length, revenue };
  }, [sales.value]);

  return (
    <section>
      <h1 class="page-title">Insights</h1>
      <div class="v-stat-grid">
        <div class="v-stat">
          <div class="v-stat__label">Today</div>
          <div class="v-stat__value v-stat__value--display">
            <Money value={stats.revenue} size="xl" />
          </div>
        </div>
        <div class="v-stat">
          <div class="v-stat__label">Sales</div>
          <div class="v-stat__value">{stats.count}</div>
        </div>
      </div>
      <p class="v-muted" style={{ marginTop: 16, color: 'var(--fg-2)' }}>
        Full charts, partner batches, and heatmaps continue porting from v1 analytics. Today totals
        above use paid + partial credit cash.
      </p>
    </section>
  );
}
