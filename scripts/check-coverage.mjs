/**
 * Enforce the phase coverage gates from docs/overhaul/06-testing.md.
 * Domain: lines and branches ≥ 95%. Data: lines ≥ 85%.
 */
import fs from 'node:fs';

const summaryPath = new URL('../coverage/coverage-summary.json', import.meta.url);
const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));

function totals(prefix) {
  let lines = 0;
  let linesHit = 0;
  let branches = 0;
  let branchesHit = 0;
  for (const [file, row] of Object.entries(summary)) {
    if (file === 'total' || !file.includes(prefix)) continue;
    lines += row.lines.total;
    linesHit += row.lines.covered;
    branches += row.branches.total;
    branchesHit += row.branches.covered;
  }
  return {
    linePct: lines ? (linesHit / lines) * 100 : 0,
    branchPct: branches ? (branchesHit / branches) * 100 : 0,
    linesHit,
    lines,
    branchesHit,
    branches,
  };
}

const domain = totals('/src/domain/');
const data = totals('/src/data/');
const failures = [];
if (domain.linePct < 95) failures.push(`domain lines ${domain.linePct.toFixed(2)}% < 95%`);
if (domain.branchPct < 95) failures.push(`domain branches ${domain.branchPct.toFixed(2)}% < 95%`);
if (data.linePct < 85) failures.push(`data lines ${data.linePct.toFixed(2)}% < 85%`);

if (failures.length) {
  console.error('check-coverage: ' + failures.join('; '));
  process.exit(1);
}
console.log(
  `check-coverage: domain lines ${domain.linePct.toFixed(2)}% (${domain.linesHit}/${domain.lines}), branches ${domain.branchPct.toFixed(2)}% (${domain.branchesHit}/${domain.branches}); data lines ${data.linePct.toFixed(2)}% (${data.linesHit}/${data.lines})`,
);
