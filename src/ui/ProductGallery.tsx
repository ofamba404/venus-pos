import type { Ref } from 'preact';
import { memo } from 'preact/compat';
import { useEffect, useRef, useState } from 'preact/hooks';
import { productImageSlides, type ImageSlide } from '../domain/product-art';

const AUTOPLAY_MS = 2800;
const RESUME_MS = 4500;

function reducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function slideKey(slides: ImageSlide[]): string {
  return slides.map((s) => `${s.src}:${s.count}`).join('|');
}

function GalleryImg({ slide, eager }: { slide: ImageSlide; eager: boolean }) {
  return (
    <img
      class={`v-gallery__img${/\/scout-/.test(slide.src) ? ' v-gallery__img--joint' : ''}`}
      src={slide.src}
      alt=""
      draggable={false}
      loading={eager ? 'eager' : 'lazy'}
    />
  );
}

/**
 * The scrollable track is memoised on the photo key so a re-render (autoplay
 * `setActive`, or a parent poll) does not reconcile it. Reconciling the track
 * reset scrollLeft to 0, which flashed the last-photo clone and made order
 * tiles look like they were glitching.
 */
const GalleryTrack = memo(
  function GalleryTrack({
    slides,
    tile,
    trackRef,
  }: {
    slides: ImageSlide[];
    tile: boolean;
    trackRef: Ref<HTMLDivElement>;
  }) {
    const count = slides.length;
    const track = [
      { slide: slides[count - 1]!, i: -1, clone: true },
      ...slides.map((slide, i) => ({ slide, i, clone: false })),
      { slide: slides[0]!, i: count, clone: true },
    ];
    return (
      <div
        class="v-gallery__track"
        ref={trackRef}
        tabIndex={tile ? -1 : 0}
        role="region"
        aria-roledescription="carousel"
        aria-label="Flavour photos"
        data-testid="gallery-track"
      >
        {track.map(({ slide, i, clone }) => (
          <div
            class="v-gallery__slide"
            key={`${clone ? 'clone' : 'real'}-${i}`}
            data-gallery-index={clone ? undefined : i}
            data-gallery-clone={clone ? 'true' : undefined}
            aria-hidden={clone ? 'true' : undefined}
          >
            <GalleryImg slide={slide} eager={!clone && i === 0} />
          </div>
        ))}
      </div>
    );
  },
  (prev, next) => slideKey(prev.slides) === slideKey(next.slides) && prev.tile === next.tile,
);

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
  slides: given,
  autoplay = true,
}: {
  productId?: string | null;
  breakdown?: Record<string, unknown> | null;
  /** Ready-made slides, for a whole order or sale, instead of one line's product and breakdown. */
  slides?: ImageSlide[];
  size?: number;
  testId?: string;
  /**
   * `thumb` is the cart and sale-edit photo, with tappable dots under it. `mini` is the small photo on an
   * order card or History row: the dots sit on the photo and are only pictures (the row is one button).
   */
  variant?: 'thumb' | 'mini';
  autoplay?: boolean;
}) {
  const tile = variant === 'mini';
  const incoming = given || productImageSlides(productId, breakdown);
  const key = slideKey(incoming);
  const held = useRef({ key, slides: incoming });
  if (held.current.key !== key) held.current = { key, slides: incoming };
  const slides = held.current.slides;
  const trackRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  const count = slides.length;

  // With several photos the track holds [last clone, ...photos, first clone]. Real photo i sits at position i + 1.
  // Reaching a clone jumps (instantly, invisibly) to the real photo it copies, so the loop only ever moves forward.
  useEffect(() => {
    setActive(0);
    const track = trackRef.current;
    if (track && track.clientWidth) track.scrollLeft = track.clientWidth;
  }, [key]);

  useEffect(() => {
    const track = trackRef.current;
    const root = rootRef.current;
    if (!track || !root || count < 2) return undefined;
    let timer: number | undefined;
    let resume: number | undefined;
    let inView = true;
    let settle: number | undefined;
    /** The position on the track, 0 to count + 1. */
    const position = () => {
      const w = track.clientWidth;
      return w ? Math.max(0, Math.min(count + 1, Math.round(track.scrollLeft / w))) : 1;
    };
    /** The real photo shown, 0 to count - 1, folding the two clones onto their originals. */
    const index = () => {
      const p = position();
      return p === 0 ? count - 1 : p === count + 1 ? 0 : p - 1;
    };
    const jump = (pos: number) => {
      const w = track.clientWidth;
      if (!w) return;
      track.style.scrollSnapType = 'none';
      track.scrollLeft = pos * w;
      // Snap comes back on the next frame, after the jump has been laid out.
      window.requestAnimationFrame(() => {
        track.style.scrollSnapType = '';
      });
    };
    /** Once a scroll has come to rest on a clone, swap to the real photo it copies. */
    const settled = () => {
      const p = position();
      if (p === 0) jump(count);
      else if (p === count + 1) jump(1);
      setActive(index());
    };
    const go = (i: number, behavior: ScrollBehavior = 'smooth') => {
      const w = track.clientWidth;
      if (!w) return;
      track.scrollTo({ left: (i + 1) * w, behavior });
      setActive(((i % count) + count) % count);
    };
    const stop = () => {
      if (timer !== undefined) window.clearInterval(timer);
      timer = undefined;
    };
    const start = () => {
      stop();
      if (!autoplay || reducedMotion() || !inView) return;
      timer = window.setInterval(() => {
        // Always one step forward. After the last photo that lands on the first photo's clone, then jumps to the real first.
        const w = track.clientWidth;
        if (!w) return;
        track.scrollTo({ left: Math.min(position() + 1, count + 1) * w, behavior: 'smooth' });
      }, AUTOPLAY_MS);
    };
    const touched = () => {
      stop();
      if (resume !== undefined) window.clearTimeout(resume);
      resume = window.setTimeout(start, RESUME_MS);
    };
    const onScroll = () => {
      window.clearTimeout(settle);
      settle = window.setTimeout(settled, 90);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      touched();
      const i = index();
      go(e.key === 'ArrowRight' ? i + 1 : i - 1);
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
    if (track.clientWidth) track.scrollLeft = track.clientWidth * (index() + 1);
    start();
    return () => {
      stop();
      window.clearTimeout(settle);
      if (resume !== undefined) window.clearTimeout(resume);
      io?.disconnect();
      track.removeEventListener('scroll', onScroll);
      track.removeEventListener('pointerdown', touched);
      track.removeEventListener('touchstart', touched);
      track.removeEventListener('keydown', onKey);
      root.removeEventListener('click', dotClick);
    };
  }, [key, count, autoplay]);

  if (!count) return null;
  const style = { '--gallery-size': `${size}px` } as Record<string, string>;
  const cls = `v-gallery${tile ? ' v-gallery--mini' : ''}`;
  if (count === 1) {
    return (
      <div class={cls} style={style} data-testid={testId} data-slides="1">
        <div class="v-gallery__frame">
          <div class="v-gallery__viewport">
            <GalleryImg slide={slides[0]!} eager />
          </div>
          {slides[0]!.count > 1 ? <span class="v-gallery__qty">×{slides[0]!.count}</span> : null}
        </div>
      </div>
    );
  }
  const shownCount = slides[Math.min(active, count - 1)]?.count ?? 1;
  return (
    <div class={`${cls} has-multiple`} ref={rootRef} style={style} data-testid={testId} data-slides={count}>
      <div class="v-gallery__frame">
        <div class="v-gallery__viewport">
          <GalleryTrack slides={slides} tile={tile} trackRef={trackRef} />
        </div>
        {shownCount > 1 ? (
          <span class="v-gallery__qty" data-testid="gallery-qty">
            ×{shownCount}
          </span>
        ) : null}
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
