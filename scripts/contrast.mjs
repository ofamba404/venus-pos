// Contrast maths for the design tokens. Used by scripts/check-contrast.mjs and tests/unit/contrast.test.ts.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

export function readTokens(file = join(here, '..', 'src', 'styles', 'tokens.css')) {
  const css = readFileSync(file, 'utf8');
  const root = css.slice(css.indexOf(':root'), css.indexOf('}', css.indexOf(':root')));
  const raw = {};
  for (const m of root.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) raw[m[1]] = m[2].trim();
  return raw;
}

/** Resolves var(--x) chains down to a hex colour. */
export function resolve(raw, name, seen = new Set()) {
  if (seen.has(name)) throw new Error(`cycle at ${name}`);
  seen.add(name);
  const value = raw[name];
  if (value == null) throw new Error(`unknown token ${name}`);
  const ref = value.match(/^var\((--[\w-]+)\)$/);
  if (ref) return resolve(raw, ref[1], seen);
  if (!/^#[0-9a-f]{6}$/i.test(value)) throw new Error(`${name} is not a plain hex colour: ${value}`);
  return value.toLowerCase();
}

function rgb(hex) {
  const h = hex.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
}

export function toHex([r, g, b]) {
  return '#' + [r, g, b].map((n) => Math.round(n).toString(16).padStart(2, '0')).join('');
}

/** color-mix(in srgb, a pct%, b) */
export function mix(a, pct, b) {
  const x = rgb(a);
  const y = rgb(b);
  return toHex(x.map((v, i) => v * (pct / 100) + y[i] * (1 - pct / 100)));
}

function lum(hex) {
  const f = (c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const [r, g, b] = rgb(hex);
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

export function ratio(fg, bg) {
  const [hi, lo] = [lum(fg), lum(bg)].sort((p, q) => q - p);
  return (hi + 0.05) / (lo + 0.05);
}

export const NORMAL = 4.5;
export const KEY = 7;
export const NON_TEXT = 3;

const PAPER = ['--paper-0', '--bg', '--surface-sunk', '--surface-selected'];
const TINTS = ['--wash', '--pink-tint', '--success-tint', '--melon-tint', '--grape-tint', '--berry-tint'];
const ALL_LIGHT = [...PAPER, ...TINTS];

/**
 * Every text-on-surface pairing the app uses. `bg` is a token name or { mix: [tokenA, pct, tokenB] }.
 * `min` is 4.5 for text, 7 for key numbers and labels, 3 for non-text strokes.
 */
export function pairs() {
  const list = [];
  const add = (fg, bgs, min, where) => {
    for (const bg of bgs) list.push({ fg, bg, min, where });
  };
  add('--fg', ALL_LIGHT, KEY, 'Body text and key numbers (totals, amounts) on every light surface');
  add('--fg-2', ALL_LIGHT, NORMAL, 'Secondary text on every light surface');
  add('--fg-3', ALL_LIGHT.filter((t) => t !== '--surface-selected'), NORMAL, 'Meta text on plain surfaces and tints (not on the selected-row grey)');
  add('--money', ALL_LIGHT, KEY, 'Money and key numbers: totals, amounts, on every light surface');
  add('--bronze-deep', ALL_LIGHT.filter((t) => t !== '--surface-selected'), NORMAL, 'Deep bronze label text on every light surface (auth kicker)');
  add('--bronze', ['--paper-0', '--bg'], NORMAL, 'Small bronze text on white and the page. On the wash use --bronze-deep');
  add('--fg', ['--wash-strong'], KEY, 'Ink on the stronger wash (low-stock tag, chips)');
  add('--fg-2', ['--wash-strong'], NORMAL, 'Secondary text on the stronger wash');
  add('--success-ink', ['--paper-0', '--bg', '--success-tint', { mix: ['--success', 14, '--surface'] }], KEY, 'Paid tag text');
  add('--danger', ['--paper-0', '--bg', '--berry-tint', '--pink-tint', { mix: ['--danger', 12, '--surface'] }], NORMAL, 'Credit tag, debt amounts, errors');
  add('--warn-fg', ['--warn-bg'], NORMAL, 'Low-stock tag');
  add('--on-action', ['--action', '--success', '--danger'], NORMAL, 'White on ink, success and danger fills');
  add('--on-action', ['--action'], KEY, 'Primary pills, active tabs, cart bar');
  add('--wash-strong', ['--action'], KEY, 'Cart bar "Review sale" on ink');
  add('--wash', ['--action'], KEY, 'Light wash text on ink');
  add('--on-action', ['--bronze'], NORMAL, 'White on solid bronze (Delivery tag, quantity badge)');
  add('--bronze', ['--paper-0', '--bg', '--wash', '--wash-strong'], NON_TEXT, 'Bronze borders, nav marker, chart bars and the selected ring against the surfaces they sit on');
  add('--input-line', ['--paper-0', '--bg'], NON_TEXT, 'Input borders against the sheet and the page');
  add('--bronze-deep', ['--wash-strong'], NORMAL, 'Avatar initials on the stronger wash');
  add('--danger', [{ mix: ['--danger', 7, '--surface'] }, { mix: ['--danger', 6, '--surface'] }], KEY, 'Calm owed tag and delete confirmation');
  add('--ink-900', ['--paper-0', '--bg'], NON_TEXT, 'Money chart: your share bar against the card and the page');
  add('--bronze-deep', ['--paper-0', '--bg'], NON_TEXT, 'Money chart helper stripes');
  add('--danger', ['--paper-0', '--bg'], NON_TEXT, 'Credit age bar, the older segment');
  add('--fg-2', ['--wash'], NORMAL, 'Credit order rows and metadata on the wash');
  add('--fg-3', ['--paper-0'], NORMAL, 'Placeholder text on a white input');
  add('--focus', ['--bg', '--paper-0', '--wash'], NON_TEXT, 'Focus ring against the page and the wash');
  add('--line-strong', ['--paper-0'], 1, 'Divider only, not for information');
  return list;
}

export function evaluate(raw = readTokens()) {
  const colour = (spec) => {
    if (typeof spec === 'string') return resolve(raw, spec);
    const [a, pct, b] = spec.mix;
    return mix(resolve(raw, a), pct, resolve(raw, b));
  };
  const label = (spec) => (typeof spec === 'string' ? spec : `${spec.mix[0]} ${spec.mix[1]}% on ${spec.mix[2]}`);
  return pairs().map((p) => {
    const fg = resolve(raw, p.fg);
    const bg = colour(p.bg);
    const r = ratio(fg, bg);
    return { ...p, fgHex: fg, bgHex: bg, bgLabel: label(p.bg), ratio: r, ok: r >= p.min };
  });
}
