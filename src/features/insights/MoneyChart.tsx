import { useState } from 'preact/hooks';
import './insights.css';
import type { MoneyBucket, MoneyChart as MoneyChartData, MoneyFigures } from '../../domain/money-chart';
import { profitMarginPct } from '../../domain/money-chart';
import { formatUGX } from '../../domain/format';
import { Money } from '../../ui/Money';
import { EmptyState } from '../../ui/EmptyState';

const PARTS = [
  { key: 'owner', label: 'You keep' },
  { key: 'helper', label: 'Helper' },
  { key: 'partner', label: 'Cookie partner' },
  { key: 'costs', label: 'Joint cost' },
] as const;

type PartKey = (typeof PARTS)[number]['key'];

function labelStep(count: number) {
  return Math.max(1, Math.ceil(count / 7));
}

function Column({
  bucket,
  max,
  on,
  dim,
  onPick,
}: {
  bucket: MoneyBucket;
  max: number;
  on: boolean;
  dim: boolean;
  onPick: () => void;
}) {
  const height = bucket.sales > 0 ? Math.max(3, (bucket.sales / max) * 100) : 0;
  return (
    <button
      type="button"
      class={`money__col${on ? ' is-on' : ''}${dim ? ' is-dim' : ''}`}
      aria-pressed={on}
      aria-label={`${bucket.title}: sales ${formatUGX(bucket.sales)}, profit ${formatUGX(bucket.profit)}`}
      data-testid="money-bar"
      data-sales={bucket.sales}
      data-profit={bucket.profit}
      onClick={onPick}
    >
      <span class="money__stack" style={{ height: `${height}%` }}>
        {PARTS.map((part) => {
          const value = bucket[part.key];
          return value > 0 ? (
            <span
              key={part.key}
              class={`money__seg money__seg--${part.key}`}
              style={{ flexGrow: value }}
              data-part={part.key}
            />
          ) : null;
        })}
      </span>
      {bucket.sales <= 0 ? <span class="money__zero" /> : null}
    </button>
  );
}

/** Sales and profit for the chosen range, one stacked bar per day, week or month. */
export function MoneyChart({ chart, loading }: { chart: MoneyChartData; loading?: boolean }) {
  const [pick, setPick] = useState<number | null>(null);
  const picked = pick !== null ? chart.buckets[pick] ?? null : null;
  const shown: MoneyFigures = picked || chart.totals;
  const step = labelStep(chart.buckets.length);
  const hasSales = chart.totals.sales > 0;
  const unit = chart.unit === 'day' ? 'day' : chart.unit === 'week' ? 'week' : 'month';

  return (
    <section class="decision money" aria-label="Sales and profit" data-testid="money-chart">
      <h2 class="decision__q">What am I making?</h2>
      <div class="money__totals" data-testid="money-totals">
        <div class="money__figure" data-testid="money-sales" data-value={chart.totals.sales}>
          <span class="money__label">Sales</span>
          <Money value={chart.totals.sales} />
        </div>
        <div class="money__figure" data-testid="money-profit" data-value={chart.totals.profit}>
          <span class="money__label">Profit</span>
          <Money value={chart.totals.profit} />
          <span class="money__pct" data-testid="money-margin">
            {profitMarginPct(chart.totals)}% of sales
          </span>
        </div>
      </div>

      {loading ? (
        <p class="v-muted">Loading sales…</p>
      ) : !hasSales ? (
        <EmptyState title="No sales in this range" body="Pick a longer range, or make a sale." />
      ) : (
        <>
          <div class="money__plot" data-testid="money-plot" data-unit={chart.unit}>
            <span class="money__max" aria-hidden="true">
              {formatUGX(chart.max)}
            </span>
            <div class="money__bars" style={{ gridTemplateColumns: `repeat(${chart.buckets.length}, minmax(0, 1fr))` }}>
              {chart.buckets.map((bucket, i) => (
                <Column
                  key={bucket.key}
                  bucket={bucket}
                  max={chart.max}
                  on={pick === i}
                  dim={pick !== null && pick !== i}
                  onPick={() => setPick(pick === i ? null : i)}
                />
              ))}
            </div>
            <div class="money__axis" style={{ gridTemplateColumns: `repeat(${chart.buckets.length}, minmax(0, 1fr))` }} aria-hidden="true">
              {chart.buckets.map((bucket, i) => (
                <span key={bucket.key}>{i % step === 0 ? bucket.label : ''}</span>
              ))}
            </div>
          </div>
          <p class="money__readout" data-testid="money-readout">
            <strong>{picked ? picked.title : `Whole range, by ${unit}`}</strong>
            Sales <Money value={shown.sales} /> · Profit <Money value={shown.profit} />
          </p>
          <div class="money__legend" data-testid="money-legend">
            {PARTS.map((part) => (
              <div class="money__chip" key={part.key} data-testid={`money-${part.key}`} data-value={shown[part.key as PartKey]}>
                <span class={`money__swatch money__seg--${part.key}`} aria-hidden="true" />
                <span class="money__chip-label">{part.label}</span>
                <Money value={shown[part.key as PartKey]} />
              </div>
            ))}
          </div>
          <p class="decision__why">
            Profit is your share plus the helper's. Joint cost and the cookie partner's cut come out of sales first.
          </p>
        </>
      )}
    </section>
  );
}
