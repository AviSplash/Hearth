import fs from 'node:fs';
import path from 'node:path';

// Documents live as JSON files in the data folder: "hearth" is hearth.json
// and "calendars/<id>" is calendars/<id>.json. Writes go to a temp file first
// and are then renamed over the original, so a power cut mid-write can never
// leave a half-written file behind. This process is the only writer, so each
// document is kept in memory after it is first read.

// Household data gets a .bak copy and pretty-printing (people edit it by
// hand, e.g. to reset the PIN). Calendar caches can always be downloaded again.
const PRECIOUS = new Set(['hearth']);

export class FileStorage {
  name = 'file';
  label = 'files in the data folder';
  shared = false;
  #docs = new Map();

  constructor(dir) {
    this.dir = dir;
    // Private to the account running Hearth: it holds the PIN hash and the
    // secret calendar links. (Ignored on Windows.)
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    this.#migrateCalendarCache();
  }

  #file(key) {
    if (!/^[a-z]+(\/[\w-]+)?$/.test(key)) throw new Error(`Bad storage key: ${key}`);
    return path.join(this.dir, `${key}.json`);
  }

  #load(key) {
    if (this.#docs.has(key)) return this.#docs.get(key);
    const file = this.#file(key);
    let doc = null;
    if (fs.existsSync(file)) {
      try {
        doc = { data: JSON.parse(fs.readFileSync(file, 'utf8')), version: 1 };
        if (PRECIOUS.has(key)) fs.copyFileSync(file, `${file}.bak`);
      } catch (err) {
        // Keep the unreadable file for inspection and start from the backup.
        const broken = `${file}.broken-${Date.now()}`;
        fs.copyFileSync(file, broken);
        console.error(`[store] ${file} is not valid JSON (${err.message}); saved a copy as ${broken}`);
        const bak = `${file}.bak`;
        if (fs.existsSync(bak)) doc = { data: JSON.parse(fs.readFileSync(bak, 'utf8')), version: 1 };
      }
    }
    this.#docs.set(key, doc);
    return doc;
  }

  #put(key, data) {
    const file = this.#file(key);
    const text = PRECIOUS.has(key) ? JSON.stringify(data, null, 2) : JSON.stringify(data);
    const tmp = `${file}.tmp`;
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    fs.writeFileSync(tmp, text, { mode: 0o600 });
    try {
      fs.renameSync(tmp, file);
    } catch {
      // Windows can refuse the rename while antivirus has the file open.
      fs.writeFileSync(file, text);
      fs.rmSync(tmp, { force: true });
    }
    const version = (this.#docs.get(key)?.version || 0) + 1;
    this.#docs.set(key, { data, version });
    return version;
  }

  #migrateCalendarCache() {
    // Hearth 1.0 kept every synced calendar in one calendar-cache.json.
    const old = path.join(this.dir, 'calendar-cache.json');
    if (!fs.existsSync(old)) return;
    try {
      for (const [id, entry] of Object.entries(JSON.parse(fs.readFileSync(old, 'utf8')))) {
        if (/^[\w-]+$/.test(id)) this.#put(`calendars/${id}`, entry);
      }
    } catch {
      // It's only a cache; the next sync downloads the calendars again.
    }
    fs.rmSync(old, { force: true });
  }

  async read(key) {
    return this.#load(key);
  }

  async readMany(keys) {
    const out = {};
    for (const key of keys) {
      const doc = this.#load(key);
      if (doc) out[key] = doc.data;
    }
    return out;
  }

  async version(key) {
    return this.#load(key)?.version || 0;
  }

  async write(key, data, expected) {
    if (expected !== undefined && expected !== ((this.#load(key)?.version) || 0)) return null;
    return this.#put(key, data);
  }

  async remove(key) {
    fs.rmSync(this.#file(key), { force: true });
    this.#docs.set(key, null);
  }
}
