import crypto from 'node:crypto';

// All household data is one small JSON document, kept by whichever storage
// is set up (see storage/index.js): a file at home, a database in the cloud.

export const newId = () => crypto.randomUUID().replace(/-/g, '').slice(0, 12);

function defaultTimezone() {
  try {
    return globalThis.process?.env?.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
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

const KEY = 'hearth';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export class Store {
  constructor(storage) {
    this.storage = storage;
  }

  async #read() {
    for (let attempt = 1; attempt <= 5; attempt++) {
      const doc = await this.storage.read(KEY);
      if (doc) {
        // Fill in any keys added in newer versions.
        const base = defaults();
        const data = { ...base, ...doc.data, settings: { ...base.settings, ...doc.data.settings } };
        return { data, version: doc.version };
      }
      const data = defaults();
      const version = await this.storage.write(KEY, data, 0);
      // Null means another server created it first; read theirs.
      if (version) return { data, version };
    }
    throw new Error(`Couldn't read or create the household data in ${this.storage.label}`);
  }

  /** The household data. Treat it as read-only and change it with update(). */
  async get() {
    return (await this.#read()).data;
  }

  /** A number that changes whenever the household data does. */
  version() {
    return this.storage.version(KEY);
  }

  /**
   * Change a copy of the data inside `fn` (which must not be async), then
   * save it. If another screen or server saved in the meantime, start again
   * from their version so neither change is lost. Returns fn's result.
   */
  async update(fn) {
    for (let attempt = 1; ; attempt++) {
      const { data: current, version } = await this.#read();
      const data = structuredClone(current);
      const result = fn(data);
      prune(data);
      if (await this.storage.write(KEY, data, version)) return result;
      if (attempt >= 12) throw new Error('Too many changes at once. Try again.');
      await sleep(Math.random() * 40 * attempt);
    }
  }
}

function prune(data) {
  // Old meal plans and chore check-offs are only useful for a while; the
  // points they earned are kept in the running ledger below.
  const cutoff = new Date(Date.now() - 120 * 86400_000).toISOString().slice(0, 10);
  for (const date of Object.keys(data.meals)) {
    if (date < cutoff) delete data.meals[date];
  }
  const old = data.completions.filter((c) => c.date < cutoff);
  if (old.length) {
    const ledger = (data.pointsLedger ||= {});
    for (const c of old) ledger[c.memberId] = (ledger[c.memberId] || 0) + (c.points || 0);
    data.completions = data.completions.filter((c) => c.date >= cutoff);
  }
  if (data.redemptions.length > 500) {
    const ledger = (data.pointsLedger ||= {});
    const drop = data.redemptions.splice(0, data.redemptions.length - 500);
    for (const r of drop) ledger[r.memberId] = (ledger[r.memberId] || 0) - (r.cost || 0);
  }
}

/** Star balance per member: everything earned minus everything spent. */
export function points(data) {
  const { completions, redemptions, members, pointsLedger = {} } = data;
  const totals = Object.fromEntries(members.map((m) => [m.id, pointsLedger[m.id] || 0]));
  for (const c of completions) if (c.memberId in totals) totals[c.memberId] += c.points || 0;
  for (const r of redemptions) if (r.memberId in totals) totals[r.memberId] -= r.cost || 0;
  return totals;
}
