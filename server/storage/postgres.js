// Any PostgreSQL database: Neon (Vercel Marketplace), Supabase, Render,
// Railway, Fly, Heroku or your own. Set DATABASE_URL and Hearth creates its
// one table the first time it connects. Each document is a row with a
// version number; a write only lands if the version is still the one it
// read, so two screens saving at the same moment can't overwrite each other.

const TABLE = 'hearth_documents';

export class PostgresStorage {
  name = 'postgres';
  label = 'PostgreSQL';
  shared = true;
  #pool = null;

  constructor(url) {
    this.url = url;
  }

  #db() {
    this.#pool ||= this.#connect().catch((err) => {
      this.#pool = null;
      throw err;
    });
    return this.#pool;
  }

  async #connect() {
    if (globalThis.navigator?.userAgent === 'Cloudflare-Workers') {
      throw new Error('PostgreSQL is not supported on Cloudflare. Use the D1 database from wrangler.jsonc.');
    }
    const { default: pg } = await import('pg');
    const pool = new pg.Pool({ connectionString: this.url, max: 3, idleTimeoutMillis: 30_000 });
    // A dropped idle connection is replaced on the next query.
    pool.on('error', (err) => console.warn(`[postgres] ${err.message}`));
    try {
      await pool.query(`CREATE TABLE IF NOT EXISTS ${TABLE} (
        key text PRIMARY KEY,
        version integer NOT NULL,
        data text NOT NULL,
        updated_at timestamptz NOT NULL DEFAULT now())`);
    } catch (err) {
      // Two servers creating the table at once: the other one won.
      if (err.code !== '23505' && err.code !== '42P07') {
        await pool.end().catch(() => {});
        throw err;
      }
    }
    return pool;
  }

  async #query(sql, params) {
    return (await (await this.#db()).query(sql, params)).rows;
  }

  async read(key) {
    const [row] = await this.#query(`SELECT version, data FROM ${TABLE} WHERE key = $1`, [key]);
    return row ? { data: JSON.parse(row.data), version: row.version } : null;
  }

  async readMany(keys) {
    if (!keys.length) return {};
    const rows = await this.#query(`SELECT key, data FROM ${TABLE} WHERE key = ANY($1)`, [keys]);
    return Object.fromEntries(rows.map((r) => [r.key, JSON.parse(r.data)]));
  }

  async version(key) {
    const [row] = await this.#query(`SELECT version FROM ${TABLE} WHERE key = $1`, [key]);
    return row?.version || 0;
  }

  async write(key, data, expected) {
    const json = JSON.stringify(data);
    let rows;
    if (expected === undefined) {
      rows = await this.#query(
        `INSERT INTO ${TABLE} (key, version, data) VALUES ($1, 1, $2)
         ON CONFLICT (key) DO UPDATE SET data = EXCLUDED.data, version = ${TABLE}.version + 1, updated_at = now()
         RETURNING version`,
        [key, json],
      );
    } else if (expected === 0) {
      rows = await this.#query(`INSERT INTO ${TABLE} (key, version, data) VALUES ($1, 1, $2) ON CONFLICT (key) DO NOTHING RETURNING version`, [key, json]);
    } else {
      rows = await this.#query(
        `UPDATE ${TABLE} SET data = $2, version = version + 1, updated_at = now() WHERE key = $1 AND version = $3 RETURNING version`,
        [key, json, expected],
      );
    }
    return rows[0]?.version ?? null;
  }

  async remove(key) {
    await this.#query(`DELETE FROM ${TABLE} WHERE key = $1`, [key]);
  }

  async close() {
    const pool = await this.#pool?.catch(() => null);
    this.#pool = null;
    await pool?.end();
  }
}
