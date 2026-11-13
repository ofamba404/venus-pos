import { useState } from 'preact/hooks';
import './insights.css';
import type { MoneyBucket, MoneyChart as MoneyChartData } from '../../domain/money-chart';
import { formatUGX } from '../../domain/format';
import { Money } from '../../ui/Money';
import { EmptyState } from '../../ui/EmptyState';

/** The bars: profit only, split into what you keep and the helper's share. */
const PARTS = ['owner', 'helper'] as const;

function labelStep(count: number) {
  return Math.max(1, Math.ceil(count / 7));
}

function Column({
  bucket,
  maxProfit,
  on,
  dim,
  onPick,
}: {
  bucket: MoneyBucket;
  maxProfit: number;
  on: boolean;
  dim: boolean;
  onPick: () => void;
}) {
  const height = bucket.profit > 0 ? Math.max(3, (bucket.profit / maxProfit) * 100) : 0;

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
          const value = bucket[part];
          return value > 0 ? (
            <span
              key={part}
              class={`money__seg money__seg--${part}`}
              style={{ flexGrow: value }}
              data-part={part}
            />
          ) : null;
        })}
      </span>
      {bucket.profit <= 0 ? <span class="money__zero" /> : null}
    </button>
  );
}

/** Profit for the chosen range: one number, one bar per day, week or month, and one split strip. */
export function MoneyChart({ chart, loading }: { chart: MoneyChartData; loading?: boolean }) {
  const [pick, setPick] = useState<number | null>(null);
  const picked = pick !== null ? (chart.buckets[pick] ?? null) : null;
  const shown = picked || chart.totals;
  const step = labelStep(chart.buckets.length);
  const hasSales = chart.totals.sales > 0;
  const split = shown.owner + shown.helper;
  const ownerPct = split > 0 ? (shown.owner / split) * 100 : 50;

  return (
    <section class="decision money" aria-label="Sales and profit" data-testid="money-chart">
      <h2 class="decision__q">What am I making?</h2>
      <div class="money__hero" data-testid="money-totals">
        <span class="money__profit" data-testid="money-profit" data-value={chart.totals.profit}>
          <Money value={chart.totals.profit} size="xl" />
        </span>
        <span class="money__of" data-testid="money-sales" data-value={chart.totals.sales}>
          profit of <Money value={chart.totals.sales} /> sales
        </span>
      </div>

      {loading ? (
        <p class="v-muted">Loading sales…</p>
      ) : !hasSales ? (
        <EmptyState title="No sales in this range" body="Pick a longer range, or make a sale." />
      ) : (
        <>
          <div class="money__plot" data-testid="money-plot" data-unit={chart.unit}>
            <div
              class="money__bars"
              style={{ gridTemplateColumns: `repeat(${chart.buckets.length}, minmax(0, 1fr))` }}
            >
              {chart.buckets.map((bucket, i) => (
                <Column
                  key={bucket.key}
                  bucket={bucket}
                  maxProfit={chart.maxProfit}
                  on={pick === i}
                  dim={pick !== null && pick !== i}
                  onPick={() => setPick(pick === i ? null : i)}
                />
              ))}
            </div>
            <div
              class="money__axis"
              style={{ gridTemplateColumns: `repeat(${chart.buckets.length}, minmax(0, 1fr))` }}
              aria-hidden="true"
            >
              {chart.buckets.map((bucket, i) => (
                <span key={bucket.key}>{i % step === 0 ? bucket.label : ''}</span>
              ))}
            </div>
          </div>
          <p class="money__readout" data-testid="money-readout" aria-live="polite">
            {picked ? (
              <>
                {picked.title} · profit <b>{picked.profit.toLocaleString('en-UG')}</b> · sales{' '}
                <b>{picked.sales.toLocaleString('en-UG')}</b>
              </>
            ) : null}
          </p>
          {chart.totals.helper > 0 ? (
            <div class="money__split" data-testid="money-split">
              <div class="money__strip" aria-hidden="true">
                <span class="money__seg--owner" style={{ width: `${ownerPct}%` }} />
                <span class="money__seg--helper" style={{ width: `${100 - ownerPct}%` }} />
              </div>
              <div class="money__split-labels">
                <span data-testid="money-owner" data-value={shown.owner}>
                  <span class="money__swatch money__seg--owner" aria-hidden="true" /> You{' '}
                  <Money value={shown.owner} />
                </span>
                <span data-testid="money-helper" data-value={shown.helper}>
                  <span class="money__swatch money__seg--helper" aria-hidden="true" /> Helper{' '}
                  <Money value={shown.helper} />
                </span>
              </div>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}
