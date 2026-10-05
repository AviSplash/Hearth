import { test } from 'node:test';
import assert from 'node:assert/strict';
import { expandIcs, expandLocal } from '../server/calendar.js';

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
