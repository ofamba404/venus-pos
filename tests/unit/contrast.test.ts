import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error plain .mjs helper shared with scripts/check-contrast.mjs
import { evaluate, ratio } from '../../scripts/contrast.mjs';

type Row = { fg: string; fgHex: string; bgLabel: string; bgHex: string; ratio: number; min: number; ok: boolean; where: string };

describe('design token contrast', () => {
  const rows = evaluate() as Row[];

  it('checks a meaningful set of pairs', () => {
    expect(rows.length).toBeGreaterThan(60);
  });

  it('every text-on-surface pair meets its threshold (4.5 text, 7 key numbers, 3 non-text)', () => {
    const failed = rows
      .filter((r) => !r.ok)
      .map((r) => `${r.fg} ${r.fgHex} on ${r.bgLabel} ${r.bgHex} = ${r.ratio.toFixed(2)} (needs ${r.min}) — ${r.where}`);
    expect(failed).toEqual([]);
  });

  it('money and ink text clear 7:1 on the pink tint and the bronze wash, the surfaces that looked muddy', () => {
    const pick = (fg: string, bg: string) => rows.find((r) => r.fg === fg && r.bgLabel === bg)!;
    for (const bg of ['--pink-tint', '--wash']) {
      expect(pick('--money', bg).ratio).toBeGreaterThanOrEqual(7);
      expect(pick('--fg', bg).ratio).toBeGreaterThanOrEqual(7);
      expect(pick('--fg-3', bg).ratio).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('measures black on white as 21:1', () => {
    expect(ratio('#000000', '#ffffff')).toBeCloseTo(21, 5);
  });

  it('no stylesheet hard-codes a text colour outside the tokens', () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) walk(full);
        else if (full.endsWith('.css') && !full.endsWith('tokens.css')) files.push(full);
      }
    };
    walk('src');
    const offenders: string[] = [];
    for (const file of files) {
      readFileSync(file, 'utf8')
        .split('\n')
        .forEach((line, i) => {
          if (/(^|[^-])color:\s*#[0-9a-f]{3,8}/i.test(line)) offenders.push(`${file}:${i + 1} ${line.trim()}`);
        });
    }
    expect(offenders).toEqual([]);
  });
});
