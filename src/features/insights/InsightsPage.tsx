import { useEffect, useMemo } from 'preact/hooks';
import { loadSales, sales, clients, loadClients } from '../../data/entities';
import { computeTodayStats } from '../../domain/today';
import { sumOwnerRevenue } from '../../domain/revenue';
import {
  getOutstandingCredit,
  groupOutstandingByClient,
  sumCreditOwed,
} from '../../domain/credit';
import { cookieBatchShareText, openPartnerBatches } from '../../domain/partner';
import { KEYS } from '../../data/keys';
import { postCookiePartnerSettle } from '../../data/writes/partner';
import { Money } from '../../ui/Money';
import { Button } from '../../ui/Button';
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

  const partnerBatches = useMemo(() => {
    let settled = 25;
    try {
      const raw = localStorage.getItem(KEYS.partnerSettled);
      if (raw != null && raw !== '') settled = Math.max(0, Math.round(Number(raw) || 0));
    } catch {
      /* private mode */
    }
    return openPartnerBatches(sales.value as Parameters<typeof openPartnerBatches>[0], settled);
  }, [sales.value]);

  async function settleNextBatch() {
    const batch = partnerBatches.find((row) => row.complete) || partnerBatches[0];
    if (!batch) {
      showToast('No batch to settle');
      return;
    }
    const prev = Number(localStorage.getItem(KEYS.partnerSettled) || 25);
    const settled = prev + batch.cookieCount;
    localStorage.setItem(KEYS.partnerSettled, String(settled));
    try {
      await postCookiePartnerSettle(settled);
    } catch {
      /* local progress still stands */
    }
    const text = cookieBatchShareText(batch);
    void navigator.clipboard?.writeText(text).then(
      () => showToast('Batch settled'),
      () => showToast(text),
    );
  }

  return (
    <section>
      <h1 class="page-title">Insights</h1>
      <div class="v-stat-grid">
        <div class="v-stat" data-testid="insights-today" data-revenue={today.revenue} data-joints={today.joints}>
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
        <div class="v-stat" data-testid="insights-credit" data-owed={credit.total}>
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

      <div class="v-section-label">Cookie partner</div>
      {partnerBatches.length ? (
        partnerBatches.slice(0, 3).map((b) => (
          <div class="v-list-row" key={b.index}>
            <div class="v-list-row__main">
              <div class="v-list-row__title">
                Batch {b.index} · {b.cookieCount}/{b.every}
                {b.complete ? '' : ' (open)'}
              </div>
              <div class="v-list-row__meta">
                Partner <Money value={b.partnerDue} /> · you <Money value={b.ownerSplit} />
              </div>
            </div>
            <Button variant="ghost" size="md" data-testid="partner-settle" onClick={() => void settleNextBatch()}>
              Settle batch
            </Button>
          </div>
        ))
      ) : (
        <p class="v-muted">No open partner batches</p>
      )}

      <p class="v-muted" style={{ marginTop: 16, color: 'var(--fg-2)' }}>
        Owner revenue uses the v1 recognition rules (paid + partial credit cash). Charts still
        porting.
      </p>
    </section>
  );
}
