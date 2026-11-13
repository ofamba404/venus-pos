import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';

const MS = 280;

function reducedMotion(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

/**
 * An accordion body. Opening grows it from nothing to its own height, closing shrinks it back, and it unmounts when
 * closed so a long list is not kept in the page. With reduced motion it simply appears and disappears.
 * Starts open without animating when `open` is already true on first render.
 */
export function Collapse({ open, children, testId }: { open: boolean; children: ComponentChildren; testId?: string }) {
  const [mounted, setMounted] = useState(open);
  const [grown, setGrown] = useState(open);
  const timer = useRef<number | undefined>(undefined);
  const last = useRef(children);
  if (open) last.current = children;

  useEffect(() => {
    window.clearTimeout(timer.current);
    if (open) {
      setMounted(true);
      if (reducedMotion()) {
        setGrown(true);
        return;
      }
      // One frame at height 0, then grow, so the transition has something to run from.
      const frame = window.requestAnimationFrame(() => window.requestAnimationFrame(() => setGrown(true)));
      return () => window.cancelAnimationFrame(frame);
    }
    setGrown(false);
    if (reducedMotion()) {
      setMounted(false);
      return;
    }
    timer.current = window.setTimeout(() => setMounted(false), MS);
    return () => window.clearTimeout(timer.current);
  }, [open]);

  if (!open && !mounted) return null;
  return (
    <div class={`v-collapse${grown && open ? ' is-open' : ''}`} data-testid={testId}>
      <div class="v-collapse__in">{open ? children : last.current}</div>
    </div>
  );
}
