import { useEffect, useRef, useState } from 'preact/hooks';
import { productImageSlides } from '../domain/product-art';

const AUTOPLAY_MS = 2800;
const RESUME_MS = 4500;

function reducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * The line's photo. One flavour, or no flavour photos, is a plain picture. Several flavours become
 * a swipe gallery with one photo per flavour, a ×N badge, dots, and slow auto-advance that pauses
 * while a thumb is on it and while it is off screen. Same behaviour as the storefront cart drawer.
 */
export function ProductGallery({
  productId,
  breakdown,
  size = 64,
  testId,
  variant = 'thumb',
}: {
  productId: string | null | undefined;
  breakdown?: Record<string, unknown> | null;
  size?: number;
  testId?: string;
  /**
   * `tile` fills a Sell product tile (a button, so the dots are pictures, not buttons) and is
   * swiped with a thumb. Tapping the tile still opens the picker. `thumb` is the small cart photo.
   */
  variant?: 'thumb' | 'tile';
}) {
  const tile = variant === 'tile';
  const slides = productImageSlides(productId, breakdown);
  const key = slides.map((s) => `${s.src}:${s.count}`).join('|');
  const trackRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  const count = slides.length;

  useEffect(() => {
    setActive(0);
    const track = trackRef.current;
    if (track) track.scrollLeft = 0;
  }, [key]);

  useEffect(() => {
    const track = trackRef.current;
    const root = rootRef.current;
    if (!track || !root || count < 2) return undefined;
    let timer: number | undefined;
    let resume: number | undefined;
    let inView = true;
    const index = () => {
      const w = track.clientWidth;
      return w ? Math.max(0, Math.min(count - 1, Math.round(track.scrollLeft / w))) : 0;
    };
    const go = (i: number, behavior: ScrollBehavior = 'smooth') => {
      const w = track.clientWidth;
      if (!w) return;
      track.scrollTo({ left: i * w, behavior });
      setActive(i);
    };
    const stop = () => {
      if (timer !== undefined) window.clearInterval(timer);
      timer = undefined;
    };
    const start = () => {
      stop();
      if (reducedMotion() || !inView) return;
      timer = window.setInterval(() => {
        const next = index() + 1;
        go(next >= count ? 0 : next);
      }, AUTOPLAY_MS);
    };
    const touched = () => {
      stop();
      if (resume !== undefined) window.clearTimeout(resume);
      resume = window.setTimeout(start, RESUME_MS);
    };
    const onScroll = () => setActive(index());
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      touched();
      const i = index();
      go(e.key === 'ArrowRight' ? (i + 1) % count : (i - 1 + count) % count);
    };
    track.addEventListener('scroll', onScroll, { passive: true });
    track.addEventListener('pointerdown', touched, { passive: true });
    track.addEventListener('touchstart', touched, { passive: true });
    track.addEventListener('keydown', onKey);
    const dotClick = (e: Event) => {
      const dot = (e.target as HTMLElement).closest<HTMLElement>('[data-dot]');
      if (!dot) return;
      e.stopPropagation();
      touched();
      go(Number(dot.dataset.dot));
    };
    root.addEventListener('click', dotClick);
    let io: IntersectionObserver | undefined;
    if (typeof IntersectionObserver === 'function') {
      io = new IntersectionObserver(
        (entries) => {
          inView = entries.some((e) => e.isIntersecting);
          if (inView) start();
          else stop();
        },
        { threshold: [0, 0.4] },
      );
      io.observe(root);
    }
    start();
    return () => {
      stop();
      if (resume !== undefined) window.clearTimeout(resume);
      io?.disconnect();
      track.removeEventListener('scroll', onScroll);
      track.removeEventListener('pointerdown', touched);
      track.removeEventListener('touchstart', touched);
      track.removeEventListener('keydown', onKey);
      root.removeEventListener('click', dotClick);
    };
  }, [key, count]);

  if (!count) return null;
  const style = tile ? undefined : ({ '--gallery-size': `${size}px` } as Record<string, string>);
  const cls = `v-gallery${tile ? ' v-gallery--tile' : ''}`;
  if (count === 1) {
    return (
      <div class={cls} style={style} data-testid={testId} data-slides="1">
        <div class="v-gallery__viewport">
          <img class="v-gallery__img" src={slides[0]!.src} alt="" draggable={false} />
          {slides[0]!.count > 1 ? <span class="v-gallery__qty">×{slides[0]!.count}</span> : null}
        </div>
      </div>
    );
  }
  return (
    <div class={`${cls} has-multiple`} ref={rootRef} style={style} data-testid={testId} data-slides={count}>
      <div class="v-gallery__viewport">
        <div
          class="v-gallery__track"
          ref={trackRef}
          tabIndex={tile ? -1 : 0}
          role="region"
          aria-roledescription="carousel"
          aria-label="Flavour photos"
          data-testid="gallery-track"
        >
          {slides.map((slide, i) => (
            <div class="v-gallery__slide" key={slide.src} data-gallery-index={i}>
              <img class="v-gallery__img" src={slide.src} alt="" draggable={false} loading={i === 0 ? 'eager' : 'lazy'} />
              {slide.count > 1 ? <span class="v-gallery__qty">×{slide.count}</span> : null}
            </div>
          ))}
        </div>
      </div>
      <div class="v-gallery__dots" role={tile ? undefined : 'tablist'} aria-label="Flavour photos" aria-hidden={tile ? 'true' : undefined}>
        {slides.map((slide, i) =>
          tile ? (
            <span key={slide.src} class={`v-gallery__dot${i === active ? ' is-active' : ''}`} />
          ) : (
            <button
              key={slide.src}
              type="button"
              class={`v-gallery__dot${i === active ? ' is-active' : ''}`}
              data-dot={i}
              aria-label={`Photo ${i + 1} of ${count}`}
              aria-current={i === active ? 'true' : undefined}
            />
          ),
        )}
      </div>
    </div>
  );
}
