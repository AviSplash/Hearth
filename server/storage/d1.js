// Cloudflare D1, the SQLite database bound to the Worker as DB in
// wrangler.jsonc. Same layout as the PostgreSQL storage: one row per
// document, and a write only lands if the version is still the one it read.

const TABLE = 'hearth_documents';

export class D1Storage {
  name = 'd1';
  label = 'Cloudflare D1';
  shared = true;
  // Workers can't share a pending query between requests, so this is a flag
  // rather than a promise. Creating the table twice is harmless.
  #ready = false;

  constructor(db) {
    this.db = db;
  }

  async #run(sql, ...params) {
    if (!this.#ready) {
      await this.db
        .prepare(`CREATE TABLE IF NOT EXISTS ${TABLE} (key TEXT PRIMARY KEY, version INTEGER NOT NULL, data TEXT NOT NULL, updated_at TEXT NOT NULL)`)
        .run();
      this.#ready = true;
    }
    return this.db.prepare(sql).bind(...params);
  }

  async read(key) {
    const row = await (await this.#run(`SELECT version, data FROM ${TABLE} WHERE key = ?`, key)).first();
    return row ? { data: JSON.parse(row.data), version: row.version } : null;
  }

  async readMany(keys) {
    const out = {};
    // D1 allows 100 bound parameters per query.
    for (let i = 0; i < keys.length; i += 50) {
      const chunk = keys.slice(i, i + 50);
      const { results } = await (await this.#run(`SELECT key, data FROM ${TABLE} WHERE key IN (${chunk.map(() => '?').join(',')})`, ...chunk)).all();
      for (const r of results) out[r.key] = JSON.parse(r.data);
    }
    return out;
  }

  async version(key) {
    const row = await (await this.#run(`SELECT version FROM ${TABLE} WHERE key = ?`, key)).first();
    return row?.version || 0;
  }

  async write(key, data, expected) {
    const json = JSON.stringify(data);
    const now = new Date().toISOString();
    let stmt;
    if (expected === undefined) {
      stmt = await this.#run(
        `INSERT INTO ${TABLE} (key, version, data, updated_at) VALUES (?, 1, ?, ?)
         ON CONFLICT (key) DO UPDATE SET data = excluded.data, version = version + 1, updated_at = excluded.updated_at
         RETURNING version`,
        key, json, now,
      );
    } else if (expected === 0) {
      stmt = await this.#run(`INSERT INTO ${TABLE} (key, version, data, updated_at) VALUES (?, 1, ?, ?) ON CONFLICT (key) DO NOTHING RETURNING version`, key, json, now);
    } else {
      stmt = await this.#run(
        `UPDATE ${TABLE} SET data = ?, version = version + 1, updated_at = ? WHERE key = ? AND version = ? RETURNING version`,
        json, now, key, expected,
      );
    }
    const row = await stmt.first();
    return row ? row.version : null;
  }

  async remove(key) {
    await (await this.#run(`DELETE FROM ${TABLE} WHERE key = ?`, key)).run();
  }
}
