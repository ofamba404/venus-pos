/**
 * Bundle every Netlify function the way production does, and fail if a
 * relative import does not resolve. Catches layout mistakes such as
 * `../../../js/...` after v1 moved to `legacy/js/`.
 */
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const functionsDir = path.join(root, 'netlify/functions');
const entries = readdirSync(functionsDir).filter((name) => name.endsWith('.mjs') || name.endsWith('.js') || name.endsWith('.ts'));

if (!entries.length) {
  console.error('check-functions: no function entry files in netlify/functions');
  process.exit(1);
}

let failed = 0;
for (const name of entries) {
  const entry = path.join(functionsDir, name);
  try {
    await esbuild.build({
      absWorkingDir: root,
      entryPoints: [entry],
      bundle: true,
      write: false,
      platform: 'node',
      format: 'esm',
      packages: 'external',
      logLevel: 'silent',
    });
    console.log(`check-functions: ${name} bundles`);
  } catch (error) {
    failed += 1;
    const message = error instanceof Error ? error.message : String(error);
    console.error(`check-functions: ${name} failed to bundle\n${message}`);
  }
}

if (failed) {
  console.error(`check-functions: ${failed} function(s) failed`);
  process.exit(1);
}
console.log(`check-functions: ${entries.length} functions bundle`);
