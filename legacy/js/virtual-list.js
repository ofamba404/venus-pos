const DEFAULT_ROW_HEIGHT = 52;
const VIRTUAL_THRESHOLD = 48;

/**
 * Windowed list — renders only visible rows for long lists.
 * Falls back to full render when item count is small.
 */
export function mountVirtualList(container, { items, rowHeight = DEFAULT_ROW_HEIGHT, renderRow, overscan = 6 }) {
  if (!container) return { destroy() {} };

  if (!items.length || items.length < VIRTUAL_THRESHOLD) {
    container.classList.remove('virtual-list-host');
    container.style.height = '';
    container.innerHTML = items.map((item, i) => renderRow(item, i)).join('');
    return { destroy() {} };
  }

  container.classList.add('virtual-list-host');
  const viewport = document.createElement('div');
  viewport.className = 'virtual-list-viewport';
  const spacer = document.createElement('div');
  spacer.className = 'virtual-list-spacer';
  const windowEl = document.createElement('div');
  windowEl.className = 'virtual-list-window';
  viewport.appendChild(spacer);
  viewport.appendChild(windowEl);
  container.replaceChildren(viewport);

  let raf = 0;
  let lastStart = -1;
  let lastEnd = -1;

  const paint = () => {
    raf = 0;
    const scrollTop = viewport.scrollTop;
    const viewHeight = viewport.clientHeight || 400;
    const totalHeight = items.length * rowHeight;
    spacer.style.height = `${totalHeight}px`;

    const start = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
    const visibleCount = Math.ceil(viewHeight / rowHeight) + overscan * 2;
    const end = Math.min(items.length, start + visibleCount);

    if (start === lastStart && end === lastEnd) return;
    lastStart = start;
    lastEnd = end;

    windowEl.style.transform = `translateY(${start * rowHeight}px)`;
    const frag = document.createDocumentFragment();
    for (let i = start; i < end; i += 1) {
      const wrap = document.createElement('div');
      wrap.innerHTML = renderRow(items[i], i);
      frag.appendChild(wrap.firstElementChild || wrap);
    }
    windowEl.replaceChildren(frag);
  };

  const schedulePaint = () => {
    if (!raf) raf = requestAnimationFrame(paint);
  };

  viewport.addEventListener('scroll', schedulePaint, { passive: true });
  schedulePaint();

  return {
    destroy() {
      viewport.removeEventListener('scroll', schedulePaint);
      if (raf) cancelAnimationFrame(raf);
      container.classList.remove('virtual-list-host');
    },
  };
}

export { VIRTUAL_THRESHOLD, DEFAULT_ROW_HEIGHT };
