#!/usr/bin/env node
// Move household data between a Hearth data folder and cloud storage.
//
//   Home → cloud (set the same storage variables your cloud host uses):
//     UPSTASH_REDIS_REST_URL=... UPSTASH_REDIS_REST_TOKEN=... node scripts/move-data.js
//     DATABASE_URL=postgres://...                            node scripts/move-data.js
//
//   Home → Cloudflare D1 (writes SQL, then run it with wrangler):
//     node scripts/move-data.js --sql hearth.sql
//     npx wrangler d1 execute hearth --remote --file=hearth.sql
//
//   Cloud → home (a backup, or moving back):
//     DATABASE_URL=postgres://... node scripts/move-data.js --to-home --data ./backup
//
// Options: --data <folder> (default: DATA_DIR or ./data), --force to replace
// household data that's already there. Synced calendars aren't copied; they
// download again within a minute or two.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FileStorage } from '../server/storage/file.js';
import { createStorage } from '../server/storage/index.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

function fail(message) {
  console.error(`\n  ${message}\n`);
  process.exit(1);
}

/** Make the copy sync its calendars straight away, since their caches stay behind. */
function forCopy(data) {
  const copy = structuredClone(data);
  for (const c of copy.calendars || []) Object.assign(c, { lastSync: null, lastAttempt: null, eventCount: 0 });
  return copy;
}

function sqlString(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

async function main() {
  const dataDir = path.resolve(option('--data') || process.env.DATA_DIR || path.join(root, 'data'));
  const force = flag('--force');
  const sqlFile = option('--sql');
  const toHome = flag('--to-home');

  let cloud = null;
  if (!sqlFile) {
    try {
      cloud = createStorage(process.env, { serverless: true });
    } catch (err) {
      fail(`Set your cloud storage first (UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN, or DATABASE_URL), or use --sql for Cloudflare D1.\n  ${err.message}`);
    }
  }
  const [from, to] = toHome ? [cloud, new FileStorage(dataDir)] : [new FileStorage(dataDir), cloud];
  const source = await from.read('hearth');
  if (!source) fail(`No household data found in ${toHome ? cloud.label : dataDir}.`);
  const data = forCopy(source.data);
  const summary = `${data.members?.length || 0} people, ${data.events?.length || 0} events, ${data.chores?.length || 0} chores, ${data.calendars?.length || 0} calendars`;

  if (sqlFile) {
    const now = new Date().toISOString();
    const sql = [
      'CREATE TABLE IF NOT EXISTS hearth_documents (key TEXT PRIMARY KEY, version INTEGER NOT NULL, data TEXT NOT NULL, updated_at TEXT NOT NULL);',
      `INSERT INTO hearth_documents (key, version, data, updated_at) VALUES ('hearth', 1, ${sqlString(JSON.stringify(data))}, ${sqlString(now)})`,
      force
        ? '  ON CONFLICT (key) DO UPDATE SET data = excluded.data, version = version + 1, updated_at = excluded.updated_at;'
        : '  ON CONFLICT (key) DO NOTHING;',
      '',
    ].join('\n');
    fs.writeFileSync(sqlFile, sql, { mode: 0o600 });
    console.log(`\n  Wrote ${sqlFile} (${summary}).`);
    console.log(`  Now run:  npx wrangler d1 execute hearth --remote --file=${sqlFile}`);
    if (!force) console.log('  (It won’t replace household data that’s already in D1; make it with --force to do that.)');
    console.log('  Delete the file afterwards: it holds your PIN hash and private calendar links.\n');
    return;
  }

  const existing = await to.read('hearth');
  if (existing && !force) {
    fail(`${toHome ? dataDir : cloud.label} already has household data. Add --force to replace it.`);
  }
  await to.write('hearth', data);
  await cloud.close?.();
  console.log(`\n  Copied ${summary} to ${toHome ? dataDir : cloud.label}.`);
  console.log('  Synced calendars download again by themselves.\n');
}

main().catch((err) => fail(err.message));
