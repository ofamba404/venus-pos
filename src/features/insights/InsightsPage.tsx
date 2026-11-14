import { useEffect, useMemo, useState } from 'preact/hooks';
import { clients, ensureInventory, inventory, loadClients, loadSales, sales } from '../../data/entities';
import { computeTodayStats, todayUnitMeta } from '../../domain/today';
import { expandPartnerUnitsFromSales, partnerBoard } from '../../domain/partner';
import { fetchCookiePartnerSettle } from '../../data/writes/partner';
import { fetchCreditPayments } from '../../data/credit-payments';
import { collectedIn, collectedPhrase, creditBook, type CreditPayment } from '../../domain/credit-book';
import { moneyChart } from '../../domain/money-chart';
import { CHART_RANGES, filterSalesByRange } from '../../domain/analytics/periods';
import { readStoredId } from '../../domain/parity';
import { historyOrDefault } from '../../domain/insights-view';
import type { JointCostRow } from '../../domain/joint-cost';
import { isAdmin, authUserId } from '../../data/auth';
import { sbFetch } from '../../data/api';
import { fetchStaffSettlements, fetchMyCommissionSummary, type StaffCommissionSummary } from '../../data/commission';
import { commissionLedger, type Settlement } from '../../domain/commission';
import { KEYS } from '../../data/keys';
import { helperSince, setHelperSince } from '../../data/helper-since';
import { Button } from '../../ui/Button';
import { Money } from '../../ui/Money';
import { showToast } from '../../ui/ToastHost';
import {
  packDriverSentence,
  periodSentence,
  profitPicture,
  restockListText,
  restockPlan,
  type DecisionSale,
} from '../../domain/decisions';
import { InsightsDecisions } from './InsightsDecisions';


function ownSales() {
  const id = authUserId();
  return sales.value.filter((s) => String(s.seller_id || '') === id);
}

function StaffInsights() {
  const [summary, setSummary] = useState<StaffCommissionSummary | null | undefined>(undefined);

  useEffect(() => {
    void loadSales().catch((e) => showToast(e instanceof Error ? e.message : 'Could not load insights'));
    void fetchMyCommissionSummary().then(setSummary);
  }, []);

  const today = useMemo(
    () => computeTodayStats(ownSales() as Parameters<typeof computeTodayStats>[0]),
    [sales.value],
  );

  return (
    <section class="insights" data-testid="staff-insights">
      <h1 class="page-title">Insights</h1>
      <div class="staff-insights__today" data-testid="insights-today" data-revenue={today.revenue}>
        <span class="today-pill__kicker">Today</span>
        <span class="today-pill__value">
          <Money value={today.revenue} />
        </span>
        <span class="today-pill__meta">{todayUnitMeta(today)}</span>
      </div>
      <section class="decision" aria-label="Commission" data-testid="insights-commission">
        <h2 class="decision__q">Commission</h2>
        {summary === undefined ? (
          <p class="v-muted">Loading…</p>
        ) : summary ? (
          <div class="staff-insights__ledger">
            <div class="staff-insights__row" data-testid="commission-earned" data-value={summary.earned_all}>
              <span class="staff-insights__label">Earned</span>
              <Money value={Number(summary.earned_all) || 0} />
            </div>
            <div class="staff-insights__row" data-testid="commission-paid" data-value={summary.paid_all}>
              <span class="staff-insights__label">Paid</span>
              <Money value={Number(summary.paid_all) || 0} />
            </div>
            <div class="staff-insights__row" data-testid="commission-pending" data-value={summary.pending_credit}>
              <span class="staff-insights__label">Pending</span>
              <Money value={Number(summary.pending_credit) || 0} />
            </div>
          </div>
        ) : (
          <p class="v-muted" data-testid="commission-unavailable">
            Commission is not available.
          </p>
        )}
      </section>
    </section>
  );
}

function OwnerInsights() {
  const [rangeId, setRangeId] = useState(() =>
    readStoredId(
      localStorage.getItem(KEYS.chartRange),
      CHART_RANGES.map((row) => row.id),
      '1w',
    ),
  );
  const [serverSettle, setServerSettle] = useState<{ qty: number; batches: number[] } | null>(null);
  const [payments, setPayments] = useState<CreditPayment[] | null>(null);
  const [costHistory, setCostHistory] = useState<JointCostRow[]>([]);
  // undefined: still loading. null: could not be read, so no owed figure is shown.
  const [settlements, setSettlements] = useState<Settlement[] | null | undefined>(undefined);

  useEffect(() => {
    void Promise.all([loadSales(), loadClients(), ensureInventory()]).catch((e) =>
      showToast(e instanceof Error ? e.message : 'Could not load insights'),
    );
    void fetchCookiePartnerSettle().then((state) => {
      if (state) setServerSettle(state);
    });
    void fetchStaffSettlements().then(setSettlements);
    void fetchCreditPayments().then(setPayments);
    void sbFetch('joint_cost_history?select=category_id,cost_ugx,effective_from')
      .then(async (res) => {
        if (!res.ok) return;
        const rows = (await res.json()) as JointCostRow[];
        if (Array.isArray(rows) && rows.length) setCostHistory(rows);
      })
      .catch(() => {});
  }, []);

  const range = CHART_RANGES.find((row) => row.id === rangeId) || CHART_RANGES[0]!;
  const today = useMemo(
    () => computeTodayStats(sales.value as Parameters<typeof computeTodayStats>[0]),
    [sales.value],
  );
  // The helper's start day changes every helper figure below, so each one depends on it.
  const since = helperSince.value;
  const history = historyOrDefault(costHistory);
  const book = sales.value as DecisionSale[];
  const ranged = useMemo(
    () => filterSalesByRange(book, range) as DecisionSale[],
    [book, range],
  );
  const picture = useMemo(() => profitPicture(ranged, history), [ranged, history, since]);
  const ledger = useMemo(
    () => (settlements === undefined || settlements === null ? null : commissionLedger(book, history, settlements)),
    [book, history, settlements, since],
  );
  const sentence = useMemo(() => periodSentence(book, range, history).text, [book, range, history, since]);
  const restock = useMemo(() => restockPlan(book, inventory.value), [book, inventory.value]);
  const credit = useMemo(() => creditBook(book, clients.value), [book, clients.value]);
  const collected = useMemo(() => (payments === null ? null : collectedIn(payments, range, new Date())), [payments, range]);
  const money = useMemo(() => moneyChart(book, range, history), [book, range, history, since]);

  const partner = useMemo(() => {
    const list = sales.value as Parameters<typeof expandPartnerUnitsFromSales>[0];
    return partnerBoard(expandPartnerUnitsFromSales(list), serverSettle?.qty ?? 0, serverSettle?.batches ?? []);
  }, [sales.value, serverSettle]);
  return (
    <section class="insights">
      <h1 class="page-title">Insights</h1>
      <div class="v-chip-row" data-testid="chart-range">
        {CHART_RANGES.map((row) => (
          <Button
            key={row.id}
            size="md"
            variant={rangeId === row.id ? 'primary' : 'secondary'}
            onClick={() => {
              localStorage.setItem(KEYS.chartRange, row.id);
              setRangeId(row.id);
            }}
          >
            {row.short}
          </Button>
        ))}
      </div>
      <InsightsDecisions
        sentence={sentence}
        todayRevenue={today.revenue}
        joints={today.joints}
        restock={restock}
        restockText={restockListText(restock)}
        money={money}
        credit={credit}
        collected={collected}
        collectedPhrase={collectedPhrase(range)}
        onCreditChanged={async () => {
          await loadSales({ force: true });
          setPayments(await fetchCreditPayments());
        }}
        picture={picture}
        ledger={ledger}
        ledgerLoading={settlements === undefined}
        helperSince={since}
        onHelperSince={setHelperSince}
        packSentence={packDriverSentence(picture)}
        partnerLoading={!serverSettle}
        openBatch={partner.open}
      />
    </section>
  );
}

export function InsightsPage() {
  return isAdmin() ? <OwnerInsights /> : <StaffInsights />;
}
