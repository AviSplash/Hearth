import { test } from 'node:test';
import assert from 'node:assert/strict';
import { expandIcs, expandLocal, CalendarSync } from '../server/calendar.js';
import { Store } from '../server/store.js';
import { MemoryStorage } from './helpers/fakes.js';

const OUTLOOK = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:Microsoft Exchange Server 2010
BEGIN:VTIMEZONE
TZID:Central Standard Time
BEGIN:STANDARD
DTSTART:16010101T020000
TZOFFSETFROM:-0500
TZOFFSETTO:-0600
RRULE:FREQ=YEARLY;INTERVAL=1;BYDAY=1SU;BYMONTH=11
END:STANDARD
BEGIN:DAYLIGHT
DTSTART:16010101T020000
TZOFFSETFROM:-0600
TZOFFSETTO:-0500
RRULE:FREQ=YEARLY;INTERVAL=1;BYDAY=2SU;BYMONTH=3
END:DAYLIGHT
END:VTIMEZONE
BEGIN:VEVENT
UID:standup
SUMMARY:Standup
DTSTART;TZID=Central Standard Time:20260901T093000
DTEND;TZID=Central Standard Time:20260901T094500
RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR
EXDATE;TZID=Central Standard Time:20261006T093000
END:VEVENT
BEGIN:VEVENT
UID:standup
RECURRENCE-ID;TZID=Central Standard Time:20261007T093000
SUMMARY:Standup (moved)
DTSTART;TZID=Central Standard Time:20261007T110000
DTEND;TZID=Central Standard Time:20261007T111500
END:VEVENT
BEGIN:VEVENT
UID:gone
SUMMARY:Cancelled
STATUS:CANCELLED
DTSTART;TZID=Central Standard Time:20261005T120000
DTEND;TZID=Central Standard Time:20261005T130000
END:VEVENT
BEGIN:VEVENT
UID:trip
SUMMARY:Trip
DTSTART;VALUE=DATE:20261009
DTEND;VALUE=DATE:20261012
END:VEVENT
END:VCALENDAR`;

const window = { calendarId: 'c', tz: 'America/Chicago', from: Date.parse('2026-10-05T00:00:00Z'), to: Date.parse('2026-10-10T00:00:00Z') };

test('Outlook feed: Windows time zone, EXDATE, moved and cancelled occurrences', () => {
  const events = expandIcs(OUTLOOK, window);
  const standups = events.filter((e) => e.title.startsWith('Standup')).map((e) => [e.start, e.title]);
  assert.deepEqual(standups, [
    ['2026-10-05T14:30:00.000Z', 'Standup'],
    ['2026-10-07T16:00:00.000Z', 'Standup (moved)'],
    ['2026-10-08T14:30:00.000Z', 'Standup'],
    ['2026-10-09T14:30:00.000Z', 'Standup'],
  ]);
  assert.equal(events.some((e) => e.title === 'Cancelled'), false);
  const trip = events.find((e) => e.title === 'Trip');
  assert.deepEqual([trip.start, trip.end, trip.allDay], ['2026-10-09', '2026-10-12', true]);
});

test('IANA TZID without a VTIMEZONE block still lands at the right instant', () => {
  const ics = `BEGIN:VCALENDAR
BEGIN:VEVENT
UID:x
SUMMARY:Practice
DTSTART;TZID=America/New_York:20261105T170000
DTEND;TZID=America/New_York:20261105T180000
END:VEVENT
END:VCALENDAR`;
  const [ev] = expandIcs(ics, { ...window, from: Date.parse('2026-11-01T00:00:00Z'), to: Date.parse('2026-11-10T00:00:00Z') });
  // After the DST change New York is UTC-5.
  assert.equal(ev.start, '2026-11-05T22:00:00.000Z');
});

test('household repeating events keep their wall-clock time across DST', () => {
  const events = [{
    id: 'e1', title: 'Swim', allDay: false,
    start: '2026-10-26T22:00:00.000Z', end: '2026-10-26T23:00:00.000Z', // 5pm CDT
    rrule: 'FREQ=WEEKLY', exdates: ['2026-11-09'], memberIds: [],
  }];
  const out = expandLocal(events, { tz: 'America/Chicago', from: Date.parse('2026-10-20T00:00:00Z'), to: Date.parse('2026-11-20T00:00:00Z') });
  assert.deepEqual(out.map((e) => e.start), [
    '2026-10-26T22:00:00.000Z',
    '2026-11-02T23:00:00.000Z', // 5pm CST
    '2026-11-16T23:00:00.000Z',
  ]);
  assert.equal(out[0].seriesId, 'e1');
  assert.equal(out[1].occurrence, '2026-11-02');
});

test('all-day repeating events expand by date', () => {
  const events = [{ id: 't', title: 'Trash', allDay: true, start: '2026-10-06', end: '2026-10-07', rrule: 'FREQ=WEEKLY', memberIds: [] }];
  const out = expandLocal(events, { tz: 'America/Chicago', from: Date.parse('2026-10-05T05:00:00Z'), to: Date.parse('2026-10-19T05:00:00Z') });
  assert.deepEqual(out.map((e) => [e.start, e.end]), [['2026-10-06', '2026-10-07'], ['2026-10-13', '2026-10-14']]);
});

test('due calendars are claimed, so two servers asking at once download each feed once', async () => {
  const storage = new MemoryStorage();
  const store = new Store(storage);
  await store.update((d) => {
    d.calendars.push({ id: 'c1', name: 'School', url: 'https://example.com/a.ics', enabled: true, lastSync: null });
  });
  const real = globalThis.fetch;
  let downloads = 0;
  globalThis.fetch = async () => {
    downloads += 1;
    return new Response(OUTLOOK);
  };
  try {
    const serverA = new CalendarSync(new Store(storage));
    const serverB = new CalendarSync(new Store(storage));
    const [a, b] = await Promise.all([serverA.syncDue(), serverB.syncDue()]);
    assert.equal(a + b, 1);
    assert.equal(downloads, 1);
    const cal = (await store.get()).calendars[0];
    assert.equal(cal.lastError, null);
    assert.ok(cal.eventCount > 0);
    assert.ok((await serverA.eventsBetween(window.from, window.to)).some((e) => e.title === 'Standup'));
    // Fresh now, so nothing is due until syncMinutes pass.
    assert.equal(await serverA.syncDue(), 0);
    assert.equal(await serverA.syncDue(Date.now() + 16 * 60_000), 1);
    assert.equal(downloads, 2);
  } finally {
    globalThis.fetch = real;
  }
});
