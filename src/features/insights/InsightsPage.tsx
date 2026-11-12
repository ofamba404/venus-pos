import { useEffect, useMemo, useState } from 'preact/hooks';
import { clients, ensureInventory, inventory, loadClients, loadSales, sales } from '../../data/entities';
import { computeTodayStats } from '../../domain/today';
import { sumCreditOwed, getOutstandingCredit } from '../../domain/credit';
import { cookieBatchShareText, expandPartnerUnitsFromSales, partnerBoard, proposeSettle } from '../../domain/partner';
import { fetchCookiePartnerSettle, postCookiePartnerSettle } from '../../data/writes/partner';
import { CHART_RANGES, filterSalesByRange } from '../../domain/analytics/periods';
import { readStoredId } from '../../domain/parity';
import { historyOrDefault } from '../../domain/insights-view';
import type { JointCostRow } from '../../domain/joint-cost';
import { sbFetch } from '../../data/api';
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

  useEffect(() => {
    void Promise.all([loadSales(), loadClients(), ensureInventory()]).catch((e) =>
      showToast(e instanceof Error ? e.message : 'Could not load insights'),
    );
    void fetchCookiePartnerSettle().then((state) => {
      if (state) setServerSettle(state);
    });
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
  const sentence = useMemo(() => periodSentence(book, range, history).text, [book, range, history]);
  const restock = useMemo(() => restockPlan(book, inventory.value), [book, inventory.value]);
  const chase = useMemo(() => creditChase(book, clients.value), [book, clients.value]);
  const owed = useMemo(() => sumCreditOwed(getOutstandingCredit(sales.value)), [sales.value]);

  const partner = useMemo(() => {
    const list = sales.value as Parameters<typeof expandPartnerUnitsFromSales>[0];
    return partnerBoard(expandPartnerUnitsFromSales(list), serverSettle?.qty ?? 0, serverSettle?.batches ?? []);
  }, [sales.value, serverSettle]);
  const settledCuts = serverSettle?.batches ?? [];

  async function settleNextBatch() {
    const open = partner.open;
    if (!open || !serverSettle) {
      showToast('No batch to settle');
      return;
    }
    const send = open.complete ? open.every : open.cookieCount;
    const proposed = proposeSettle(serverSettle.qty, serverSettle.batches, send);
    if (!proposed) {
      showToast('Already settled');
      return;
    }
    let res: Response;
    try {
      res = await postCookiePartnerSettle(proposed.qty, proposed.batches, serverSettle.qty);
    } catch {
      showToast('Could not reach the server. Batch not marked sent.');
      return;
    }
    if (!res.ok) {
      showToast('Server refused the settlement. Batch not marked sent.');
      return;
    }
    const data = (await res.json().catch(() => null)) as { ok?: boolean; settled_qty?: number; batches?: number[] } | null;
    if (!data?.ok || data.settled_qty === undefined || data.settled_qty === null || data.settled_qty < proposed.qty) {
      if (data?.settled_qty !== undefined && data?.settled_qty !== null) {
        setServerSettle({
          qty: data.settled_qty,
          batches: Array.isArray(data.batches) ? data.batches : serverSettle.batches,
        });
      }
      showToast('Server kept the earlier total. Batch not marked sent.');
      return;
    }
    const next = {
      qty: data.settled_qty,
      batches: Array.isArray(data.batches) ? data.batches : proposed.batches,
    };
    setServerSettle(next);
    try {
      localStorage.setItem(KEYS.partnerSettled, String(next.qty));
    } catch {
      /* private mode */
    }
    const text = cookieBatchShareText(open);
    void navigator.clipboard?.writeText(text).then(
      () => showToast('Batch settled'),
      () => showToast(text),
    );
  }

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
        packSentence={packDriverSentence(picture)}
        partnerQty={serverSettle ? serverSettle.qty : null}
        partnerLoading={!serverSettle}
        settled={
          settledCuts.length
            ? settledCuts.map((count, index) => ({ index: index + 1, cookieCount: count, every: 25 }))
            : partner.settled
        }
        openBatch={partner.open}
        onSettle={() => void settleNextBatch()}
      />
    </section>
  );
}
