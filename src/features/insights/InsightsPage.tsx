import { useEffect, useMemo } from 'preact/hooks';
import { loadSales, sales, clients, loadClients } from '../../data/entities';
import { computeTodayStats } from '../../domain/today';
import { sumOwnerRevenue } from '../../domain/revenue';
import {
  getOutstandingCredit,
  groupOutstandingByClient,
  sumCreditOwed,
} from '../../domain/credit';
import { Money } from '../../ui/Money';
import { showToast } from '../../ui/ToastHost';

export function InsightsPage() {
  useEffect(() => {
    void Promise.all([loadSales(), loadClients()]).catch((e) =>
      showToast(e instanceof Error ? e.message : 'Could not load insights'),
    );
  }, []);

  const today = useMemo(
    () => computeTodayStats(sales.value as Parameters<typeof computeTodayStats>[0]),
    [sales.value],
  );
  const monthRevenue = useMemo(() => {
    const start = new Date();
    start.setDate(1);
    start.setHours(0, 0, 0, 0);
    const list = sales.value.filter((s) => new Date(s.created_at || 0) >= start);
    return Math.round(sumOwnerRevenue(list as Parameters<typeof sumOwnerRevenue>[0]));
  }, [sales.value]);
  const credit = useMemo(() => {
    const open = getOutstandingCredit(sales.value);
    return {
      total: sumCreditOwed(open),
      groups: groupOutstandingByClient(open, clients.value).slice(0, 5),
    };
  }, [sales.value, clients.value]);

  return (
    <section>
      <h1 class="page-title">Insights</h1>
      <div class="v-stat-grid">
        <div class="v-stat">
          <div class="v-stat__label">Today</div>
          <div class="v-stat__value v-stat__value--display">
            <Money value={today.revenue} size="xl" />
          </div>
        </div>
        <div class="v-stat">
          <div class="v-stat__label">Sales today</div>
          <div class="v-stat__value">{today.salesCount}</div>
        </div>
        <div class="v-stat">
          <div class="v-stat__label">Month</div>
          <div class="v-stat__value">
            <Money value={monthRevenue} />
          </div>
        </div>
        <div class="v-stat">
          <div class="v-stat__label">Credit owed</div>
          <div class="v-stat__value" style={{ color: 'var(--danger)' }}>
            <Money value={credit.total} />
          </div>
        </div>
      </div>

      <div class="v-section-label">Top credit</div>
      {credit.groups.length ? (
        credit.groups.map((g) => (
          <div class="v-list-row" key={g.key}>
            <div class="v-list-row__main">
              <div class="v-list-row__title">{g.name}</div>
              <div class="v-list-row__meta">{g.sales.length} open</div>
            </div>
            <Money value={g.totalUgx} />
          </div>
        ))
      ) : (
        <p class="v-muted">No outstanding credit</p>
      )}

      <p class="v-muted" style={{ marginTop: 16, color: 'var(--fg-2)' }}>
        Owner revenue uses the v1 recognition rules (paid + partial credit cash). Partner batches and
        charts continue porting.
      </p>
    </section>
  );
}
