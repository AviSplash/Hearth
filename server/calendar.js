import fs from 'node:fs';
import path from 'node:path';
import ICAL from 'ical.js';
import { broadcast } from './bus.js';
import { toIanaZone, utcToWall, wallToUtc, ymd, dateStartMs, addDays, isValidTimezone } from './time.js';

// Calendar sync works with the iCal (.ics) links that Google Calendar,
// Outlook/Microsoft 365, iCloud and most other services can publish. Feeds
// are downloaded on a schedule, recurring events are expanded into a window
// around today, and the result is cached on disk so the wall display keeps
// working while the internet is down.

const PAST_DAYS = 90;
const FUTURE_DAYS = 400;
const MAX_ITERATIONS = 50_000;
const MAX_NOTES = 2000;

function householdTz(store) {
  const tz = store.get().settings.timezone;
  return isValidTimezone(tz) ? tz : 'UTC';
}

function timeToValue(t, tzid, fallbackTz) {
  if (t.isDate) return ymd(t.year, t.month, t.day);
  const zoneId = t.zone?.tzid;
  if (zoneId === 'UTC' || zoneId === 'Z' || zoneId === 'GMT') {
    return new Date(Date.UTC(t.year, t.month - 1, t.day, t.hour, t.minute, t.second)).toISOString();
  }
  const iana = toIanaZone(zoneId !== 'floating' ? zoneId : null) || toIanaZone(tzid);
  if (iana) return new Date(wallToUtc(t.year, t.month, t.day, t.hour, t.minute, t.second, iana)).toISOString();
  if (t.zone && t.zone.component) return new Date(t.toUnixTime() * 1000).toISOString();
  return new Date(wallToUtc(t.year, t.month, t.day, t.hour, t.minute, t.second, fallbackTz)).toISOString();
}

function propTzid(component, name) {
  return component.getFirstProperty(name)?.getParameter('tzid') || null;
}

function toMs(value, tz) {
  return value.length === 10 ? dateStartMs(value, tz) : Date.parse(value);
}

function cleanText(s, max = 500) {
  if (!s) return '';
  return String(s).replace(/\r/g, '').trim().slice(0, max);
}

/** Parse ICS text into a flat list of event occurrences inside the window. */
export function expandIcs(text, { calendarId, tz, from, to }) {
  const root = new ICAL.Component(ICAL.parse(text));
  const vevents = root.getAllSubcomponents('vevent');
  const masters = new Map();
  const orphans = [];
  const exceptions = [];

  for (const ve of vevents) {
    const ev = new ICAL.Event(ve);
    if (!ev.startDate) continue;
    if (ev.isRecurrenceException()) exceptions.push(ev);
    else masters.set(ev.uid || `${masters.size}`, ev);
  }
  for (const ex of exceptions) {
    const master = masters.get(ex.uid);
    if (master) master.relateException(ex);
    else orphans.push(ex);
  }

  const out = [];
  const push = (item, start, end) => {
    if ((item.component.getFirstPropertyValue('status') || '').toUpperCase() === 'CANCELLED') return;
    const comp = item.component;
    const startTz = propTzid(comp, 'dtstart');
    const endTz = propTzid(comp, 'dtend') || startTz;
    const allDay = start.isDate;
    const s = timeToValue(start, startTz, tz);
    let e = end ? timeToValue(end, endTz, tz) : null;
    if (allDay) {
      if (!e || e.length !== 10 || e <= s) e = addDays(s, 1);
    } else if (!e || e.length === 10 || e < s) {
      e = s;
    }
    const startMs = toMs(s, tz);
    const endMs = toMs(e, tz);
    if (endMs < from || startMs > to) return;
    if (endMs === startMs && startMs < from) return;
    out.push({
      id: `${calendarId}:${item.uid}:${s}`,
      calendarId,
      title: cleanText(item.summary, 300) || '(No title)',
      start: s,
      end: e,
      allDay,
      location: cleanText(item.location, 300),
      notes: cleanText(item.description, MAX_NOTES),
    });
  };

  for (const ev of [...masters.values(), ...orphans]) {
    if (!ev.isRecurring()) {
      push(ev, ev.startDate, ev.endDate);
      continue;
    }
    const it = ev.iterator();
    let next;
    let guard = 0;
    while ((next = it.next()) && guard++ < MAX_ITERATIONS) {
      const details = ev.getOccurrenceDetails(next);
      const startValue = timeToValue(details.startDate, propTzid(details.item.component, 'dtstart'), tz);
      if (toMs(startValue, tz) > to) break;
      push(details.item, details.startDate, details.endDate);
    }
  }
  return out;
}

/** Expand the household's own events (which may repeat) into a range. */
export function expandLocal(events, { tz, from, to }) {
  const out = [];
  for (const ev of events) {
    const base = {
      seriesId: ev.id,
      calendarId: null,
      title: ev.title,
      allDay: !!ev.allDay,
      memberIds: ev.memberIds || [],
      location: ev.location || '',
      notes: ev.notes || '',
      rrule: ev.rrule || null,
    };
    const startMs = toMs(ev.start, tz);
    const endMs = toMs(ev.end, tz);

    if (!ev.rrule) {
      if (endMs >= from && startMs < to) out.push({ ...base, id: ev.id, start: ev.start, end: ev.end });
      continue;
    }

    let dtstart;
    let durationMs = Math.max(0, endMs - startMs);
    let durationDays = 1;
    if (ev.allDay) {
      dtstart = ICAL.Time.fromDateString(ev.start);
      durationDays = Math.max(1, Math.round((Date.parse(ev.end) - Date.parse(ev.start)) / 86400_000));
    } else {
      const w = utcToWall(startMs, tz);
      dtstart = new ICAL.Time({ ...w, isDate: false });
    }

    let recur;
    try {
      recur = ICAL.Recur.fromString(ev.rrule);
    } catch {
      continue;
    }
    const skip = new Set(ev.exdates || []);
    const it = recur.iterator(dtstart);
    let next;
    let guard = 0;
    while ((next = it.next()) && guard++ < MAX_ITERATIONS) {
      const dateKey = ymd(next.year, next.month, next.day);
      let s;
      let e;
      if (ev.allDay) {
        s = dateKey;
        e = addDays(dateKey, durationDays);
      } else {
        const ms = wallToUtc(next.year, next.month, next.day, next.hour, next.minute, next.second, tz);
        s = new Date(ms).toISOString();
        e = new Date(ms + durationMs).toISOString();
      }
      const sMs = toMs(s, tz);
      if (sMs >= to) break;
      if (skip.has(dateKey) || toMs(e, tz) < from) continue;
      out.push({ ...base, id: `${ev.id}:${dateKey}`, occurrence: dateKey, start: s, end: e });
    }
  }
  return out;
}

export class CalendarSync {
  constructor(store, dataDir) {
    this.store = store;
    this.file = path.join(dataDir, 'calendar-cache.json');
    this.cache = {};
    this.running = new Map();
    try {
      this.cache = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    } catch {
      this.cache = {};
    }
  }

  #save() {
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.cache), { mode: 0o600 });
    try {
      fs.renameSync(tmp, this.file);
    } catch {
      fs.writeFileSync(this.file, JSON.stringify(this.cache));
    }
  }

  start() {
    const tick = () => {
      const minutes = Math.max(5, Number(this.store.get().settings.syncMinutes) || 15);
      this.syncAll().finally(() => {
        this.timer = setTimeout(tick, minutes * 60_000);
        this.timer.unref?.();
      });
    };
    tick();
  }

  async syncAll() {
    const calendars = this.store.get().calendars.filter((c) => c.enabled !== false);
    await Promise.allSettled(calendars.map((c) => this.sync(c.id)));
  }

  sync(id) {
    if (this.running.has(id)) return this.running.get(id);
    const job = this.#sync(id).finally(() => this.running.delete(id));
    this.running.set(id, job);
    return job;
  }

  async #sync(id) {
    const cal = this.store.get().calendars.find((c) => c.id === id);
    if (!cal) return;
    const tz = householdTz(this.store);
    const now = Date.now();
    let result;
    try {
      const url = cal.url.trim().replace(/^webcal:\/\//i, 'https://');
      const res = await fetch(url, {
        headers: { 'User-Agent': 'Hearth/1.0 (family calendar)', Accept: 'text/calendar, */*' },
        signal: AbortSignal.timeout(30_000),
        redirect: 'follow',
      });
      if (!res.ok) throw new Error(`The calendar server answered ${res.status} ${res.statusText}`.trim());
      const text = await res.text();
      if (!text.includes('BEGIN:VCALENDAR')) {
        throw new Error('That link did not return calendar data. Use the iCal / .ics link, not the web page link.');
      }
      const events = expandIcs(text, {
        calendarId: id,
        tz,
        from: now - PAST_DAYS * 86400_000,
        to: now + FUTURE_DAYS * 86400_000,
      });
      this.cache[id] = { syncedAt: new Date().toISOString(), events };
      this.#save();
      result = { lastSync: new Date().toISOString(), lastError: null, eventCount: events.length };
    } catch (err) {
      const message = err.name === 'TimeoutError' ? 'Timed out downloading the calendar' : err.message;
      result = { lastError: message, lastAttempt: new Date().toISOString() };
      console.warn(`[calendar] ${cal.name}: ${message}`);
    }
    this.store.update((d) => {
      const c = d.calendars.find((x) => x.id === id);
      if (c) Object.assign(c, result);
    });
    broadcast(['events', 'calendars']);
  }

  forget(id) {
    delete this.cache[id];
    this.#save();
  }

  /** All events (synced + household) overlapping [from, to]. */
  eventsBetween(from, to) {
    const data = this.store.get();
    const tz = householdTz(this.store);
    const enabled = new Set(data.calendars.filter((c) => c.enabled !== false).map((c) => c.id));
    const out = [];
    for (const [calId, entry] of Object.entries(this.cache)) {
      if (!enabled.has(calId)) continue;
      for (const ev of entry.events) {
        if (toMs(ev.end, tz) >= from && toMs(ev.start, tz) < to) out.push(ev);
      }
    }
    out.push(...expandLocal(data.events, { tz, from, to }));
    out.sort((a, b) => toMs(a.start, tz) - toMs(b.start, tz) || (b.allDay ? 1 : 0) - (a.allDay ? 1 : 0));
    return out;
  }
}
