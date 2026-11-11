/** Money and display formatters — port of `js/utils.js` fmt helpers. */

export function formatUGX(n: number): string {
  return `UGX ${Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
}

export function formatCompact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(n % 1000 === 0 ? 0 : 1)}k`;
  return Math.round(n).toString();
}

export function clientInitials(name: string | null | undefined): string {
  const letters = String(name || '')
    .trim()
    .split(/\s+/)
    .map((word) => {
      const match = word.match(/\p{L}/u);
      return match ? match[0] : '';
    })
    .filter(Boolean);
  if (!letters.length) return '?';
  return letters.join('').slice(0, 2).toUpperCase();
}

export function escapeHtml(str: unknown): string {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
