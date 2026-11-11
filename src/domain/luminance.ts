/** Relative luminance helpers for flavour fills. */

export function relativeLuminance(hex: string): number {
  const raw = String(hex || '').replace('#', '');
  const full = raw.length === 3 ? raw.split('').map((c) => c + c).join('') : raw;
  if (full.length !== 6) return 0;
  const channel = (i: number) => {
    const c = parseInt(full.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const r = channel(0);
  const g = channel(2);
  const b = channel(4);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Ink on light fills; paper on dark fills. Threshold 0.5 per DESIGN.md. */
export function contrastInk(hex: string, threshold = 0.5): 'ink' | 'paper' {
  return relativeLuminance(hex) >= threshold ? 'ink' : 'paper';
}
