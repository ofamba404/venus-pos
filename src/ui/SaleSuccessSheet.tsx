import { useEffect, useRef, useState } from 'preact/hooks';
import { formatUGX } from '../domain/format';
import { go, routeId } from '../app/router';
import { burstConfetti, clearConfetti } from './confetti';
import { dismissSaleSuccess, saleSuccess, type SaleSuccess } from './sale-success';

const EXIT_MS = 220;

function reducedMotion(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

/**
 * What the cashier sees after a sale. It is the storefront's "Order placed" modal, in the POS's words: a centred
 * card over a 50% scrim with an ink ring that draws, a check that draws after it, a pop and a small paper-confetti
 * bloom, then the title, the client and the amount easing in one after another. Done closes it and leaves them where
 * they were. Log another sale goes to the counter. The close button, a tap on the scrim, Escape and a swipe down close it
 * as well, so it never holds the screen.
 */
export function SaleSuccessSheet() {
  const info = saleSuccess.value;
  const last = useRef<SaleSuccess | null>(null);
  if (info) last.current = info;
  const [mounted, setMounted] = useState(info != null);
  const [closing, setClosing] = useState(false);
  const overlay = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const mark = useRef<HTMLDivElement>(null);
  const ring = useRef<SVGCircleElement>(null);
  const check = useRef<SVGPathElement>(null);
  const bits = useRef<HTMLDivElement>(null);
  const swiped = useRef(false);

  if (info && !mounted) setMounted(true);

  // Close: fade out, then unmount.
  useEffect(() => {
    if (info) {
      setClosing(false);
      swiped.current = false;
      return;
    }
    if (!mounted) return;
    clearConfetti();
    if (reducedMotion() || swiped.current) {
      setMounted(false);
      return;
    }
    setClosing(true);
    const timer = window.setTimeout(() => {
      setMounted(false);
      setClosing(false);
    }, EXIT_MS);
    return () => window.clearTimeout(timer);
  }, [info == null, mounted]);

  // Open: the store's timeline. Overlay 0.3s, panel 0.42s, content staggered, ring then check drawn, pop, confetti.
  useEffect(() => {
    if (!info || !mounted) return;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') dismissSaleSuccess();
    };
    window.addEventListener('keydown', onKey);
    const anims: Animation[] = [];
    let confettiTimer = 0;
    if (!reducedMotion() && panel.current && overlay.current && mark.current && ring.current && check.current) {
      const run = (el: Element, frames: Keyframe[], options: KeyframeAnimationOptions) => {
        anims.push(el.animate(frames, { fill: 'both', ...options }));
      };
      const power3 = 'cubic-bezier(0.215, 0.61, 0.355, 1)';
      const power2 = 'cubic-bezier(0.25, 0.46, 0.45, 0.94)';
      run(overlay.current, [{ opacity: 0 }, { opacity: 1 }], { duration: 300, easing: 'cubic-bezier(0.39, 0.575, 0.565, 1)' });
      run(panel.current, [{ opacity: 0, transform: 'scale(0.97) translateY(14px)' }, { opacity: 1, transform: 'none' }], {
        duration: 420,
        delay: 40,
        easing: power3,
      });
      Array.from(bits.current?.children || []).forEach((el, i) => {
        run(el, [{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }], {
          duration: 400,
          delay: 120 + i * 60,
          easing: power2,
        });
      });
      const ringLen = ring.current.getTotalLength?.() || 157;
      const checkLen = check.current.getTotalLength?.() || 36;
      ring.current.style.strokeDasharray = String(ringLen);
      check.current.style.strokeDasharray = String(checkLen);
      run(ring.current, [{ strokeDashoffset: ringLen }, { strokeDashoffset: 0 }], { duration: 620, delay: 180, easing: power2 });
      run(check.current, [{ strokeDashoffset: checkLen }, { strokeDashoffset: 0 }], { duration: 500, delay: 520, easing: power2 });
      // Entrance, wind-up, pop and settle: 0.82 -> 1, then 0.9, 1.18, 1.
      run(
        mark.current,
        [
          { transform: 'scale(0.82)', offset: 0 },
          { transform: 'scale(1)', offset: 0.28, easing: power2 },
          { transform: 'scale(1)', offset: 0.5 },
          { transform: 'scale(0.9)', offset: 0.6, easing: power2 },
          { transform: 'scale(1.18)', offset: 0.76, easing: power2 },
          { transform: 'scale(1)', offset: 1 },
        ],
        { duration: 1400, delay: 160 },
      );
      // Confetti fires at the scale peak.
      confettiTimer = window.setTimeout(() => burstConfetti(mark.current), 160 + 1400 * 0.76);
    }
    return () => {
      window.removeEventListener('keydown', onKey);
      window.clearTimeout(confettiTimer);
      document.body.style.overflow = '';
      anims.forEach((a) => a.cancel());
    };
  }, [info?.id, mounted]);

  /** Drag the card down with a finger to dismiss it. */
  function startSwipe(e: PointerEvent) {
    const el = panel.current;
    if (!el || e.button > 0) return;
    const startY = e.clientY;
    const startAt = performance.now();
    let dy = 0;
    let dragging = false;
    const move = (ev: PointerEvent) => {
      dy = Math.max(0, ev.clientY - startY);
      if (!dragging && dy > 8) {
        dragging = true;
        el.getAnimations().forEach((a) => a.cancel());
        el.style.transition = 'none';
        el.setPointerCapture?.(ev.pointerId);
      }
      if (dragging) el.style.transform = `translateY(${dy}px)`;
    };
    const end = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', end);
      el.removeEventListener('pointercancel', end);
      if (!dragging) return;
      const speed = dy / Math.max(1, performance.now() - startAt);
      const far = dy > 100 || (speed > 0.6 && dy > 24);
      el.style.transition = 'transform 180ms ease-out, opacity 180ms ease-out';
      if (far) {
        swiped.current = true;
        el.style.transform = 'translateY(60vh)';
        el.style.opacity = '0';
        window.setTimeout(dismissSaleSuccess, reducedMotion() ? 0 : 160);
      } else {
        el.style.transform = 'translateY(0)';
        window.setTimeout(() => {
          el.style.transition = '';
          el.style.transform = '';
        }, 190);
      }
      const swallow = (ev: Event) => {
        ev.stopPropagation();
        ev.preventDefault();
      };
      el.addEventListener('click', swallow, { capture: true, once: true });
      window.setTimeout(() => el.removeEventListener('click', swallow, true), 0);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
  }

  const view = info || last.current;
  if (!mounted || !view) return null;
  const title = view.credit ? 'Recorded on credit' : view.queued ? 'Saved on this phone' : 'Sale recorded';
  const hint = view.queued
    ? 'It will sync when the signal returns.'
    : view.savingDelivery
      ? 'Saving delivery…'
      : view.credit
        ? 'Added to the client’s balance.'
        : '';

  return (
    <div class={`v-ok${closing ? ' is-closing' : ''}`} role="dialog" aria-modal="true" aria-label="Sale">
      <div class="v-ok__overlay" ref={overlay} onClick={dismissSaleSuccess} />
      <div class="v-ok__center" onClick={(e) => { if (e.target === e.currentTarget) dismissSaleSuccess(); }}>
        <div class="v-ok__panel" ref={panel} onPointerDown={(e) => {
          if ((e.target as HTMLElement).closest('button')) return;
          startSwipe(e as unknown as PointerEvent);
        }}>
          <div class="v-ok__body" data-testid="sale-success">
            <div class="v-ok__header">
              <div class="v-ok__heading">
                <div class="v-ok__mark" ref={mark} aria-hidden="true">
                  <svg class="v-ok__mark-svg" viewBox="0 0 52 52" fill="none">
                    <circle class="v-ok__mark-ring" ref={ring} cx="26" cy="26" r="25" />
                    <path class="v-ok__mark-check" ref={check} d="M14.1 27.2 21.2 34.4 37.9 17.6" />
                  </svg>
                </div>
                <h2 class="v-ok__title" data-testid="success-label">
                  {title}
                </h2>
              </div>
              <button type="button" class="v-ok__close" aria-label="Close" onClick={dismissSaleSuccess}>
                <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true">
                  <path d="M6 6l12 12M18 6 6 18" />
                </svg>
              </button>
            </div>
            <div class="v-ok__bits" ref={bits}>
              <p class="v-ok__status">
                <strong>Client</strong>
                <span data-testid="success-client">{view.client}</span>
              </p>
              <div class="v-ok__amount-block">
                <p class="v-ok__label">Amount</p>
                <p class="v-ok__amount" data-testid="success-total">
                  {formatUGX(view.total)}
                </p>
                {hint ? <p class="v-ok__hint">{hint}</p> : null}
              </div>
            </div>
            <div class="v-ok__actions">
              <button type="button" class="v-ok__btn v-ok__btn--primary" data-testid="success-done" onClick={dismissSaleSuccess}>
                Done
              </button>
              <button
                type="button"
                class="v-ok__btn"
                data-testid="success-another"
                onClick={() => {
                  dismissSaleSuccess();
                  if (routeId.value !== 'sell') go('/sell');
                }}
              >
                Log another sale
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
