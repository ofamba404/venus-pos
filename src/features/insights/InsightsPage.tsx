import { useEffect, useMemo, useState } from 'preact/hooks';
import { clients, ensureInventory, inventory, loadClients, loadSales, sales } from '../../data/entities';
import { computeTodayStats } from '../../domain/today';
import { expandPartnerUnitsFromSales, partnerBoard } from '../../domain/partner';
import { fetchCookiePartnerSettle } from '../../data/writes/partner';
import { fetchCreditPayments } from '../../data/credit-payments';
import { collectedIn, collectedPhrase, creditBook, type CreditPayment } from '../../domain/credit-book';
import { moneyChart } from '../../domain/money-chart';
import { CHART_RANGES, filterSalesByRange } from '../../domain/analytics/periods';
import { readStoredId } from '../../domain/parity';
import { historyOrDefault } from '../../domain/insights-view';
import type { JointCostRow } from '../../domain/joint-cost';
import { sbFetch } from '../../data/api';
import { fetchStaffSettlements } from '../../data/commission';
import { commissionLedger, type Settlement } from '../../domain/commission';
import { KEYS } from '../../data/keys';
import { helperSince, setHelperSince } from '../../data/helper-since';
import { Button } from '../../ui/Button';
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

export function InsightsPage() {
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
