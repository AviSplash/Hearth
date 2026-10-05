import express from 'express';
import ICAL from 'ical.js';
import QRCode from 'qrcode';
import { newId } from './store.js';
import { broadcast, clientCount } from './bus.js';
import { parentOnly, hashPin, isValidPin, verifyPinAttempt } from './auth.js';
import { getWeather, searchPlaces } from './weather.js';
import { isValidTimezone, addDays } from './time.js';

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// ---- input cleaning ------------------------------------------------------

const text = (v, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const isYmd = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));
const isIso = (v) => typeof v === 'string' && v.length > 10 && !Number.isNaN(Date.parse(v));
const color = (v, fallback) => (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : fallback);
const intIn = (v, min, max, fallback) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};
const emoji = (v, fallback = '') => text(v, 16) || fallback;

function required(value, label) {
  if (!value) throw new HttpError(400, `${label} is required`);
  return value;
}

function find(list, id, label) {
  const item = list.find((x) => x.id === id);
  if (!item) throw new HttpError(404, `${label} not found`);
  return item;
}

function memberIds(v, data) {
  const known = new Set(data.members.map((m) => m.id));
  return Array.isArray(v) ? [...new Set(v.filter((id) => known.has(id)))] : [];
}

const PALETTE = ['#f28b82', '#fbbc6b', '#f5d565', '#8bd3a0', '#6ccfc4', '#7cb7f2', '#9b9cf2', '#c49beb', '#f29cc9', '#a0aec0'];

function cleanMember(body, existing, data) {
  const used = new Set(data.members.map((m) => m.color));
  return {
    name: required(text(body.name ?? existing?.name, 40), 'Name'),
    color: color(body.color, existing?.color || PALETTE.find((c) => !used.has(c)) || PALETTE[0]),
    emoji: body.emoji !== undefined ? emoji(body.emoji) : existing?.emoji || '',
  };
}

function cleanCalendar(body, existing) {
  const url = text(body.url, 2000);
  if (!existing && !url) throw new HttpError(400, 'Calendar link is required');
  if (url && !/^(https?|webcal):\/\//i.test(url)) throw new HttpError(400, 'The link should start with https:// or webcal://');
  return {
    name: required(text(body.name ?? existing?.name, 60), 'Name'),
    url: url || existing.url,
    color: color(body.color, existing?.color || '#7cb7f2'),
    memberId: body.memberId !== undefined ? text(body.memberId, 40) || null : existing?.memberId || null,
    enabled: body.enabled !== undefined ? !!body.enabled : existing?.enabled ?? true,
  };
}

const RRULE_OK = /^FREQ=(DAILY|WEEKLY|MONTHLY|YEARLY)(;(INTERVAL=\d{1,3}|BYDAY=[A-Z0-9,+-]{2,40}|UNTIL=\d{8}(T\d{6}Z?)?|COUNT=\d{1,4}))*$/;

function cleanEvent(body, existing, data) {
  const allDay = body.allDay !== undefined ? !!body.allDay : !!existing?.allDay;
  let start = body.start ?? existing?.start;
  let end = body.end ?? existing?.end;
  if (allDay) {
    if (!isYmd(start)) throw new HttpError(400, 'Pick a date');
    if (!isYmd(end) || end <= start) end = addDays(start, 1);
  } else {
    if (!isIso(start)) throw new HttpError(400, 'Pick a start time');
    if (!isIso(end) || Date.parse(end) < Date.parse(start)) end = new Date(Date.parse(start) + 3600_000).toISOString();
    start = new Date(start).toISOString();
    end = new Date(end).toISOString();
  }
  let rrule = body.rrule !== undefined ? text(body.rrule, 200).toUpperCase() || null : existing?.rrule || null;
  if (rrule) {
    if (!RRULE_OK.test(rrule)) throw new HttpError(400, 'Unsupported repeat rule');
    try {
      ICAL.Recur.fromString(rrule);
    } catch {
      throw new HttpError(400, 'Unsupported repeat rule');
    }
  }
  return {
    title: required(text(body.title ?? existing?.title, 200), 'Title'),
    allDay,
    start,
    end,
    rrule,
    exdates: rrule ? (existing?.exdates || []).filter(isYmd) : [],
    memberIds: body.memberIds !== undefined ? memberIds(body.memberIds, data) : existing?.memberIds || [],
    location: body.location !== undefined ? text(body.location, 300) : existing?.location || '',
    notes: body.notes !== undefined ? text(body.notes, 2000) : existing?.notes || '',
  };
}

function cleanChore(body, existing, data) {
  const s = body.schedule ?? existing?.schedule ?? { type: 'daily' };
  let schedule;
  if (s.type === 'weekly') {
    const days = [...new Set((s.days || []).map(Number).filter((d) => d >= 0 && d <= 6))].sort();
    if (!days.length) throw new HttpError(400, 'Pick at least one day');
    schedule = { type: 'weekly', days };
  } else if (s.type === 'once') {
    if (!isYmd(s.date)) throw new HttpError(400, 'Pick a date');
    schedule = { type: 'once', date: s.date };
  } else {
    schedule = { type: 'daily' };
  }
  const ids = body.memberIds !== undefined ? memberIds(body.memberIds, data) : existing?.memberIds || [];
  if (!ids.length) throw new HttpError(400, 'Assign the chore to at least one person');
  const tod = ['anytime', 'morning', 'afternoon', 'evening'];
  return {
    title: required(text(body.title ?? existing?.title, 80), 'Chore name'),
    emoji: body.emoji !== undefined ? emoji(body.emoji, '✨') : existing?.emoji || '✨',
    memberIds: ids,
    schedule,
    points: intIn(body.points ?? existing?.points, 0, 100, 1),
    timeOfDay: tod.includes(body.timeOfDay) ? body.timeOfDay : existing?.timeOfDay || 'anytime',
  };
}

function cleanReward(body, existing) {
  return {
    title: required(text(body.title ?? existing?.title, 80), 'Reward name'),
    emoji: body.emoji !== undefined ? emoji(body.emoji, '🎁') : existing?.emoji || '🎁',
    cost: intIn(body.cost ?? existing?.cost, 1, 10000, 10),
  };
}

function cleanSettings(body, current) {
  const next = { ...current };
  if (body.householdName !== undefined) next.householdName = text(body.householdName, 60) || 'Our Family';
  if (body.timezone !== undefined) {
    if (!isValidTimezone(body.timezone)) throw new HttpError(400, 'Unknown timezone');
    next.timezone = body.timezone;
  }
  if (body.timeFormat !== undefined) next.timeFormat = body.timeFormat === '24h' ? '24h' : '12h';
  if (body.weekStart !== undefined) next.weekStart = Number(body.weekStart) === 1 ? 1 : 0;
  if (body.theme !== undefined) next.theme = ['light', 'dark', 'auto'].includes(body.theme) ? body.theme : 'auto';
  if (body.units !== undefined) next.units = body.units === 'metric' ? 'metric' : 'imperial';
  if (body.idleMinutes !== undefined) next.idleMinutes = intIn(body.idleMinutes, 0, 120, 3);
  if (body.syncMinutes !== undefined) next.syncMinutes = intIn(body.syncMinutes, 5, 1440, 15);
  if (body.nightDim !== undefined) {
    const hhmm = (v, fallback) => (typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v) ? v : fallback);
    const cur = current.nightDim || {};
    next.nightDim = {
      enabled: body.nightDim.enabled !== undefined ? !!body.nightDim.enabled : !!cur.enabled,
      from: hhmm(body.nightDim.from, cur.from || '22:00'),
      to: hhmm(body.nightDim.to, cur.to || '06:00'),
    };
  }
  if (body.location !== undefined) {
    const l = body.location;
    if (l === null) next.location = null;
    else {
      const lat = Number(l.lat);
      const lon = Number(l.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
        throw new HttpError(400, 'Invalid location');
      }
      next.location = { name: text(l.name, 100) || 'Home', lat, lon };
      if (isValidTimezone(l.timezone)) next.timezone = l.timezone;
    }
  }
  return next;
}

// ---- views sent to the browser -------------------------------------------

function publicCalendar(c) {
  let urlHint = '';
  try {
    const u = new URL(c.url.replace(/^webcal:/i, 'https:'));
    urlHint = u.hostname;
  } catch {
    urlHint = 'custom link';
  }
  const { url, ...rest } = c;
  return { ...rest, urlHint };
}

function statePayload(store) {
  const d = store.get();
  const { pinHash, ...settings } = d.settings;
  const recent = new Date(Date.now() - 45 * 86400_000).toISOString().slice(0, 10);
  return {
    settings: { ...settings, hasPin: !!pinHash },
    members: d.members,
    calendars: d.calendars.map(publicCalendar),
    chores: d.chores,
    completions: d.completions.filter((c) => c.date >= recent),
    rewards: d.rewards,
    redemptions: d.redemptions.slice(-30),
    points: store.points(),
    lists: d.lists,
    meals: d.meals,
    serverTime: new Date().toISOString(),
  };
}

// ---- routes ---------------------------------------------------------------

export function createApi({ store, sync, system }) {
  const api = express.Router();
  const parent = parentOnly(store);

  const mutate = (scopes, fn) => {
    const result = store.update(fn);
    broadcast(scopes);
    return result;
  };

  api.get('/state', (req, res) => res.json(statePayload(store)));

  api.get('/events', (req, res) => {
    const from = Date.parse(req.query.start);
    const to = Date.parse(req.query.end);
    if (Number.isNaN(from) || Number.isNaN(to) || to < from) throw new HttpError(400, 'start and end are required');
    if (to - from > 120 * 86400_000) throw new HttpError(400, 'Range too large');
    res.json(sync.eventsBetween(from, to));
  });

  // Household events
  api.get('/events/:id', (req, res) => {
    res.json(find(store.get().events, req.params.id, 'Event'));
  });

  api.post('/events', (req, res) => {
    const ev = mutate(['events'], (d) => {
      const item = { id: newId(), ...cleanEvent(req.body, null, d), createdAt: new Date().toISOString() };
      d.events.push(item);
      return item;
    });
    res.status(201).json(ev);
  });

  api.put('/events/:id', (req, res) => {
    const ev = mutate(['events'], (d) => {
      const item = find(d.events, req.params.id, 'Event');
      Object.assign(item, cleanEvent(req.body, item, d));
      return item;
    });
    res.json(ev);
  });

  api.delete('/events/:id', (req, res) => {
    const occurrence = req.query.occurrence;
    mutate(['events'], (d) => {
      const item = find(d.events, req.params.id, 'Event');
      if (occurrence && isYmd(occurrence) && item.rrule) {
        item.exdates = [...new Set([...(item.exdates || []), occurrence])];
      } else {
        d.events = d.events.filter((e) => e.id !== item.id);
      }
    });
    res.status(204).end();
  });

  // Family members
  api.post('/members', parent, (req, res) => {
    const m = mutate(['state'], (d) => {
      const item = { id: newId(), ...cleanMember(req.body, null, d) };
      d.members.push(item);
      return item;
    });
    res.status(201).json(m);
  });

  api.put('/members/:id', parent, (req, res) => {
    const m = mutate(['state', 'events'], (d) => {
      const item = find(d.members, req.params.id, 'Person');
      Object.assign(item, cleanMember(req.body, item, d));
      return item;
    });
    res.json(m);
  });

  api.delete('/members/:id', parent, (req, res) => {
    mutate(['state', 'events'], (d) => {
      const id = find(d.members, req.params.id, 'Person').id;
      d.members = d.members.filter((m) => m.id !== id);
      for (const c of d.chores) c.memberIds = c.memberIds.filter((x) => x !== id);
      d.chores = d.chores.filter((c) => c.memberIds.length);
      for (const e of d.events) e.memberIds = (e.memberIds || []).filter((x) => x !== id);
      for (const c of d.calendars) if (c.memberId === id) c.memberId = null;
      d.completions = d.completions.filter((c) => c.memberId !== id);
    });
    res.status(204).end();
  });

  api.post('/members/reorder', parent, (req, res) => {
    const order = Array.isArray(req.body.ids) ? req.body.ids : [];
    mutate(['state'], (d) => {
      d.members.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
    });
    res.status(204).end();
  });

  // Synced calendars (iCal links)
  api.post('/calendars', parent, async (req, res) => {
    const cal = mutate(['calendars'], (d) => {
      const item = { id: newId(), ...cleanCalendar(req.body, null), lastSync: null, lastError: null, eventCount: 0 };
      d.calendars.push(item);
      return item;
    });
    await sync.sync(cal.id);
    res.status(201).json(publicCalendar(store.get().calendars.find((c) => c.id === cal.id)));
  });

  api.put('/calendars/:id', parent, async (req, res) => {
    let urlChanged = false;
    const cal = mutate(['calendars', 'events'], (d) => {
      const item = find(d.calendars, req.params.id, 'Calendar');
      const next = cleanCalendar(req.body, item);
      urlChanged = next.url !== item.url;
      Object.assign(item, next);
      return item;
    });
    if (urlChanged) await sync.sync(cal.id);
    res.json(publicCalendar(store.get().calendars.find((c) => c.id === cal.id)));
  });

  api.delete('/calendars/:id', parent, (req, res) => {
    mutate(['calendars', 'events'], (d) => {
      find(d.calendars, req.params.id, 'Calendar');
      d.calendars = d.calendars.filter((c) => c.id !== req.params.id);
    });
    sync.forget(req.params.id);
    res.status(204).end();
  });

  api.post('/calendars/:id/sync', async (req, res) => {
    find(store.get().calendars, req.params.id, 'Calendar');
    await sync.sync(req.params.id);
    res.json(publicCalendar(store.get().calendars.find((c) => c.id === req.params.id)));
  });

  api.post('/calendars/sync', async (req, res) => {
    await sync.syncAll();
    res.status(204).end();
  });

  // Chores
  api.post('/chores', parent, (req, res) => {
    const chore = mutate(['state'], (d) => {
      const item = { id: newId(), ...cleanChore(req.body, null, d), createdAt: new Date().toISOString() };
      d.chores.push(item);
      return item;
    });
    res.status(201).json(chore);
  });

  api.put('/chores/:id', parent, (req, res) => {
    const chore = mutate(['state'], (d) => {
      const item = find(d.chores, req.params.id, 'Chore');
      Object.assign(item, cleanChore(req.body, item, d));
      return item;
    });
    res.json(chore);
  });

  api.delete('/chores/:id', parent, (req, res) => {
    mutate(['state'], (d) => {
      find(d.chores, req.params.id, 'Chore');
      d.chores = d.chores.filter((c) => c.id !== req.params.id);
    });
    res.status(204).end();
  });

  api.post('/chores/:id/toggle', (req, res) => {
    const { memberId, date } = req.body;
    if (!isYmd(date)) throw new HttpError(400, 'date is required');
    const done = mutate(['state'], (d) => {
      const chore = find(d.chores, req.params.id, 'Chore');
      if (!chore.memberIds.includes(memberId)) throw new HttpError(400, 'That chore is not assigned to this person');
      const idx = d.completions.findIndex((c) => c.choreId === chore.id && c.memberId === memberId && c.date === date);
      if (idx >= 0) {
        d.completions.splice(idx, 1);
        return false;
      }
      d.completions.push({ id: newId(), choreId: chore.id, memberId, date, points: chore.points, at: new Date().toISOString() });
      return true;
    });
    res.json({ done, points: store.points() });
  });

  // Rewards
  api.post('/rewards', parent, (req, res) => {
    const r = mutate(['state'], (d) => {
      const item = { id: newId(), ...cleanReward(req.body, null) };
      d.rewards.push(item);
      return item;
    });
    res.status(201).json(r);
  });

  api.put('/rewards/:id', parent, (req, res) => {
    const r = mutate(['state'], (d) => {
      const item = find(d.rewards, req.params.id, 'Reward');
      Object.assign(item, cleanReward(req.body, item));
      return item;
    });
    res.json(r);
  });

  api.delete('/rewards/:id', parent, (req, res) => {
    mutate(['state'], (d) => {
      find(d.rewards, req.params.id, 'Reward');
      d.rewards = d.rewards.filter((r) => r.id !== req.params.id);
    });
    res.status(204).end();
  });

  api.post('/rewards/:id/redeem', parent, (req, res) => {
    const result = mutate(['state'], (d) => {
      const reward = find(d.rewards, req.params.id, 'Reward');
      const member = find(d.members, req.body.memberId, 'Person');
      const balance = store.points()[member.id] || 0;
      if (balance < reward.cost) throw new HttpError(400, `${member.name} needs ${reward.cost - balance} more stars`);
      const entry = {
        id: newId(),
        rewardId: reward.id,
        title: reward.title,
        emoji: reward.emoji,
        memberId: member.id,
        cost: reward.cost,
        at: new Date().toISOString(),
      };
      d.redemptions.push(entry);
      return entry;
    });
    res.status(201).json(result);
  });

  // Lists
  api.post('/lists', (req, res) => {
    const list = mutate(['state'], (d) => {
      const item = { id: newId(), name: required(text(req.body.name, 60), 'List name'), emoji: emoji(req.body.emoji, '📝'), items: [] };
      d.lists.push(item);
      return item;
    });
    res.status(201).json(list);
  });

  api.put('/lists/:id', (req, res) => {
    const list = mutate(['state'], (d) => {
      const item = find(d.lists, req.params.id, 'List');
      if (req.body.name !== undefined) item.name = required(text(req.body.name, 60), 'List name');
      if (req.body.emoji !== undefined) item.emoji = emoji(req.body.emoji, '📝');
      return item;
    });
    res.json(list);
  });

  api.delete('/lists/:id', (req, res) => {
    mutate(['state'], (d) => {
      find(d.lists, req.params.id, 'List');
      d.lists = d.lists.filter((l) => l.id !== req.params.id);
    });
    res.status(204).end();
  });

  api.post('/lists/:id/items', (req, res) => {
    const item = mutate(['state'], (d) => {
      const list = find(d.lists, req.params.id, 'List');
      const entry = { id: newId(), text: required(text(req.body.text, 200), 'Item'), done: false, at: new Date().toISOString() };
      list.items.unshift(entry);
      return entry;
    });
    res.status(201).json(item);
  });

  api.put('/lists/:id/items/:itemId', (req, res) => {
    const item = mutate(['state'], (d) => {
      const list = find(d.lists, req.params.id, 'List');
      const entry = find(list.items, req.params.itemId, 'Item');
      if (req.body.text !== undefined) entry.text = required(text(req.body.text, 200), 'Item');
      if (req.body.done !== undefined) {
        entry.done = !!req.body.done;
        entry.doneAt = entry.done ? new Date().toISOString() : null;
      }
      return entry;
    });
    res.json(item);
  });

  api.delete('/lists/:id/items/:itemId', (req, res) => {
    mutate(['state'], (d) => {
      const list = find(d.lists, req.params.id, 'List');
      list.items = list.items.filter((i) => i.id !== req.params.itemId);
    });
    res.status(204).end();
  });

  api.post('/lists/:id/clear-done', (req, res) => {
    mutate(['state'], (d) => {
      const list = find(d.lists, req.params.id, 'List');
      list.items = list.items.filter((i) => !i.done);
    });
    res.status(204).end();
  });

  // Meals
  const MEALS = ['breakfast', 'lunch', 'dinner', 'snack'];
  api.put('/meals/:date', (req, res) => {
    if (!isYmd(req.params.date)) throw new HttpError(400, 'Invalid date');
    const day = mutate(['state'], (d) => {
      const entry = { ...(d.meals[req.params.date] || {}) };
      for (const m of MEALS) if (req.body[m] !== undefined) entry[m] = text(req.body[m], 120);
      const empty = MEALS.every((m) => !entry[m]);
      if (empty) delete d.meals[req.params.date];
      else d.meals[req.params.date] = entry;
      return entry;
    });
    res.json(day);
  });

  // Settings & PIN
  api.put('/settings', parent, (req, res) => {
    const before = store.get().settings;
    mutate(['state', 'weather'], (d) => {
      d.settings = cleanSettings(req.body, d.settings);
    });
    if (before.timezone !== store.get().settings.timezone) sync.syncAll();
    res.json(statePayload(store).settings);
  });

  api.post('/pin/check', (req, res) => {
    const stored = store.get().settings.pinHash;
    if (!stored) return res.json({ ok: true });
    const result = verifyPinAttempt(String(req.body.pin || ''), stored);
    if (!result.ok) return res.json({ ok: false, error: result.locked ? 'Too many tries. Wait 30 seconds.' : 'Wrong PIN' });
    res.json({ ok: true });
  });

  api.put('/pin', parent, (req, res) => {
    const next = req.body.pin;
    if (next !== null && !isValidPin(next)) throw new HttpError(400, 'PIN must be 4 to 8 digits');
    mutate(['state'], (d) => {
      d.settings.pinHash = next ? hashPin(next) : null;
    });
    res.status(204).end();
  });

  // Weather
  api.get('/weather', async (req, res) => {
    const { location, units } = store.get().settings;
    if (!location) return res.json(null);
    try {
      res.json(await getWeather(location, units));
    } catch (err) {
      throw new HttpError(502, `Weather unavailable: ${err.message}`);
    }
  });

  api.get('/places', async (req, res) => {
    const q = text(req.query.q, 100);
    if (q.length < 2) return res.json([]);
    try {
      res.json(await searchPlaces(q));
    } catch (err) {
      throw new HttpError(502, err.message);
    }
  });

  // Connection info for the "Connect a device" screen
  api.get('/system', (req, res) => {
    res.json({ ...system(), devicesConnected: clientCount() });
  });

  api.get('/qr.svg', async (req, res) => {
    const value = text(req.query.text, 300);
    if (!value) throw new HttpError(400, 'text is required');
    const svg = await QRCode.toString(value, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' });
    res.type('image/svg+xml').set('Cache-Control', 'max-age=86400').send(svg);
  });

  api.use((req, res) => res.status(404).json({ error: 'Not found' }));

  // eslint-disable-next-line no-unused-vars
  api.use((err, req, res, next) => {
    const status = err.status || (err.type === 'entity.parse.failed' ? 400 : 500);
    if (status >= 500) console.error('[api]', err);
    res.status(status).json({ error: err.message || 'Something went wrong' });
  });

  return api;
}
