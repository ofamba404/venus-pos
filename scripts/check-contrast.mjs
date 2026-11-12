import { evaluate } from './contrast.mjs';

const rows = evaluate();
const failed = rows.filter((r) => !r.ok);
for (const r of rows) {
  const flag = r.ok ? 'ok  ' : 'FAIL';
  console.log(`${flag} ${r.ratio.toFixed(2).padStart(5)} (min ${r.min})  ${r.fg} ${r.fgHex} on ${r.bgLabel} ${r.bgHex}`);
}
console.log(`\ncheck-contrast: ${rows.length - failed.length}/${rows.length} pairs pass`);
if (failed.length) process.exit(1);
