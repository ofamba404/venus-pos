import { useEffect, useMemo, useState } from 'preact/hooks';
import { loadSales, sales, clients, loadClients } from '../../data/entities';
import { computeTodayStats } from '../../domain/today';
import { sumOwnerRevenue } from '../../domain/revenue';
import {
  getOutstandingCredit,
  groupOutstandingByClient,
  sumCreditOwed,
} from '../../domain/credit';
import { cookieBatchShareText, expandPartnerUnitsFromSales, partnerBoard, proposeSettle } from '../../domain/partner';
import { fetchCookiePartnerSettle, postCookiePartnerSettle } from '../../data/writes/partner';
import { buildTimeSeries, CHART_RANGES } from '../../domain/analytics/periods';
import { computeSalesPatterns } from '../../domain/analytics/patterns';
import { revenueDelta } from '../../domain/analytics/rank';
import { KpiTile } from '../../ui/KpiTile';
import { readStoredId } from '../../domain/parity';
import {
  creditAging,
  flavorMix,
  historyOrDefault,
  jointCommission,
  productBars,
  topClients,
} from '../../domain/insights-view';
import type { JointCostRow } from '../../domain/joint-cost';
import { sbFetch } from '../../data/api';
import { KEYS } from '../../data/keys';
import { Money } from '../../ui/Money';
import { Button } from '../../ui/Button';
import { showToast } from '../../ui/ToastHost';
import { InsightsBoards } from './InsightsBoards';

export function InsightsPage() {
  const [range, setRange] = useState(() =>
    readStoredId(
      localStorage.getItem(KEYS.chartRange),
      CHART_RANGES.map((row) => row.id),
      '1w',
    ),
  );
  const [serverSettle, setServerSettle] = useState<{ qty: number; batches: number[] } | null>(null);
  const [costHistory, setCostHistory] = useState<JointCostRow[]>([]);

  useEffect(() => {
    void Promise.all([loadSales(), loadClients()]).catch((e) =>
      showToast(e instanceof Error ? e.message : 'Could not load insights'),
    );
    void fetchCookiePartnerSettle().then((state) => {
      if (state) setServerSettle(state);
    });
    void sbFetch('joint_cost_history?select=category_id,cost_ugx,effective_from')
      .then(async (res) => {
        if (!res.ok) return;
        const rows = (await res.json()) as JointCostRow[];
        if (Array.isArray(rows) && rows.length) setCostHistory(rows);
      })
      .catch(() => {});
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

  const series = useMemo(() => {
    const chart = CHART_RANGES.find((row) => row.id === range) || CHART_RANGES[0]!;
    return buildTimeSeries(sales.value as Parameters<typeof buildTimeSeries>[0], chart);
  }, [sales.value, range]);
  const weekSpark = useMemo(() => {
    const chart = CHART_RANGES.find((row) => row.id === '1w') || CHART_RANGES[0]!;
    return buildTimeSeries(sales.value as Parameters<typeof buildTimeSeries>[0], chart);
  }, [sales.value]);
  const monthSpark = useMemo(() => {
    const chart = CHART_RANGES.find((row) => row.id === '1m') || CHART_RANGES[0]!;
    return buildTimeSeries(sales.value as Parameters<typeof buildTimeSeries>[0], chart);
  }, [sales.value]);
  const patterns = useMemo(
    () => computeSalesPatterns(sales.value as Parameters<typeof computeSalesPatterns>[0]),
    [sales.value],
  );
  const flavors = useMemo(() => flavorMix(sales.value as Parameters<typeof flavorMix>[0]), [sales.value]);
  const products = useMemo(() => productBars(sales.value as Parameters<typeof productBars>[0]).slice(0, 6), [sales.value]);
  const aging = useMemo(
    () => creditAging(sales.value as Parameters<typeof creditAging>[0]),
    [sales.value],
  );
  const leaders = useMemo(
    () => topClients(sales.value as Parameters<typeof topClients>[0], clients.value),
    [sales.value, clients.value],
  );
  const commission = useMemo(
    () => jointCommission(sales.value as Parameters<typeof jointCommission>[0], historyOrDefault(costHistory)),
    [sales.value, costHistory],
  );
  const yesterdayRevenue = useMemo(() => {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const previous = new Date(start);
    previous.setDate(previous.getDate() - 1);
    const list = sales.value.filter((sale) => {
      const at = new Date(sale.created_at || 0);
      return at >= previous && at < start;
    });
    return Math.round(sumOwnerRevenue(list as Parameters<typeof sumOwnerRevenue>[0]));
  }, [sales.value]);
  const todayTrend = revenueDelta(today.revenue, yesterdayRevenue);
  const yesterdaySales = useMemo(() => {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const previous = new Date(start);
    previous.setDate(previous.getDate() - 1);
    return sales.value.filter((sale) => {
      const at = new Date(sale.created_at || 0);
      return at >= previous && at < start;
    }).length;
  }, [sales.value]);
  const salesTrend = revenueDelta(today.salesCount, yesterdaySales);
  const lastMonthRevenue = useMemo(() => {
    const start = new Date();
    start.setDate(1);
    start.setHours(0, 0, 0, 0);
    const previous = new Date(start);
    previous.setMonth(previous.getMonth() - 1);
    const list = sales.value.filter((sale) => {
      const at = new Date(sale.created_at || 0);
      return at >= previous && at < start;
    });
    return Math.round(sumOwnerRevenue(list as Parameters<typeof sumOwnerRevenue>[0]));
  }, [sales.value]);
  const monthTrend = revenueDelta(monthRevenue, lastMonthRevenue);
  const monthTrendText = monthTrend.text.replace('yesterday', 'last month').replace('today', 'this month');
  const profit = useMemo(
    () =>
      series.map((bucket, index) => {
        const start = bucket.date.getTime();
        const span =
          index < series.length - 1
            ? series[index + 1]!.date.getTime() - start
            : index > 0
              ? start - series[index - 1]!.date.getTime()
              : 86_400_000;
        const slice = sales.value.filter((sale) => {
          const at = new Date(sale.created_at || 0).getTime();
          return at >= start && at < start + span;
        });
        return jointCommission(slice as Parameters<typeof jointCommission>[0], historyOrDefault(costHistory)).profit;
      }),
    [series, sales.value, costHistory],
  );
  const creditLead = aging.reduce((best, row) => (row.total > best.total ? row : best), aging[0]!);
  const settledCuts = serverSettle?.batches ?? [];

  const partner = useMemo(() => {
    const list = sales.value as Parameters<typeof expandPartnerUnitsFromSales>[0];
    const cookieUnits = expandPartnerUnitsFromSales(list);
    const qty = serverSettle?.qty ?? 0;
    return partnerBoard(cookieUnits, qty, serverSettle?.batches ?? []);
  }, [sales.value, serverSettle]);

  async function settleNextBatch() {
    const open = partner.open;
    if (!open || !serverSettle) {
      showToast('No batch to settle');
      return;
    }
    const send = open.complete ? open.every : open.cookieCount;
    const proposed = proposeSettle(serverSettle.qty, serverSettle.batches, send);
    if (!proposed) {
      showToast('Already settled');
      return;
    }
    let res: Response;
    try {
      res = await postCookiePartnerSettle(proposed.qty, proposed.batches, serverSettle.qty);
    } catch {
      showToast('Could not reach the server. Batch not marked sent.');
      return;
    }
    if (!res.ok) {
      showToast('Server refused the settlement. Batch not marked sent.');
      return;
    }
    const data = (await res.json().catch(() => null)) as { ok?: boolean; settled_qty?: number; batches?: number[] } | null;
    if (!data?.ok || data.settled_qty === undefined || data.settled_qty === null || data.settled_qty < proposed.qty) {
      if (data?.settled_qty !== undefined && data?.settled_qty !== null) {
        setServerSettle({
          qty: data.settled_qty,
          batches: Array.isArray(data.batches) ? data.batches : serverSettle.batches,
        });
      }
      showToast('Server kept the earlier total. Batch not marked sent.');
      return;
    }
    const next = {
      qty: data.settled_qty,
      batches: Array.isArray(data.batches) ? data.batches : proposed.batches,
    };
    setServerSettle(next);
    try {
      localStorage.setItem(KEYS.partnerSettled, String(next.qty));
    } catch {
      /* private mode */
    }
    const text = cookieBatchShareText(open);
    void navigator.clipboard?.writeText(text).then(
      () => showToast('Batch settled'),
      () => showToast(text),
    );
  }

  return (
    <section>
      <h1 class="page-title">Insights</h1>
      <div class="v-chip-row" data-testid="chart-range">
        {CHART_RANGES.map((row) => (
          <Button
            key={row.id}
            size="md"
            variant={range === row.id ? 'primary' : 'secondary'}
            onClick={() => {
              localStorage.setItem(KEYS.chartRange, row.id);
              setRange(row.id);
            }}
          >
            {row.short}
          </Button>
        ))}
      </div>
      <div class="v-stat-grid">
        <KpiTile
          label="Today"
          testId="insights-today"
          revenue={today.revenue}
          joints={today.joints}
          spark={weekSpark.map((bucket) => bucket.revenue)}
          trend={{ text: todayTrend.text, tone: todayTrend.cls }}
        >
          <Money value={today.revenue} />
        </KpiTile>
        <KpiTile label="Sales today" spark={weekSpark.map((bucket) => bucket.orders)} trend={{ text: salesTrend.text, tone: salesTrend.cls }}>
          <span>{today.salesCount}</span>
        </KpiTile>
        <KpiTile
          label="Month"
          spark={monthSpark.map((bucket) => bucket.revenue)}
          trend={{ text: monthTrendText, tone: monthTrend.cls }}
        >
          <Money value={monthRevenue} />
        </KpiTile>
        <KpiTile
          label="Credit owed"
          testId="insights-credit"
          owed={credit.total}
          spark={aging.map((bucket) => bucket.total)}
          trend={{ text: creditLead.total ? creditLead.label : 'Nothing owed', tone: creditLead.id === 'older' ? 'down' : 'neutral' }}
        >
          <Money value={credit.total} />
        </KpiTile>
      </div>

      <InsightsBoards
        series={series}
        profit={profit}
        products={products}
        flavors={flavors}
        peakHour={patterns.peakHour.i}
        peakWeekday={patterns.peakWeekday.i}
        heat={patterns.heat}
        heatMax={patterns.heatMax}
        leaders={leaders}
        aging={aging}
        credit={credit.groups}
        commission={commission}
        partnerQty={serverSettle ? serverSettle.qty : null}
        partnerLoading={!serverSettle}
        settled={
          settledCuts.length
            ? settledCuts.map((count, index) => ({ index: index + 1, cookieCount: count, every: 25 }))
            : partner.settled
        }
        openBatch={partner.open}
        onSettle={() => void settleNextBatch()}
      />
    </section>
  );
}
