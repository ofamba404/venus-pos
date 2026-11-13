import './cookie-partner.css';
import { COOKIE_PARTNER_SETTLE_EVERY } from '../../domain/catalog';
import { batchBarSquares } from '../../domain/partner';

/**
 * Batch progress, one square per cookie. With `units` (the batch's cookies) each square wears its flavour's
 * storefront colour, grouped in a fixed order, and a small legend names the colours. Without them it is plain bronze.
 */
export function PartnerBar({
  count,
  units,
  every = COOKIE_PARTNER_SETTLE_EVERY,
}: {
  count: number;
  units?: Array<{ flavorId?: string }>;
  every?: number;
}) {
  const on = Math.min(every, Math.max(0, count));
  const { squares, groups } = batchBarSquares(units, every);
  const coloured = units ? Math.min(squares.length, on) : 0;
  return (
    <div class="cp-bar-wrap">
      <div
        class="cp-bar"
        role="progressbar"
        aria-label="Cookies in this batch"
        aria-valuemin={0}
        aria-valuemax={every}
        aria-valuenow={on}
        data-testid="partner-progress"
      >
        {Array.from({ length: every }, (_, i) => {
          const square = i < coloured ? squares[i] : undefined;
          return (
            <span
              key={i}
              class={`cp-bar__seg${i < on ? ' is-on' : ''}${square ? ' is-flavor' : ''}`}
              style={square ? { '--seg': square.color } : undefined}
              data-flavor={square?.flavorId}
            />
          );
        })}
      </div>
      {coloured > 0 ? (
        <ul class="cp-legend" data-testid="partner-legend" aria-label="Flavours in this batch">
          {groups.map((g) => (
            <li key={g.flavorId} class="cp-legend__item" data-flavor={g.flavorId}>
              <span class="cp-legend__dot" style={{ '--seg': g.color }} />
              {g.count} {g.name.toLowerCase()}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
