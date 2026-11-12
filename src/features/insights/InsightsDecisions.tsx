import type { ChaseRow, PackLine, ProfitPicture, RestockRow } from '../../domain/decisions';
import type { PartnerBatch } from '../../domain/partner';
import { ECONOMICS } from '../../domain/economics';
import { formatUGX } from '../../domain/format';
import { FlavorDot } from '../../ui/FlavorDot';
import { Money } from '../../ui/Money';
import { Button } from '../../ui/Button';
import { showToast } from '../../ui/ToastHost';
import { localPhoneDigits } from '../../domain/phone';
import { EmptyState } from '../../ui/EmptyState';

function copyText(text: string, ok: string) {
  void navigator.clipboard?.writeText(text).then(
    () => showToast(ok),
    () => showToast(text),
  );
}

export function InsightsDecisions({
  sentence,
  todayRevenue,
  joints,
  restock,
  restockText,
  chase,
  owed,
  picture,
  packSentence,
  partnerQty,
  partnerLoading,
  settled,
  openBatch,
  onSettle,
}: {
  sentence: string;
  todayRevenue: number;
  joints: number;
  restock: RestockRow[];
  restockText: string;
  chase: ChaseRow[];
  owed: number;
  picture: ProfitPicture;
  packSentence: string;
  partnerQty: number | null;
  partnerLoading: boolean;
  settled: Array<{ index: number; cookieCount: number; every: number }>;
  openBatch: PartnerBatch | null;
  onSettle: () => void;
}) {
  const selling = restock.filter((row) => row.sold > 0);
  const quiet = restock.length - selling.length;
  const horizon = ECONOMICS.restockCycleDays * 2;
  const soldPacks = picture.packs.filter((row) => row.soldProfit > 0);
  const maxPack = Math.max(1, ...soldPacks.map((row) => row.soldProfit));
  const firstSettled = settled[0];
  return (
    <>
      <p class="decision-lead" data-testid="insights-today" data-revenue={todayRevenue} data-joints={joints}>
        {sentence}
      </p>

      <section class="decision" aria-label="What should I restock">
        <h2 class="decision__q">What should I restock?</h2>
        {selling.map((row) => {
          const days = row.daysLeft === null ? horizon : row.daysLeft;
          const width = Math.max(0, Math.min(100, (days / horizon) * 100));
          const fill = row.color.toLowerCase() === '#ffffff' || row.color.toLowerCase() === '#fff' ? 'var(--plain)' : row.color;
          const label = row.stock <= 0 ? 'Out' : row.daysLeft !== null && row.daysLeft < ECONOMICS.restockCycleDays ? `~${Math.max(1, Math.round(row.daysLeft))}d` : `${Math.max(1, Math.round((row.daysLeft || 0) / 7))}w`;
          return (
            <div class={`cover${row.urgent ? ' cover--urgent' : ''}`} key={row.id}>
              <span class="cover__name">
                <FlavorDot color={row.color} />
                {row.name}
              </span>
              <span class="cover__track" aria-hidden="true">
                <span class="cover__fill" style={{ width: `${width}%`, background: fill }} />
                <span class="cover__mark" />
              </span>
              <span class="cover__days">{label}</span>
            </div>
          );
        })}
        {quiet ? <p class="decision__why">{quiet} with no sales this cycle</p> : null}
        <Button size="md" variant="secondary" data-testid="copy-restock" onClick={() => copyText(restockText, 'Restock list copied')}>
          Copy restock list
        </Button>
      </section>

      <section class="decision" aria-label="Who should I chase" data-testid="insights-credit" data-owed={owed}>
        <h2 class="decision__q">Who should I chase?</h2>
        {chase.length ? (
          chase.map((row) => (
            <div class="decision-row" key={row.id}>
              <div class="decision-row__main">
                <div class="v-list-row__title">{row.name}</div>
                <div class="v-list-row__meta">
                  {row.days} {row.days === 1 ? 'day' : 'days'} overdue · <Money value={row.owed} />
                </div>
              </div>
              {row.phone ? (
                <Button
                  size="md"
                  variant="secondary"
                  data-testid={`chase-phone-${row.id}`}
                  onClick={() => copyText(localPhoneDigits(row.phone), 'Phone copied')}
                >
                  Copy phone
                </Button>
              ) : null}
              {row.whatsapp ? (
                <a class="chase-link" href={row.whatsapp} target="_blank" rel="noopener noreferrer">
                  WhatsApp
                </a>
              ) : null}
            </div>
          ))
        ) : (
          <p class="v-muted">Nobody owes you.</p>
        )}
      </section>

      <section class="decision" aria-label="What am I making">
        <h2 class="decision__q">What am I really making?</h2>
        <div class="kpi-grid">
          <div class="kpi-tile">
            <div class="kpi-tile__label">You keep</div>
            <div class="kpi-tile__value"><Money value={picture.owner} /></div>
          </div>
          <div class="kpi-tile">
            <div class="kpi-tile__label">Helper {Math.round(picture.helperShare * 100)}%</div>
            <div class="kpi-tile__value"><Money value={picture.helper} /></div>
          </div>
          <div class="kpi-tile">
            <div class="kpi-tile__label">Cookie partner</div>
            <div class="kpi-tile__value"><Money value={picture.partner} /></div>
          </div>
        </div>
        {soldPacks.length ? (
          <div class="v-bars" data-testid="insights-rank">
            {soldPacks.map((row: PackLine) => (
              <div class="v-bars__row" key={row.id}>
                <span class="v-bars__label">{row.name}</span>
                <span class="v-bars__track">
                  <span style={{ width: `${(row.soldProfit / maxPack) * 100}%` }} />
                </span>
                <span class="v-bars__val">{formatUGX(row.soldProfit)}</span>
              </div>
            ))}
          </div>
        ) : (
          <div data-testid="insights-rank">
            <EmptyState title="No pack sales in this period" body={packSentence} />
          </div>
        )}
        {soldPacks.length ? <p class="decision__why">{packSentence}</p> : null}
      </section>

      <section class="decision" aria-label="What do I owe" data-testid="insights-commission">
        <h2 class="decision__q">What do I owe?</h2>
        <div class="decision-row">
          <div class="decision-row__main">
            <div class="v-list-row__title">Helper</div>
            <div class="v-list-row__meta">Commission for this period</div>
          </div>
          <Money value={picture.helper} />
        </div>
        <p data-testid="partner-settled-qty">
          {partnerLoading ? 'Loading settlement…' : `${partnerQty ?? 0} cookies already settled`}
        </p>
        {firstSettled ? (
          <p class="decision__why">
            Settled · Batch {firstSettled.index} · {firstSettled.cookieCount}/{firstSettled.every}
            {settled.length > 1 ? ` · ${settled.length} batches` : ''}
          </p>
        ) : null}
        {openBatch ? (
          <div class="decision-row">
            <div class="decision-row__main">
              <div class="v-list-row__title">
                Batch {openBatch.index} · {openBatch.cookieCount}/{openBatch.every}
              </div>
              <div class="v-list-row__meta">
                {openBatch.complete ? 'Ready to pay' : 'Fills before you pay'} · partner <Money value={openBatch.partnerDue} />
              </div>
            </div>
            <Button variant="secondary" size="md" data-testid="partner-settle" onClick={onSettle}>
              Settle batch
            </Button>
          </div>
        ) : (
          <p class="v-muted">No open partner batch</p>
        )}
      </section>
    </>
  );
}
