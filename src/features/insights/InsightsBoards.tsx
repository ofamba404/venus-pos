import type { TimeBucket } from '../../domain/analytics/periods';
import type { AgingBucket, ClientRank, FlavorSlice, ProductBar } from '../../domain/insights-view';
import { Money } from '../../ui/Money';
import { FlavorDot } from '../../ui/FlavorDot';

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function InsightsBoards({
  series,
  seriesMax,
  products,
  topProduct,
  flavors,
  peakHour,
  peakWeekday,
  heat,
  heatMax,
  leaders,
  aging,
  commission,
}: {
  series: TimeBucket[];
  seriesMax: number;
  products: ProductBar[];
  topProduct: string;
  flavors: FlavorSlice[];
  peakHour: number;
  peakWeekday: number;
  heat: number[][];
  heatMax: number;
  leaders: ClientRank[];
  aging: AgingBucket[];
  commission: { rate: number; commission: number; profit: number };
}) {
  const productMax = Math.max(1, ...products.map((row) => row.revenue));
  const flavorMax = Math.max(1, flavors[0]?.qty || 1);
  return (
    <>
      <div class="v-section-label">Revenue</div>
      <div class="v-chart" data-testid="insights-series" aria-label="Revenue by period">
        {series.map((bucket) => (
          <div
            key={bucket.label}
            class="v-chart__bar"
            style={{ height: `${Math.max(8, (bucket.revenue / seriesMax) * 100)}%` }}
            title={`${bucket.label} ${bucket.revenue}`}
          />
        ))}
      </div>

      <div class="v-section-label">Sales by product</div>
      <div class="v-bars" data-testid="insights-rank">
        {products.map((row) => (
          <div class="v-bars__row" key={row.name}>
            <span class="v-bars__label">{row.name}</span>
            <span class="v-bars__track">
              <span style={{ width: `${(row.revenue / productMax) * 100}%` }} />
            </span>
            <span class="v-bars__val">{row.count}</span>
          </div>
        ))}
        {!products.length ? <p class="v-muted">{topProduct}</p> : null}
      </div>

      <div class="v-section-label">Flavour mix</div>
      <div class="v-bars">
        {flavors.slice(0, 8).map((row) => (
          <div class="v-bars__row" key={row.id}>
            <span class="v-bars__label">
              <FlavorDot color={row.color} /> {row.name}
            </span>
            <span class="v-bars__track">
              <span style={{ width: `${(row.qty / flavorMax) * 100}%`, background: row.color }} />
            </span>
            <span class="v-bars__val">{row.qty}</span>
          </div>
        ))}
      </div>

      <div class="v-section-label">Peak hours</div>
      <p class="v-muted" data-testid="insights-heatmap">
        Busiest around {peakHour}:00 on {WEEKDAYS[peakWeekday]}
      </p>
      <div class="v-heat" aria-hidden="true">
        {heat.map((row, day) =>
          row.slice(8, 22).map((value, hour) => (
            <span
              key={`${day}-${hour}`}
              class="v-heat__cell"
              style={{ opacity: Math.max(0.12, value / Math.max(1, heatMax)) }}
            />
          )),
        )}
      </div>

      <div class="v-section-label">Top clients</div>
      {leaders.length ? (
        leaders.map((row) => (
          <div class="v-list-row" key={row.id}>
            <div class="v-list-row__main">
              <div class="v-list-row__title">{row.name}</div>
              <div class="v-list-row__meta">{row.orders} orders</div>
            </div>
            <Money value={row.revenue} />
          </div>
        ))
      ) : (
        <p class="v-muted">No client sales yet</p>
      )}

      <div class="v-section-label">Credit aging</div>
      {aging.map((bucket) => (
        <div class="v-list-row" key={bucket.id}>
          <div class="v-list-row__main">
            <div class="v-list-row__title">{bucket.label}</div>
            <div class="v-list-row__meta">{bucket.count} open</div>
          </div>
          <Money value={bucket.total} />
        </div>
      ))}

      <div class="v-section-label">Staff commission</div>
      <div class="v-stat" data-testid="insights-commission">
        <div class="v-stat__label">Joint profit share · {Math.round(commission.rate * 100)}%</div>
        <div class="v-stat__value">
          <Money value={commission.commission} />
        </div>
        <p class="v-muted">
          From joint cost history. Profit <Money value={commission.profit} />. Unpaid credit is excluded.
        </p>
      </div>
    </>
  );
}
