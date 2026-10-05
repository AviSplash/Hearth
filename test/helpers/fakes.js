import http from 'node:http';

/**
 * Shared storage in memory, like a cloud database that several servers use
 * at once. Every call yields first, so concurrent updates really interleave.
 */
export class MemoryStorage {
  name = 'memory';
  label = 'memory';
  shared = true;
  docs = new Map();
  conflicts = 0;

  async read(key) {
    await new Promise((r) => setImmediate(r));
    const doc = this.docs.get(key);
    return doc ? { data: structuredClone(doc.data), version: doc.version } : null;
  }

  async readMany(keys) {
    await new Promise((r) => setImmediate(r));
    return Object.fromEntries(keys.filter((k) => this.docs.has(k)).map((k) => [k, structuredClone(this.docs.get(k).data)]));
  }

  async version(key) {
    return this.docs.get(key)?.version || 0;
  }

  async write(key, data, expected) {
    await new Promise((r) => setImmediate(r));
    const current = this.docs.get(key)?.version || 0;
    if (expected !== undefined && expected !== current) {
      this.conflicts += 1;
      return null;
    }
    this.docs.set(key, { data: structuredClone(data), version: current + 1 });
    return current + 1;
  }

  async remove(key) {
    this.docs.delete(key);
  }
}

/**
 * Just enough of Upstash's REST API (https://upstash.com/docs/redis/features/restapi)
 * to run RedisStorage against. The Lua write script is emulated in JS.
 */
export async function startFakeUpstash(token = 'test-token') {
  const hashes = new Map();
  const run = ([cmd, key, ...args]) => {
    const h = hashes.get(key);
    switch (String(cmd).toUpperCase()) {
      case 'HGET':
        return h?.get(args[0]) ?? null;
      case 'HMGET':
        return args.map((f) => h?.get(f) ?? null);
      case 'DEL':
        return hashes.delete(key) ? 1 : 0;
      case 'EVAL': {
        // EVAL script 1 key data expected (`key` above is the script)
        const [, k, data, expected] = args;
        const doc = hashes.get(k);
        const v = Number(doc?.get('v') || 0);
        if (expected !== '' && v !== Number(expected)) return -1;
        hashes.set(k, new Map([['v', String(v + 1)], ['data', data]]));
        return v + 1;
      }
      default:
        throw new Error(`ERR unknown command '${cmd}'`);
    }
  };
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      res.setHeader('Content-Type', 'application/json');
      if (req.headers.authorization !== `Bearer ${token}`) {
        res.statusCode = 401;
        return res.end(JSON.stringify({ error: 'Unauthorized' }));
      }
      const parsed = JSON.parse(body);
      if (req.url === '/pipeline') {
        return res.end(JSON.stringify(parsed.map((c) => {
          try {
            return { result: run(c) };
          } catch (err) {
            return { error: err.message };
          }
        })));
      }
      try {
        res.end(JSON.stringify({ result: run(parsed) }));
      } catch (err) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: err.message }));
      }
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { url: `http://127.0.0.1:${server.address().port}`, token, close: () => server.close() };
}

/** Cloudflare's D1 binding API on top of Node's built-in SQLite (Node 22.5+). */
export async function fakeD1() {
  let sqlite;
  try {
    sqlite = await import('node:sqlite');
  } catch {
    return null;
  }
  const db = new sqlite.DatabaseSync(':memory:');
  const statement = (sql, params = []) => ({
    bind: (...p) => statement(sql, p),
    first: async () => db.prepare(sql).get(...params) ?? null,
    all: async () => ({ results: db.prepare(sql).all(...params) }),
    run: async () => {
      db.prepare(sql).run(...params);
      return { success: true };
    },
  });
  return { prepare: (sql) => statement(sql) };
}
