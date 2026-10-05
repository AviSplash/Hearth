import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

// All household data lives in one small JSON file. Writes go to a temp file
// first and are then renamed over the original, so a power cut mid-write can
// never leave a half-written data file behind.

export const newId = () => crypto.randomUUID().replace(/-/g, '').slice(0, 12);

function defaultTimezone() {
  try {
    return process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

function defaults() {
  return {
    version: 1,
    settings: {
      householdName: 'Our Family',
      timezone: defaultTimezone(),
      timeFormat: '12h',
      weekStart: 0,
      theme: 'auto',
      units: 'imperial',
      location: null,
      idleMinutes: 3,
      nightDim: { enabled: false, from: '22:00', to: '06:00' },
      syncMinutes: 15,
      pinHash: null,
    },
    members: [],
    calendars: [],
    events: [],
    chores: [],
    completions: [],
    rewards: [],
    redemptions: [],
    lists: [
      { id: newId(), name: 'Groceries', emoji: '🛒', items: [] },
      { id: newId(), name: 'To-Do', emoji: '✅', items: [] },
    ],
    meals: {},
  };
}

export class Store {
  constructor(dataDir) {
    this.dir = dataDir;
    this.file = path.join(dataDir, 'hearth.json');
    fs.mkdirSync(dataDir, { recursive: true });
    this.data = this.#load();
  }

  #load() {
    const base = defaults();
    if (!fs.existsSync(this.file)) {
      this.#write(base);
      return base;
    }
    let parsed;
    try {
      parsed = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    } catch (err) {
      // Keep the unreadable file for inspection and start from the backup.
      const broken = `${this.file}.broken-${Date.now()}`;
      fs.copyFileSync(this.file, broken);
      console.error(`[store] ${this.file} is not valid JSON (${err.message}); saved a copy as ${broken}`);
      const bak = `${this.file}.bak`;
      parsed = fs.existsSync(bak) ? JSON.parse(fs.readFileSync(bak, 'utf8')) : base;
    }
    // Fill in any keys added in newer versions.
    const data = { ...base, ...parsed, settings: { ...base.settings, ...parsed.settings } };
    fs.copyFileSync(this.file, `${this.file}.bak`);
    return data;
  }

  #write(data) {
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    try {
      fs.renameSync(tmp, this.file);
    } catch {
      // Windows can refuse the rename while antivirus has the file open.
      fs.writeFileSync(this.file, JSON.stringify(data, null, 2));
      fs.rmSync(tmp, { force: true });
    }
  }

  get() {
    return this.data;
  }

  /** Mutate the data inside `fn`, then persist. Returns fn's result. */
  update(fn) {
    const result = fn(this.data);
    this.#prune();
    this.#write(this.data);
    return result;
  }

  #prune() {
    // Old meal plans and chore check-offs are only useful for a while; the
    // points they earned are kept in the running ledger below.
    const cutoff = new Date(Date.now() - 120 * 86400_000).toISOString().slice(0, 10);
    for (const date of Object.keys(this.data.meals)) {
      if (date < cutoff) delete this.data.meals[date];
    }
    const old = this.data.completions.filter((c) => c.date < cutoff);
    if (old.length) {
      const ledger = (this.data.pointsLedger ||= {});
      for (const c of old) ledger[c.memberId] = (ledger[c.memberId] || 0) + (c.points || 0);
      this.data.completions = this.data.completions.filter((c) => c.date >= cutoff);
    }
    if (this.data.redemptions.length > 500) {
      const ledger = (this.data.pointsLedger ||= {});
      const drop = this.data.redemptions.splice(0, this.data.redemptions.length - 500);
      for (const r of drop) ledger[r.memberId] = (ledger[r.memberId] || 0) - (r.cost || 0);
    }
  }

  /** Star balance per member: everything earned minus everything spent. */
  points() {
    const { completions, redemptions, members, pointsLedger = {} } = this.data;
    const totals = Object.fromEntries(members.map((m) => [m.id, pointsLedger[m.id] || 0]));
    for (const c of completions) if (c.memberId in totals) totals[c.memberId] += c.points || 0;
    for (const r of redemptions) if (r.memberId in totals) totals[r.memberId] -= r.cost || 0;
    return totals;
  }
}
