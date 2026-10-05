import { FileStorage } from './file.js';
import { RedisStorage } from './redis.js';
import { PostgresStorage } from './postgres.js';
import { D1Storage } from './d1.js';

// Where household data is kept. At home that's a folder of JSON files. In the
// cloud, servers come and go (and there may be several at once), so the data
// goes in a database instead. HEARTH_STORAGE picks one explicitly. In the
// cloud (`detect`), the first one that's configured wins; at home it stays
// the data folder, so a DATABASE_URL meant for something else is never used.
//
// Every storage keeps named JSON documents ("hearth", "calendars/<id>"), each
// with a version number that goes up by one on every write:
//
//   read(key)                  { data, version } or null
//   readMany(keys)             { [key]: data } for the keys that exist
//   version(key)               the current version, 0 if missing
//   write(key, data, expected) the new version, or null if the document's
//                              version wasn't `expected` (someone else saved
//                              first). Without `expected` it always writes.
//   remove(key)
//   shared                     true when other servers may be writing too

export function createStorage(env, { dataDir, d1, serverless, detect = true } = {}) {
  const redis = {
    url: env.UPSTASH_REDIS_REST_URL || env.KV_REST_API_URL,
    token: env.UPSTASH_REDIS_REST_TOKEN || env.KV_REST_API_TOKEN,
  };
  const databaseUrl = env.DATABASE_URL || env.POSTGRES_URL;
  const kind = (env.HEARTH_STORAGE || '').trim().toLowerCase()
    || (!detect ? 'file' : d1 ? 'd1' : redis.url ? 'redis' : databaseUrl ? 'postgres' : 'file');

  switch (kind) {
    case 'd1':
      if (!d1) throw new Error('HEARTH_STORAGE is d1, but the Worker has no D1 database bound as DB. Check d1_databases in wrangler.jsonc.');
      return new D1Storage(d1);
    case 'redis':
      if (!redis.url || !redis.token) {
        throw new Error('Redis needs UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN (or KV_REST_API_URL and KV_REST_API_TOKEN).');
      }
      return new RedisStorage({ ...redis, prefix: env.HEARTH_REDIS_PREFIX || 'hearth:' });
    case 'postgres':
      if (!databaseUrl) throw new Error('PostgreSQL needs DATABASE_URL (or POSTGRES_URL).');
      return new PostgresStorage(databaseUrl);
    case 'file':
      if (serverless || !dataDir) {
        throw new Error(
          'This host has no lasting disk, so Hearth needs a database. On Vercel, add Upstash Redis (or Neon Postgres) '
            + 'from the Marketplace and connect it to this project. Elsewhere, set UPSTASH_REDIS_REST_URL and '
            + 'UPSTASH_REDIS_REST_TOKEN, or DATABASE_URL. Then redeploy.',
        );
      }
      return new FileStorage(dataDir);
    default:
      throw new Error(`Unknown HEARTH_STORAGE "${kind}". Use file, redis, postgres or d1.`);
  }
}
