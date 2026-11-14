import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { IconClose } from './icons';
import { IconButton } from './IconButton';

/** Matches the close animation in ui.css (the store's cart drawer eases out in 480ms). */
const CLOSE_MS = 480;

function reducedMotion(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Sheet / drawer. Opens and closes with the same motion as the storefront cart drawer: the panel slides in with a
 * long ease-out, the scrim fades in over 400ms, and on close the panel eases out and the scrim fades away.
 * It stays mounted while it plays the close, then unmounts. With reduced motion it just appears and disappears.
 */
export function Sheet({
  open,
  title,
  titleTestId,
  preface,
  lead,
  children,
  footer,
  onClose,
  dismissible = true,
  swipeBody = false,
}: {
  open: boolean;
  title: string;
  titleTestId?: string;
  /** Sits above the title, e.g. a queue switcher. */
  preface?: ComponentChildren;
  /** Sits under the title in the header, e.g. tags. */
  lead?: ComponentChildren;
  children: ComponentChildren;
  footer?: ComponentChildren;
  onClose: () => void;
  dismissible?: boolean;
  /** Let a downward swipe anywhere on the sheet dismiss it. By default only the handle and title bar do, so a long body can still scroll. */
  swipeBody?: boolean;
}) {
  const [mounted, setMounted] = useState(open);
  const [closing, setClosing] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  const panel = useRef<HTMLDivElement>(null);
  const swiped = useRef(false);
  // While it plays the close, keep showing what it showed when it was open, so the content does not blank mid-slide.
  const last = useRef({ title, titleTestId, preface, lead, children, footer });
  if (open) last.current = { title, titleTestId, preface, lead, children, footer };

  if (open && !mounted) setMounted(true);

  useEffect(() => {
    window.clearTimeout(timer.current);
    if (open) {
      swiped.current = false;
      setClosing(false);
      return;
    }
    if (!mounted) return;
    if (reducedMotion() || swiped.current) {
      swiped.current = false;
      setMounted(false);
      return;
    }
    setClosing(true);
    timer.current = window.setTimeout(() => {
      setMounted(false);
      setClosing(false);
    }, CLOSE_MS);
    return () => window.clearTimeout(timer.current);
  }, [open, mounted]);

  /** Drag the sheet down with a finger. Past a third of a short drag, or a quick flick, it goes. */
  function startSwipe(e: PointerEvent) {
    const el = panel.current;
    if (!el || !dismissible || e.button > 0) return;
    const target = e.target as HTMLElement | null;
    if (target?.closest('input, textarea, select, [contenteditable]')) return;
    const startY = e.clientY;
    const startAt = performance.now();
    let dy = 0;
    let dragging = false;
    const move = (ev: PointerEvent) => {
      dy = Math.max(0, ev.clientY - startY);
      if (!dragging && dy > 8) {
        dragging = true;
        el.style.animation = 'none';
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
      const far = dy > Math.min(120, el.offsetHeight / 3) || (speed > 0.6 && dy > 24);
      el.style.transition = 'transform 180ms ease-out';
      if (far) {
        swiped.current = true;
        el.style.transform = 'translateY(105%)';
        window.setTimeout(onClose, reducedMotion() ? 0 : 160);
      } else {
        el.style.transform = 'translateY(0)';
        window.setTimeout(() => {
          el.style.transition = '';
          el.style.transform = '';
        }, 190);
      }
      // A swipe is not a tap on whatever the finger ended over.
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

  if (!open && !mounted) return null;
  const out = closing && !open;
  return (
    <>
      <div
        class={`v-sheet-scrim${out ? ' is-closing' : ''}`}
        onClick={() => {
          if (dismissible && !out) onClose();
        }}
      />
      <div
        ref={panel}
        class={`v-sheet${out ? ' is-closing' : ''}${swipeBody ? ' v-sheet--swipe' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={last.current.title}
        onPointerDown={swipeBody ? (e) => startSwipe(e as unknown as PointerEvent) : undefined}
      >
        <div class="v-sheet__grab" onPointerDown={swipeBody ? undefined : (e) => startSwipe(e as unknown as PointerEvent)}>
        <div class="v-sheet__handle" />
        {last.current.preface ? <div class="v-sheet__preface">{last.current.preface}</div> : null}
        <div class="v-sheet__head">
          <h2 class="v-sheet__title" data-testid={last.current.titleTestId || undefined}>{last.current.title}</h2>
          <IconButton label="Close" onClick={onClose}>
            <IconClose size={22} />
          </IconButton>
        </div>
        {last.current.lead ? <div class="v-sheet__lead">{last.current.lead}</div> : null}
        </div>
        <div class="v-sheet__body">{last.current.children}</div>
        {last.current.footer ? <div class="v-sheet__foot">{last.current.footer}</div> : null}
      </div>
    </>
  );
}
