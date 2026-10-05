// Upstash Redis through its REST API, which needs nothing but fetch(), so it
// works from Vercel (Marketplace → Upstash for Redis), Cloudflare, Render,
// Fly, Railway or your own computer. Each document is a Redis hash holding
// its JSON text and a version number. A small Lua script checks the version
// and writes in one atomic step, so two screens saving at the same moment
// can't overwrite each other.

const WRITE = `local v = tonumber(redis.call('HGET', KEYS[1], 'v') or '0')
if ARGV[2] ~= '' and v ~= tonumber(ARGV[2]) then return -1 end
redis.call('HSET', KEYS[1], 'v', v + 1, 'data', ARGV[1])
return v + 1`;

export class RedisStorage {
  name = 'redis';
  label = 'Upstash Redis';
  shared = true;

  constructor({ url, token, prefix = 'hearth:' }) {
    this.url = url.replace(/\/+$/, '');
    this.token = token;
    this.prefix = prefix;
  }

  async #send(body, endpoint = '') {
    let res;
    try {
      res = await fetch(`${this.url}${endpoint}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10_000),
      });
    } catch (err) {
      throw new Error(`Can't reach Redis: ${err.message}`);
    }
    const out = await res.json().catch(() => null);
    if (!res.ok || !out || out.error) throw new Error(`Redis: ${out?.error || `HTTP ${res.status}`}`);
    return out;
  }

  async #command(...args) {
    return (await this.#send(args)).result;
  }

  async read(key) {
    const [version, data] = await this.#command('HMGET', this.prefix + key, 'v', 'data');
    return data == null ? null : { data: JSON.parse(data), version: Number(version) };
  }

  async readMany(keys) {
    if (!keys.length) return {};
    const replies = await this.#send(keys.map((k) => ['HGET', this.prefix + k, 'data']), '/pipeline');
    const out = {};
    keys.forEach((key, i) => {
      if (replies[i]?.error) throw new Error(`Redis: ${replies[i].error}`);
      if (replies[i]?.result != null) out[key] = JSON.parse(replies[i].result);
    });
    return out;
  }

  async version(key) {
    return Number(await this.#command('HGET', this.prefix + key, 'v')) || 0;
  }

  async write(key, data, expected) {
    const result = await this.#command('EVAL', WRITE, '1', this.prefix + key, JSON.stringify(data), expected === undefined ? '' : String(expected));
    return result === -1 ? null : Number(result);
  }

  async remove(key) {
    await this.#command('DEL', this.prefix + key);
  }
}
