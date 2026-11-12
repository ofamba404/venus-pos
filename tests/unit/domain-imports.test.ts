import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const domainRoot = path.resolve('src/domain');

function filesIn(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) out.push(...filesIn(full));
    else if (name.endsWith('.ts')) out.push(full);
  }
  return out;
}

describe('domain import boundary', () => {
  it('imports only other domain modules', () => {
    const specifier = /from\s+['"]([^'"]+)['"]/g;
    const offenders: string[] = [];
    for (const file of filesIn(domainRoot)) {
      const source = readFileSync(file, 'utf8');
      for (const match of source.matchAll(specifier)) {
        const spec = match[1] || '';
        if (!spec.startsWith('.')) {
          offenders.push(`${path.relative(domainRoot, file)} -> ${spec}`);
          continue;
        }
        const resolved = path.resolve(path.dirname(file), spec);
        if (!resolved.startsWith(domainRoot)) {
          offenders.push(`${path.relative(domainRoot, file)} -> ${spec}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
