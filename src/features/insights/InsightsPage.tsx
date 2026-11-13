import { useEffect, useMemo, useState } from 'preact/hooks';
import { clients, ensureInventory, inventory, loadClients, loadSales, sales } from '../../data/entities';
import { computeTodayStats } from '../../domain/today';
import { sumCreditOwed, getOutstandingCredit } from '../../domain/credit';
import { expandPartnerUnitsFromSales, partnerBoard } from '../../domain/partner';
import { fetchCookiePartnerSettle } from '../../data/writes/partner';
import { CHART_RANGES, filterSalesByRange } from '../../domain/analytics/periods';
import { readStoredId } from '../../domain/parity';
import { historyOrDefault } from '../../domain/insights-view';
import type { JointCostRow } from '../../domain/joint-cost';
import { sbFetch } from '../../data/api';
import { fetchStaffSettlements } from '../../data/commission';
import { commissionLedger, type Settlement } from '../../domain/commission';
import { KEYS } from '../../data/keys';
import { Button } from '../../ui/Button';
import { showToast } from '../../ui/ToastHost';
import {
  creditChase,
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
  const history = historyOrDefault(costHistory);
  const book = sales.value as DecisionSale[];
  const ranged = useMemo(
    () => filterSalesByRange(book, range) as DecisionSale[],
    [book, range],
  );
  const picture = useMemo(() => profitPicture(ranged, history), [ranged, history]);
  const ledger = useMemo(
    () => (settlements === undefined || settlements === null ? null : commissionLedger(book, history, settlements)),
    [book, history, settlements],
  );
  const sentence = useMemo(() => periodSentence(book, range, history).text, [book, range, history]);
  const restock = useMemo(() => restockPlan(book, inventory.value), [book, inventory.value]);
  const chase = useMemo(() => creditChase(book, clients.value), [book, clients.value]);
  const owed = useMemo(() => sumCreditOwed(getOutstandingCredit(sales.value)), [sales.value]);

  const partner = useMemo(() => {
    const list = sales.value as Parameters<typeof expandPartnerUnitsFromSales>[0];
    return partnerBoard(expandPartnerUnitsFromSales(list), serverSettle?.qty ?? 0, serverSettle?.batches ?? []);
  }, [sales.value, serverSettle]);
  return (
    <section>
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
        chase={chase}
        owed={owed}
        picture={picture}
        ledger={ledger}
        ledgerLoading={settlements === undefined}
        packSentence={packDriverSentence(picture)}
        partnerLoading={!serverSettle}
        openBatch={partner.open}
      />
    </section>
  );
}
