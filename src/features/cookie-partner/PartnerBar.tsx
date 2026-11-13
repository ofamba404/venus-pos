import './cookie-partner.css';
import { COOKIE_PARTNER_SETTLE_EVERY } from '../../domain/catalog';

export function PartnerBar({ count, every = COOKIE_PARTNER_SETTLE_EVERY }: { count: number; every?: number }) {
  const on = Math.min(every, Math.max(0, count));
  return (
    <div
      class="cp-bar"
      role="progressbar"
      aria-label="Cookies in this batch"
      aria-valuemin={0}
      aria-valuemax={every}
      aria-valuenow={on}
      data-testid="partner-progress"
    >
      {Array.from({ length: every }, (_, i) => (
        <span key={i} class={`cp-bar__seg${i < on ? ' is-on' : ''}`} />
      ))}
    </div>
  );
}
