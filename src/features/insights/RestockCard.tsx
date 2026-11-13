import { useState } from 'preact/hooks';
import './insights.css';
import { ECONOMICS } from '../../domain/economics';
import { daysLeftLabel, restockSummary } from '../../domain/restock-summary';
import { restockVerb, type RestockRow } from '../../domain/decisions-book';
import { FlavorDot } from '../../ui/FlavorDot';
import { Collapse } from '../../ui/Collapse';
import { Button } from '../../ui/Button';
import { IconChevronRight } from '../../ui/icons';

function fillOf(color: string) {
  const c = color.toLowerCase();
  return c === '#ffffff' || c === '#fff' ? 'var(--plain)' : color;
}

/** Answers "what should I restock?" first, then lists only what needs ordering. */
export function RestockCard({
  rows,
  text,
  onCopy,
}: {
  rows: RestockRow[];
  text: string;
  onCopy: (text: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const s = restockSummary(rows);
  const horizon = ECONOMICS.restockCycleDays;
  const hasMore = s.fine.length > 0 || s.idle.length > 0;
  return (
    <section
      class="decision restock"
      aria-label="What should I restock"
      data-testid="insights-restock"
    >
      <h2 class="decision__q" data-testid="restock-headline" data-count={s.order.length}>
        {s.headline}
      </h2>
      {s.order.map((row) => {
        const days = row.daysLeft === null ? horizon : row.daysLeft;
        const width = row.stock <= 0 ? 0 : Math.max(4, Math.min(100, (days / horizon) * 100));
        return (
          <div class="restock__row" key={row.id} data-testid={`restock-row-${row.id}`}>
            <div class="restock__top">
              <span class="restock__name">
                <FlavorDot color={row.color} />
                {row.name}
              </span>
              <span class="restock__qty" data-testid={`restock-qty-${row.id}`}>
                {restockVerb(row)} {row.orderQty}
              </span>
            </div>
            <div class="restock__bar">
              <span class="restock__track" aria-hidden="true">
                <span
                  class="restock__fill"
                  style={{ width: `${width}%`, background: fillOf(row.color) }}
                />
              </span>
              <span class="restock__days">{daysLeftLabel(row)}</span>
            </div>
          </div>
        );
      })}
      {s.order.length ? (
        <p class="restock__key" data-testid="restock-key">
          Each bar is the days of stock left. A full bar is the {Math.round(horizon / 7)}-week
          restock cycle.
        </p>
      ) : null}
      {hasMore ? (
        <div class="restock__fold">
          <button
            type="button"
            class="restock__toggle"
            aria-expanded={open}
            data-testid="restock-fine-toggle"
            onClick={() => setOpen(!open)}
          >
            <span data-testid="restock-fine-line">
              {s.fineLine || `${s.idle.length} out and not selling`}
            </span>
            <span class={`restock__chev${open ? ' is-open' : ''}`} aria-hidden="true">
              <IconChevronRight size={18} />
            </span>
          </button>
          <Collapse open={open}>
            <div class="restock__more" data-testid="restock-fine-list">
              {s.fine.map((row) => (
                <div class="restock__fine" key={row.id}>
                  <span class="restock__name">
                    <FlavorDot color={row.color} />
                    {row.name}
                  </span>
                  <span class="restock__days">{daysLeftLabel(row)}</span>
                </div>
              ))}
              {s.idle.map((row) => (
                <div class="restock__fine" key={row.id}>
                  <span class="restock__name">
                    <FlavorDot color={row.color} />
                    {row.name}
                  </span>
                  <span class="restock__days">Out, not selling</span>
                </div>
              ))}
            </div>
          </Collapse>
        </div>
      ) : null}
      <Button size="md" variant="secondary" data-testid="copy-restock" onClick={() => onCopy(text)}>
        Copy restock list
      </Button>
    </section>
  );
}
