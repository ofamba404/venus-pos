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
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 12,
        }}
      >
        <div
          style={{
            background: 'var(--surface)',
            borderRadius: 'var(--r-lg)',
            padding: 16,
            boxShadow: 'inset 0 0 0 1px var(--line)',
          }}
        >
          <div style={{ font: 'var(--t-mono-micro)', letterSpacing: '0.06em', color: 'var(--fg-3)' }}>
            TODAY
          </div>
          <div style={{ font: 'var(--t-display)', marginTop: 8 }}>
            <Money value={stats.revenue} size="xl" />
          </div>
        </div>
        <div
          style={{
            background: 'var(--surface)',
            borderRadius: 'var(--r-lg)',
            padding: 16,
            boxShadow: 'inset 0 0 0 1px var(--line)',
          }}
        >
          <div style={{ font: 'var(--t-mono-micro)', letterSpacing: '0.06em', color: 'var(--fg-3)' }}>
            SALES
          </div>
          <div style={{ font: 'var(--t-money-xl)', marginTop: 8 }}>{stats.count}</div>
        </div>
      </div>
      <p style={{ color: 'var(--fg-2)', font: 'var(--t-meta)', marginTop: 16 }}>
        Full charts, partner batches, and heatmaps continue porting from v1 analytics. Today totals
        above use paid + partial credit cash.
      </p>
    </section>
  );
}
