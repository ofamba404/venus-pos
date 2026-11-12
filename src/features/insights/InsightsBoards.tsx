import { useState } from 'preact/hooks';
import type { TimeBucket } from '../../domain/analytics/periods';
import type { AgingBucket, ClientRank, FlavorSlice, ProductBar } from '../../domain/insights-view';
import type { PartnerBatch } from '../../domain/partner';
import { formatCompact, formatUGX } from '../../domain/format';
import { Money } from '../../ui/Money';
import { Button } from '../../ui/Button';
import { AreaChart, BarChart, ChartCard, Donut, Heatmap, Ring } from '../../ui/charts/Charts';
import { InsightsDrill, type Drill } from './InsightsDrill';

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function InsightsBoards({
  series,
  profit,
  products,
  flavors,
  peakHour,
  peakWeekday,
  heat,
  heatMax,
  leaders,
  aging,
  credit,
  commission,
  partnerQty,
  partnerLoading,
  settled,
  openBatch,
  onSettle,
}: {
  series: TimeBucket[];
  profit: number[];
  products: ProductBar[];
  flavors: FlavorSlice[];
  peakHour: number;
  peakWeekday: number;
  heat: number[][];
  heatMax: number;
  leaders: ClientRank[];
  aging: AgingBucket[];
  credit: Array<{ key: string; name: string; totalUgx: number; sales: { length: number } }>;
  commission: { rate: number; commission: number; profit: number };
  partnerQty: number | null;
  partnerLoading: boolean;
  settled: Array<{ index: number; cookieCount: number; every: number }>;
  openBatch: PartnerBatch | null;
  onSettle: () => void;
}) {
  const [drill, setDrill] = useState<Drill | null>(null);
  const peak = series.reduce((best, bucket) => (bucket.revenue > best.revenue ? bucket : best), series[0] || { label: '—', revenue: 0, orders: 0, date: new Date() });
  const shownSettled = settled.slice(0, 8);
  const extraSettled = Math.max(0, settled.length - shownSettled.length);
  const partnerNote = openBatch
    ? `Batch ${openBatch.index} is ${openBatch.cookieCount} of ${openBatch.every}. Partner ${formatUGX(openBatch.partnerDue)}, you ${formatUGX(openBatch.ownerSplit)}.`
    : 'No open partner batch.';

  return (
    <>
      <AreaChart
        testId="insights-series"
        points={series.map((bucket) => ({ label: bucket.label, value: bucket.revenue }))}
        profit={profit}
        caption={series.length ? `Peak ${peak.label} · ${formatUGX(peak.revenue)}` : 'No sales in this range'}
        onOpen={() => setDrill('revenue')}
      />
      <BarChart
        title="Sales by product"
        testId="insights-rank"
        rows={products.map((row) => ({ id: row.name, label: row.name, value: row.revenue, note: String(row.count) }))}
        onOpen={() => setDrill('products')}
      />
      <Donut
        slices={flavors.map((row) => ({ id: row.id, name: row.name, color: row.color, value: row.qty }))}
        onOpen={() => setDrill('flavours')}
      />
      <Heatmap
        heat={heat}
        heatMax={heatMax}
        caption={`Busiest around ${peakHour}:00 on ${WEEKDAYS[peakWeekday]}`}
        onOpen={() => setDrill('hours')}
      />
      <BarChart
        title="Credit aging"
        rows={aging.map((bucket) => ({
          id: bucket.id,
          label: bucket.label,
          value: bucket.total,
          note: formatCompact(bucket.total),
          color: bucket.id === 'older' ? 'var(--watermelon)' : 'var(--accent)',
        }))}
        onOpen={() => setDrill('aging')}
      />
      <BarChart
        title="Clients"
        rows={leaders.map((row) => ({
          id: row.id,
          label: row.name,
          value: row.revenue,
          note: formatCompact(row.revenue),
        }))}
        onOpen={() => setDrill('clients')}
      />
      <ChartCard
        title="Staff commission"
        testId="insights-commission"
        label={`Staff commission ${formatUGX(commission.commission)}`}
        onOpen={() => setDrill('commission')}
      >
        <span class="ring-row">
          <Ring
            value={commission.commission}
            max={Math.max(commission.profit, 1)}
            center={`${Math.round(commission.rate * 100)}%`}
          />
          <span>
            <Money value={commission.commission} />
            <span class="chart-card__caption">of {formatUGX(commission.profit)} joint profit</span>
          </span>
        </span>
      </ChartCard>
      <div class="chart-card chart-card--static">
        <span class="chart-card__title">Cookie partner</span>
        <p data-testid="partner-settled-qty">
          {partnerLoading ? 'Loading settlement…' : `${partnerQty ?? 0} cookies already settled`}
        </p>
        <button type="button" class="ring-row ring-row--hit" onClick={() => setDrill('partner')} aria-label={partnerNote}>
          {shownSettled.map((batch) => (
            <span key={batch.index} class="batch-dot" title={`Batch ${batch.index} settled`} />
          ))}
          {extraSettled ? <span class="chart-card__caption">+{extraSettled}</span> : null}
          <Ring
            value={openBatch ? openBatch.cookieCount : openBatch === null && settled.length ? 25 : 0}
            max={openBatch ? openBatch.every : 25}
            center={openBatch ? String(openBatch.cookieCount) : '—'}
          />
        </button>
        <span class="chart-card__caption">
          {settled[0]
            ? `Settled · Batch ${settled[0].index} · ${settled[0].cookieCount}/${settled[0].every}`
            : 'No settled batches'}
          {openBatch ? ` · ${openBatch.cookieCount} of ${openBatch.every} in batch ${openBatch.index}` : ' · No open partner batch'}
        </span>
        {openBatch ? (
          <Button variant="secondary" size="md" data-testid="partner-settle" onClick={onSettle}>
            Settle batch
          </Button>
        ) : null}
      </div>
      <InsightsDrill
        drill={drill}
        onClose={() => setDrill(null)}
        series={series}
        profit={profit}
        products={products}
        flavors={flavors}
        leaders={leaders}
        aging={aging}
        credit={credit}
        commission={commission}
        peakHour={peakHour}
        peakWeekday={peakWeekday}
        partnerNote={partnerNote}
      />
    </>
  );
}
