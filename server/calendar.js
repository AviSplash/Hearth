import ICAL from 'ical.js';
import { broadcast } from './bus.js';
import { fetchPublic } from './safe-fetch.js';
import { VERSION } from './version.js';
import { toIanaZone, utcToWall, wallToUtc, ymd, dateStartMs, addDays, isValidTimezone } from './time.js';

// Calendar sync works with the iCal (.ics) links that Google Calendar,
// Outlook/Microsoft 365, iCloud and most other services can publish. Feeds
// are downloaded on a schedule, recurring events are expanded into a window
// around today, and the result is cached in storage so the wall display keeps
// working while the internet is down.

const PAST_DAYS = 90;
const FUTURE_DAYS = 400;
const MAX_ITERATIONS = 50_000;
const MAX_NOTES = 2000;

function householdTz(data) {
  const tz = data.settings.timezone;
  return isValidTimezone(tz) ? tz : 'UTC';
}

const cacheKey = (id) => `calendars/${id}`;
const ms = (iso) => (iso ? Date.parse(iso) || 0 : 0);

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
  /** `guard` refuses links into private networks (for servers on the internet). */
  constructor(store, { guard = false } = {}) {
    this.store = store;
    this.storage = store.storage;
    this.guard = guard;
    // Within one long-running server, don't download the same calendar twice
    // at once. With shared storage the claim in syncDue() does this job (and
    // Workers can't share a pending download between requests anyway).
    this.running = store.storage.shared ? null : new Map();
  }

  /** For long-running servers: every minute, sync the calendars that are due. */
  start() {
    const tick = () => {
      this.syncDue()
        .catch((err) => console.warn(`[calendar] ${err.message}`))
        .finally(() => {
          this.timer = setTimeout(tick, 60_000);
          this.timer.unref?.();
        });
    };
    tick();
  }

  stop() {
    clearTimeout(this.timer);
  }

  async syncAll() {
    const calendars = (await this.store.get()).calendars.filter((c) => c.enabled !== false);
    await Promise.allSettled(calendars.map((c) => this.sync(c.id)));
  }

  /**
   * Sync the calendars nobody has tried for `syncMinutes`. Each one is
   * claimed first, so other screens and servers asking at the same moment
   * leave it alone. Returns how many were synced.
   */
  async syncDue(now = Date.now()) {
    const due = (d) => {
      const minutes = Math.max(5, Number(d.settings.syncMinutes) || 15);
      return d.calendars.filter((c) => c.enabled !== false && now - Math.max(ms(c.lastSync), ms(c.lastAttempt)) >= minutes * 60_000);
    };
    if (!due(await this.store.get()).length) return 0;
    const claimed = await this.store.update((d) => {
      const at = new Date(now).toISOString();
      return due(d).map((c) => {
        c.lastAttempt = at;
        return c.id;
      });
    });
    await Promise.allSettled(claimed.map((id) => this.sync(id)));
    return claimed.length;
  }

  sync(id) {
    if (!this.running) return this.#sync(id);
    if (this.running.has(id)) return this.running.get(id);
    const job = this.#sync(id).finally(() => this.running.delete(id));
    this.running.set(id, job);
    return job;
  }

  async #sync(id) {
    const data = await this.store.get();
    const cal = data.calendars.find((c) => c.id === id);
    if (!cal) return;
    const tz = householdTz(data);
    const now = Date.now();
    let result;
    try {
      const url = cal.url.trim().replace(/^webcal:\/\//i, 'https://');
      const res = await fetchPublic(url, {
        headers: { 'User-Agent': `Hearth/${VERSION} (family calendar)`, Accept: 'text/calendar, */*' },
        signal: AbortSignal.timeout(30_000),
      }, { guard: this.guard });
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
      await this.storage.write(cacheKey(id), { syncedAt: new Date().toISOString(), events });
      result = { lastSync: new Date().toISOString(), lastError: null, eventCount: events.length };
    } catch (err) {
      const message = err.name === 'TimeoutError' ? 'Timed out downloading the calendar' : err.message;
      result = { lastError: message, lastAttempt: new Date().toISOString() };
      console.warn(`[calendar] ${cal.name}: ${message}`);
    }
    const stillThere = await this.store.update((d) => {
      const c = d.calendars.find((x) => x.id === id);
      if (c) Object.assign(c, result);
      return !!c;
    });
    // Removed while it was downloading.
    if (!stillThere) await this.forget(id);
    broadcast(['events', 'calendars']);
  }

  forget(id) {
    return this.storage.remove(cacheKey(id));
  }

  /** All events (synced + household) overlapping [from, to]. */
  async eventsBetween(from, to) {
    const data = await this.store.get();
    const tz = householdTz(data);
    const enabled = data.calendars.filter((c) => c.enabled !== false).map((c) => cacheKey(c.id));
    const cache = await this.storage.readMany(enabled);
    const out = [];
    for (const entry of Object.values(cache)) {
      for (const ev of entry.events) {
        if (toMs(ev.end, tz) >= from && toMs(ev.start, tz) < to) out.push(ev);
      }
    }
    out.push(...expandLocal(data.events, { tz, from, to }));
    out.sort((a, b) => toMs(a.start, tz) - toMs(b.start, tz) || (b.allDay ? 1 : 0) - (a.allDay ? 1 : 0));
    return out;
  }
}
