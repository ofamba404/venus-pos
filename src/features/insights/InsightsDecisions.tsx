import type { ChaseRow, PackLine, ProfitPicture, RestockRow } from '../../domain/decisions';
import type { PartnerBatch } from '../../domain/partner';
import { formatUGX } from '../../domain/format';
import { FlavorDot } from '../../ui/FlavorDot';
import { Money } from '../../ui/Money';
import { Button } from '../../ui/Button';
import { Tag } from '../../ui/Tag';
import { showToast } from '../../ui/ToastHost';
import { localPhoneDigits } from '../../domain/phone';

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
  const maxPack = Math.max(1, ...picture.packs.map((row) => row.soldProfit));
  const firstSettled = settled[0];
  return (
    <>
      <p class="decision-lead" data-testid="insights-today" data-revenue={todayRevenue} data-joints={joints}>
        {sentence}
      </p>

      <section class="decision" aria-label="What should I restock">
        <h2 class="decision__q">What should I restock?</h2>
        {restock.map((row) => (
          <div class={`decision-row${row.urgent ? ' decision-row--urgent' : ''}`} key={row.id}>
            <FlavorDot color={row.color} />
            <div class="decision-row__main">
              <div class="v-list-row__title">{row.line}</div>
              <div class="v-list-row__meta">{row.stock} on hand · {row.sold} sold in this cycle</div>
            </div>
            {row.urgent ? <Tag tone="out">Before next cycle</Tag> : null}
          </div>
        ))}
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
        <div class="decision-figures">
          <div>
            <div class="v-stat__label">You keep</div>
            <Money value={picture.owner} />
          </div>
          <div>
            <div class="v-stat__label">Helper {Math.round(picture.helperShare * 100)}%</div>
            <Money value={picture.helper} />
          </div>
          <div>
            <div class="v-stat__label">Cookie partner</div>
            <Money value={picture.partner} />
          </div>
        </div>
        <div class="v-bars" data-testid="insights-rank">
          {picture.packs.map((row: PackLine) => (
            <div class="v-bars__row" key={row.id}>
              <span class="v-bars__label">{row.name}</span>
              <span class="v-bars__track">
                <span style={{ width: `${(row.soldProfit / maxPack) * 100}%` }} />
              </span>
              <span class="v-bars__val">{formatUGX(row.unitProfit)}</span>
            </div>
          ))}
        </div>
        <p class="decision__why">{packSentence}</p>
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
