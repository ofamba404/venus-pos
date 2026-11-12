import type { TimeBucket } from '../../domain/analytics/periods';
import type { AgingBucket, ClientRank, FlavorSlice, ProductBar } from '../../domain/insights-view';
import { formatUGX } from '../../domain/format';
import { Money } from '../../ui/Money';
import { Sheet } from '../../ui/Sheet';

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export type Drill =
  | 'revenue'
  | 'products'
  | 'flavours'
  | 'hours'
  | 'clients'
  | 'aging'
  | 'commission'
  | 'partner';

const TITLES: Record<Drill, string> = {
  revenue: 'Revenue',
  products: 'Sales by product',
  flavours: 'Flavour mix',
  hours: 'Peak hours',
  clients: 'Clients',
  aging: 'Credit aging',
  commission: 'Staff commission',
  partner: 'Cookie partner',
};

/** The numbers behind a chart. They open after a tap, they are not the page. */
export function InsightsDrill({
  drill,
  onClose,
  series,
  profit,
  products,
  flavors,
  leaders,
  aging,
  credit,
  commission,
  peakHour,
  peakWeekday,
  partnerNote,
}: {
  drill: Drill | null;
  onClose: () => void;
  series: TimeBucket[];
  profit: number[];
  products: ProductBar[];
  flavors: FlavorSlice[];
  leaders: ClientRank[];
  aging: AgingBucket[];
  credit: Array<{ key: string; name: string; totalUgx: number; sales: { length: number } }>;
  commission: { rate: number; commission: number; profit: number };
  peakHour: number;
  peakWeekday: number;
  partnerNote: string;
}) {
  return (
    <Sheet open={Boolean(drill)} title={drill ? TITLES[drill] : ''} onClose={onClose}>
      {drill === 'revenue'
        ? series.map((bucket, index) => (
            <div class="v-list-row" key={bucket.label}>
              <div class="v-list-row__main">
                <div class="v-list-row__title">{bucket.label}</div>
                <div class="v-list-row__meta">
                  {bucket.orders} sales · profit {formatUGX(profit[index] || 0)}
                </div>
              </div>
              <Money value={bucket.revenue} />
            </div>
          ))
        : null}
      {drill === 'products'
        ? products.map((row) => (
            <div class="v-list-row" key={row.name}>
              <div class="v-list-row__main">
                <div class="v-list-row__title">{row.name}</div>
                <div class="v-list-row__meta">{row.count} sold</div>
              </div>
              <Money value={row.revenue} />
            </div>
          ))
        : null}
      {drill === 'flavours'
        ? flavors.map((row) => (
            <div class="v-list-row" key={row.id}>
              <div class="v-list-row__main">
                <div class="v-list-row__title">{row.name}</div>
                <div class="v-list-row__meta">{row.qty}</div>
              </div>
            </div>
          ))
        : null}
      {drill === 'hours' ? (
        <p>
          Busiest around {peakHour}:00 on {WEEKDAYS[peakWeekday]}. Darker cells are the hours that took more money.
        </p>
      ) : null}
      {drill === 'clients'
        ? leaders.map((row) => (
            <div class="v-list-row" key={row.id}>
              <div class="v-list-row__main">
                <div class="v-list-row__title">{row.name}</div>
                <div class="v-list-row__meta">{row.orders} orders</div>
              </div>
              <Money value={row.revenue} />
            </div>
          ))
        : null}
      {drill === 'aging' ? (
        <>
          {aging.map((bucket) => (
            <div class="v-list-row" key={bucket.id}>
              <div class="v-list-row__main">
                <div class="v-list-row__title">{bucket.label}</div>
                <div class="v-list-row__meta">{bucket.count} open</div>
              </div>
              <Money value={bucket.total} />
            </div>
          ))}
          {credit.map((row) => (
            <div class="v-list-row" key={row.key}>
              <div class="v-list-row__main">
                <div class="v-list-row__title">{row.name}</div>
                <div class="v-list-row__meta">{row.sales.length} open</div>
              </div>
              <Money value={row.totalUgx} />
            </div>
          ))}
        </>
      ) : null}
      {drill === 'commission' ? (
        <p>
          {Math.round(commission.rate * 100)}% of joint profit ({formatUGX(commission.profit)}). Unpaid credit is excluded.
          The share is {formatUGX(commission.commission)}.
        </p>
      ) : null}
      {drill === 'partner' ? <p>{partnerNote}</p> : null}
    </Sheet>
  );
}
