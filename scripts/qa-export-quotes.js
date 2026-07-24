/**
 * Export Supabase deliveries → qa/snapshots/YYYY-MM-DD-deliveries.json
 * Usage: npm run qa:export
 * Env: SUPABASE_URL, SUPABASE_ANON_KEY (optional; defaults from js/config.js)
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { SUPABASE_URL, SUPABASE_ANON_JWT, SUPABASE_KEY } from '../js/config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const posRoot = path.resolve(__dirname, '..');
const snapshotsDir = path.join(posRoot, 'qa', 'snapshots');

const LIMIT = Number(process.env.QA_EXPORT_LIMIT || 500);

async function fetchDeliveries() {
  const url = process.env.SUPABASE_URL || SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY || SUPABASE_ANON_JWT || SUPABASE_KEY;
  if (!url || !key) {
    throw new Error('Missing SUPABASE_URL / anon key');
  }
  const endpoint = new URL(
    `deliveries?select=*&order=created_at.desc&limit=${LIMIT}`,
    url.replace(/\/?$/, '/') + 'rest/v1/'
  );
  const res = await fetch(endpoint, {
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
    },
  });
  if (!res.ok) {
    throw new Error(`Supabase ${res.status}: ${await res.text()}`);
  }
  return res.json();
}

function todayStamp() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

async function main() {
  const rows = await fetchDeliveries();
  if (!Array.isArray(rows)) {
    throw new Error('Unexpected response (not an array)');
  }
  fs.mkdirSync(snapshotsDir, { recursive: true });
  const outPath = path.join(snapshotsDir, `${todayStamp()}-deliveries.json`);
  const payload = {
    exportedAt: new Date().toISOString(),
    count: rows.length,
    rows,
  };
  fs.writeFileSync(outPath, JSON.stringify(payload, null, 2), 'utf8');
  console.log(`Wrote ${rows.length} deliveries → ${path.relative(posRoot, outPath)}`);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
