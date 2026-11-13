import type { ChaseRow, PackLine, ProfitPicture, RestockRow } from '../../domain/decisions';
import type { PartnerBatch } from '../../domain/partner';
import type { CommissionLedger } from '../../domain/commission';
import { ECONOMICS } from '../../domain/economics';
import { formatUGX } from '../../domain/format';
import { FlavorDot } from '../../ui/FlavorDot';
import { Money } from '../../ui/Money';
import { Button } from '../../ui/Button';
import { showToast } from '../../ui/ToastHost';
import { localPhoneDigits } from '../../domain/phone';
import { EmptyState } from '../../ui/EmptyState';
import { IconChevronRight } from '../../ui/icons';
import { go } from '../../app/router';
import { PartnerBar } from '../cookie-partner/PartnerBar';

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
  ledger,
  ledgerLoading,
  packSentence,
  partnerLoading,
  openBatch,
}: {
  sentence: string;
  todayRevenue: number;
  joints: number;
  restock: RestockRow[];
  restockText: string;
  chase: ChaseRow[];
  owed: number;
  picture: ProfitPicture;
  ledger: CommissionLedger | null;
  ledgerLoading: boolean;
  packSentence: string;
  partnerLoading: boolean;
  openBatch: PartnerBatch | null;
}) {
  const selling = restock.filter((row) => row.sold > 0);
  const quiet = restock.length - selling.length;
  const horizon = ECONOMICS.restockCycleDays * 2;
  const soldPacks = picture.packs.filter((row) => row.soldProfit > 0);
  const maxPack = Math.max(1, ...soldPacks.map((row) => row.soldProfit));
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
              <div class="decision-row__actions">
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
        <div class="owe" data-testid="commission-ledger">
          <div class="owe__head">
            <div>
              <div class="v-list-row__title">Helper</div>
              <div class="v-list-row__meta">
                {Math.round(picture.helperShare * 100)}% of profit, an estimate
              </div>
            </div>
            <div class="owe__now" data-testid="commission-owed" data-value={ledger ? ledger.owed : ''}>
              {ledger ? <Money value={ledger.owed} /> : <span class="v-muted">{ledgerLoading ? 'Loading…' : 'Payouts unavailable'}</span>}
              {ledger ? <span class="owe__now-label">owed now</span> : null}
            </div>
          </div>
          {ledger ? (
            <div class="owe__sum">
              <div class="owe__chip" data-testid="commission-earned" data-value={ledger.earned}>
                <span class="owe__chip-label">Earned</span>
                <Money value={ledger.earned} />
              </div>
              <div class="owe__chip owe__chip--paid" data-testid="commission-paid" data-value={ledger.paid}>
                <span class="owe__chip-label">Paid</span>
                <Money value={ledger.paid} />
              </div>
            </div>
          ) : null}
          {ledger ? (
            <p class="decision__why" data-testid="commission-note">
              {ledger.ahead > 0
                ? `Paid is ${formatUGX(ledger.ahead)} ahead of the estimate. Nothing owed.`
                : ledger.lastPaid
                  ? `Last payout ${formatUGX(ledger.lastPaid.amount)} on ${new Date(ledger.lastPaid.at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}.`
                  : 'No payouts recorded yet.'}
              {' '}This period: <Money value={picture.helper} />.
            </p>
          ) : null}
        </div>
        <button type="button" class="cp-tile" data-testid="partner-summary" onClick={() => go('/cookie-partner')}>
          <span class="cp-tile__main">
            <span class="v-list-row__title">Cookie partner</span>
            <span class="v-list-row__meta">
              {partnerLoading
                ? 'Loading…'
                : openBatch
                  ? `${openBatch.cookieCount} of ${openBatch.every} in this batch · ${openBatch.complete ? 'ready to send' : 'part batch'}`
                  : 'Nothing open'}
            </span>
            <PartnerBar count={openBatch ? openBatch.cookieCount : 0} />
          </span>
          {openBatch ? <Money value={openBatch.partnerDue} /> : null}
          <span class="v-list-row__chevron" aria-hidden="true">
            <IconChevronRight size={18} />
          </span>
        </button>
      </section>
    </>
  );
}
