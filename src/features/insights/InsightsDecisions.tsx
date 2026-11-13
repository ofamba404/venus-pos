import type { PackLine, ProfitPicture, RestockRow } from '../../domain/decisions';
import type { CreditBook } from '../../domain/credit-book';
import type { MoneyChart as MoneyChartData } from '../../domain/money-chart';
import type { PartnerBatch } from '../../domain/partner';
import type { CommissionLedger } from '../../domain/commission';
import { formatUGX } from '../../domain/format';
import { Money } from '../../ui/Money';
import { showToast } from '../../ui/ToastHost';
import { EmptyState } from '../../ui/EmptyState';
import { IconChevronRight } from '../../ui/icons';
import { go } from '../../app/router';
import { PartnerBar } from '../cookie-partner/PartnerBar';
import { MoneyChart } from './MoneyChart';
import { RestockCard } from './RestockCard';
import { CreditCard } from './CreditCard';

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
  money,
  credit,
  collected,
  collectedPhrase,
  onCreditChanged,
  picture,
  ledger,
  ledgerLoading,
  helperSince,
  onHelperSince,
  packSentence,
  partnerLoading,
  openBatch,
}: {
  sentence: string;
  todayRevenue: number;
  joints: number;
  restock: RestockRow[];
  restockText: string;
  money: MoneyChartData;
  credit: CreditBook;
  collected: number | null;
  collectedPhrase: string;
  onCreditChanged: () => void | Promise<void>;
  picture: ProfitPicture;
  ledger: CommissionLedger | null;
  ledgerLoading: boolean;
  /** Day the helper started (YYYY-MM-DD), or null when every day counts. */
  helperSince: string | null;
  onHelperSince: (day: string | null) => void;
  packSentence: string;
  partnerLoading: boolean;
  openBatch: PartnerBatch | null;
}) {
  const soldPacks = picture.packs.filter((row) => row.soldProfit > 0);
  const maxPack = Math.max(1, ...soldPacks.map((row) => row.soldProfit));
  return (
    <>
      <p class="decision-lead" data-testid="insights-today" data-revenue={todayRevenue} data-joints={joints}>
        {sentence}
      </p>

      <MoneyChart chart={money} />

      <RestockCard rows={restock} text={restockText} onCopy={(text) => copyText(text, 'Restock list copied')} />

      <CreditCard book={credit} collected={collected} phrase={collectedPhrase} onSettled={onCreditChanged} />

      <section class="decision" aria-label="Which packs earn most">
        <h2 class="decision__q">Which packs earn most?</h2>
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
          <label class="owe__since" data-testid="helper-since">
            <span class="owe__since-label">{helperSince ? 'Helper started' : 'Helper started on'}</span>
            <input
              type="date"
              class="owe__since-input"
              data-testid="helper-since-input"
              value={helperSince || ''}
              max={new Date().toISOString().slice(0, 10)}
              onChange={(e) => onHelperSince((e.target as HTMLInputElement).value || null)}
            />
            {helperSince ? (
              <button type="button" class="owe__since-clear" data-testid="helper-since-clear" onClick={() => onHelperSince(null)}>
                Clear
              </button>
            ) : null}
          </label>
          {helperSince ? null : (
            <p class="decision__why" data-testid="helper-since-hint">
              Sales do not record who made them. Set the day your helper started and nothing counts for them before it.
            </p>
          )}
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
