import { useEffect, useMemo, useState } from 'preact/hooks';
import './cookie-partner.css';
import { loadSales, sales } from '../../data/entities';
import { fetchCookiePartnerSettle } from '../../data/writes/partner';
import { sendPartnerBatch } from '../../data/partner-send';
import { KEYS } from '../../data/keys';
import { COOKIE_PARTNER_SETTLE_EVERY } from '../../domain/catalog';
import {
  cookieBatchLineTitle,
  cookieBatchShareText,
  cookieFlavorMixPhrase,
  expandPartnerUnitsFromSales,
  partnerBoard,
} from '../../domain/partner';
import {
  partnerConfirmText,
  partnerFailureMessage,
  partnerSendLabel,
  partnerSendPlan,
  settledCutsFor,
} from '../../domain/partner-send';
import { Button } from '../../ui/Button';
import { Money } from '../../ui/Money';
import { Sheet } from '../../ui/Sheet';
import { Tag } from '../../ui/Tag';
import { PartnerBar } from './PartnerBar';
import { showToast } from '../../ui/ToastHost';

type Settle = { qty: number; batches: number[] };

export function CookiePartnerPage() {
  const [settle, setSettle] = useState<Settle | null>(null);
  const [failed, setFailed] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [sending, setSending] = useState(false);
  const [showAll, setShowAll] = useState(false);

  function loadSettle() {
    setFailed(false);
    void fetchCookiePartnerSettle()
      .then((state) => {
        if (state) setSettle(state);
        else setFailed(true);
      })
      .catch(() => setFailed(true));
  }

  useEffect(() => {
    void loadSales().catch((e) => showToast(e instanceof Error ? e.message : 'Could not load sales'));
    loadSettle();
  }, []);

  const units = useMemo(
    () => expandPartnerUnitsFromSales(sales.value as Parameters<typeof expandPartnerUnitsFromSales>[0]),
    [sales.value],
  );
  const qty = settle?.qty ?? 0;
  const cuts = useMemo(() => settledCutsFor(qty, settle?.batches ?? []), [qty, settle]);
  const board = useMemo(() => partnerBoard(units, qty, cuts), [units, qty, cuts]);
  const plan = useMemo(() => (settle ? partnerSendPlan(units, qty, cuts) : null), [settle, units, qty, cuts]);
  const open = board.open;
  const every = COOKIE_PARTNER_SETTLE_EVERY;
  // The server's cuts are the record of what was sent. Money comes from the sales when they cover it.
  const history = cuts
    .map((count, i) => ({
      index: i + 1,
      cookieCount: count,
      every: COOKIE_PARTNER_SETTLE_EVERY,
      complete: count >= COOKIE_PARTNER_SETTLE_EVERY,
      partnerDue: board.settled[i]?.partnerDue ?? null,
    }))
    .reverse();
  const shown = showAll ? history : history.slice(0, 4);

  async function send() {
    if (!plan || !settle || sending) return;
    setSending(true);
    const result = await sendPartnerBatch(plan, settle);
    setSending(false);
    setConfirming(false);
    if (!result.ok) {
      showToast(partnerFailureMessage(result.reason, result.status));
      // A stale card was refreshed from the server: show what it really has.
      if (result.state) setSettle(result.state);
      return;
    }
    setSettle(result.state);
    try {
      localStorage.setItem(KEYS.partnerSettled, String(result.state.qty));
    } catch {
      /* private mode */
    }
    const text = cookieBatchShareText(plan.batch);
    void navigator.clipboard?.writeText(text).then(
      () => showToast('Batch settled'),
      () => showToast(text),
    );
  }

  return (
    <section data-testid="cookie-partner-page">
      <h1 class="page-title">Cookie partner</h1>

      <div class="cp-hero" data-testid="partner-hero">
        <div class="cp-hero__head">
          <div>
            <div class="cp-hero__kicker">{open ? `Batch ${open.index}` : 'Next batch'}</div>
            <div class="cp-hero__count">
              <strong data-testid="partner-open-count">{open ? open.cookieCount : 0}</strong>
              <span>of {every} cookies</span>
            </div>
          </div>
          {plan ? (
            <Tag tone={plan.kind === 'ready' ? 'bronze' : 'bronze-soft'}>
              {plan.kind === 'ready' ? 'Full batch ready' : 'Part batch'}
            </Tag>
          ) : (
            <Tag tone="default">{settle ? 'Nothing open' : 'Loading'}</Tag>
          )}
        </div>
        <PartnerBar count={open ? Math.min(open.cookieCount, every) : 0} />
        {open ? (
          <div class="cp-figures">
            <div class="cp-figure" data-testid="partner-due">
              <span class="cp-figure__label">Send partner</span>
              <Money value={open.partnerDue} />
            </div>
            <div class="cp-figure">
              <span class="cp-figure__label">Your split</span>
              <Money value={open.ownerSplit} />
            </div>
          </div>
        ) : null}
        {plan ? (
          <>
            <Button variant="primary" size="xl" data-testid="partner-settle" onClick={() => setConfirming(true)}>
              {partnerSendLabel(plan)}
            </Button>
            <p class="cp-note" data-testid="partner-note">
              {plan.kind === 'partial'
                ? 'Sends what is in the batch now. The next batch then starts from 0.'
                : plan.queued > 0
                  ? `${plan.queued} more full batch${plan.queued === 1 ? '' : 'es'} stay queued after this one.`
                  : 'A full batch is ready to send.'}
            </p>
          </>
        ) : (
          <p class="cp-note" data-testid="partner-note">
            {failed
              ? 'Could not load what is already settled. Sending is off until it loads.'
              : settle
                ? 'No cookies waiting. The next batch starts with the next cookie sale.'
                : 'Loading settlement…'}
          </p>
        )}
        {failed ? (
          <Button variant="secondary" size="md" onClick={loadSettle}>
            Try again
          </Button>
        ) : null}
      </div>

      {open && open.lines.length ? (
        <>
          <h2 class="cp-section v-section-label">In this batch</h2>
          <div class="cp-lines" data-testid="partner-batch-lines">
            {open.lines.map((row, i) => {
              const mix = row.kind === 'single' ? '' : cookieFlavorMixPhrase(row.flavorCounts);
              return (
                <div class="cp-line" key={i}>
                  <div class="cp-line__main">
                    <div class="cp-line__title">
                      {row.qty} × {cookieBatchLineTitle(row)}
                    </div>
                    {mix ? <div class="cp-line__meta">{mix}</div> : null}
                  </div>
                  <Money value={row.revenue} />
                </div>
              );
            })}
          </div>
        </>
      ) : null}

      <h2 class="cp-section v-section-label">Already sent</h2>
      <p class="cp-note" data-testid="partner-settled-qty">
        {settle ? `${qty} cookies already settled` : failed ? 'Settlement unavailable' : 'Loading settlement…'}
      </p>
      <div data-testid="partner-history">
        {shown.map((batch) => (
          <div class="cp-batch" key={batch.index} data-testid={`partner-batch-${batch.index}`}>
            <div class="cp-batch__main">
              <div class="v-list-row__title">
                Batch {batch.index} · {batch.cookieCount}/{batch.every}
              </div>
              <div class="v-list-row__meta">Sent</div>
            </div>
            <div class="cp-batch__end">
              {batch.partnerDue === null ? null : <Money value={batch.partnerDue} />}
              {batch.complete ? null : <Tag tone="bronze-soft">Part batch</Tag>}
            </div>
          </div>
        ))}
        {!history.length && settle ? <p class="v-muted">No batches sent yet</p> : null}
      </div>
      {history.length > 4 ? (
        <Button variant="secondary" size="md" data-testid="partner-history-more" onClick={() => setShowAll(!showAll)}>
          {showAll ? 'Show fewer' : `Show all ${history.length}`}
        </Button>
      ) : null}

      <Sheet
        open={confirming && !!plan}
        title={plan?.kind === 'partial' ? 'Send part batch?' : 'Send this batch?'}
        onClose={() => setConfirming(false)}
        footer={
          <div class="edit-picker__foot">
            <Button variant="secondary" size="xl" data-testid="partner-confirm-cancel" onClick={() => setConfirming(false)}>
              Not yet
            </Button>
            <Button variant="primary" size="xl" data-testid="partner-confirm-send" disabled={sending} onClick={() => void send()}>
              {sending ? 'Sending…' : 'Mark sent'}
            </Button>
          </div>
        }
      >
        {plan ? (
          <div class="cp-confirm" data-testid="partner-confirm">
            <p>{partnerConfirmText(plan)}</p>
            <p class="cp-note">The partner total only ever goes up. If anything fails, nothing is marked sent.</p>
          </div>
        ) : null}
      </Sheet>
    </section>
  );
}
