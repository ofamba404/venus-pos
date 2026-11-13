/**
 * A small paper-confetti bloom from an element's centre, after the storefront's order-placed modal: about twenty
 * ribbons and dots drift outward and fade. It draws on its own canvas and cleans up. Nothing happens under reduced motion.
 */
const COLORS = ['#ff6b6b', '#ffd166', '#06d6a0', '#4cc9f0', '#7b2cbf', '#f72585', '#fb8500', '#118ab2'];

type Bit = { x: number; y: number; vx: number; vy: number; w: number; h: number; round: boolean; color: string; angle: number; spin: number };

let cancel: (() => void) | null = null;

export function burstConfetti(anchor: Element | null) {
  clearConfetti();
  if (!anchor || typeof document === 'undefined') return;
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
  const rect = anchor.getBoundingClientRect();
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const canvas = document.createElement('canvas');
  canvas.width = window.innerWidth * dpr;
  canvas.height = window.innerHeight * dpr;
  canvas.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:120';
  canvas.setAttribute('aria-hidden', 'true');
  document.body.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    canvas.remove();
    return;
  }
  ctx.scale(dpr, dpr);
  const ox = rect.left + rect.width / 2;
  const oy = rect.top + rect.height / 2;
  const make = (count: number, speed: number, scale: number): Bit[] =>
    Array.from({ length: count }, () => {
      const a = Math.random() * Math.PI * 2;
      const v = speed * (0.5 + Math.random());
      const ribbon = Math.random() < 0.6;
      return {
        x: ox,
        y: oy,
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v,
        w: (ribbon ? 4 : 6) * scale,
        h: (ribbon ? 10 : 6) * scale,
        round: !ribbon,
        color: COLORS[Math.floor(Math.random() * COLORS.length)]!,
        angle: Math.random() * Math.PI,
        spin: (Math.random() - 0.5) * 0.3,
      };
    });
  const bits = [...make(12, 3.2 * 1.6, 0.72 * 1.2), ...make(8, 2.2 * 1.6, 0.58 * 1.2)];
  const ticks = 60;
  let tick = 0;
  let raf = 0;
  const stop = () => {
    window.cancelAnimationFrame(raf);
    canvas.remove();
    cancel = null;
  };
  const frame = () => {
    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    const alpha = Math.max(0, 1 - tick / ticks);
    for (const b of bits) {
      b.x += b.vx;
      b.y += b.vy;
      b.vx *= 0.93;
      b.vy *= 0.93;
      b.angle += b.spin;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(b.x, b.y);
      ctx.rotate(b.angle);
      ctx.fillStyle = b.color;
      if (b.round) {
        ctx.beginPath();
        ctx.arc(0, 0, b.w / 2, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillRect(-b.w / 2, -b.h / 2, b.w, b.h);
      }
      ctx.restore();
    }
    tick += 1;
    if (tick >= ticks) stop();
    else raf = window.requestAnimationFrame(frame);
  };
  cancel = stop;
  raf = window.requestAnimationFrame(frame);
}

export function clearConfetti() {
  cancel?.();
}
