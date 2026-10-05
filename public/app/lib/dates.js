// Date helpers. Everything here works in the browser's local time, which on
// the wall tablet is the household's time.

export const DAY_MS = 86400_000;

export function ymd(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function fromYmd(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function startOfDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function addDays(d, n) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, d.getHours(), d.getMinutes());
}

export function addMonths(d, n) {
  return new Date(d.getFullYear(), d.getMonth() + n, 1);
}

export function startOfWeek(d, weekStart = 0) {
  const s = startOfDay(d);
  const diff = (s.getDay() - weekStart + 7) % 7;
  return addDays(s, -diff);
}

export function sameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export function isToday(d) {
  return sameDay(d, new Date());
}

export function daysBetween(a, b) {
  return Math.round((startOfDay(b) - startOfDay(a)) / DAY_MS);
}

const cache = new Map();
function fmt(options) {
  const key = JSON.stringify(options);
  if (!cache.has(key)) cache.set(key, new Intl.DateTimeFormat(undefined, options));
  return cache.get(key);
}

export function formatTime(d, settings, { short = false } = {}) {
  const h24 = settings?.timeFormat === '24h';
  if (h24) return fmt({ hour: '2-digit', minute: '2-digit', hour12: false }).format(d);
  const s = fmt({ hour: 'numeric', minute: '2-digit', hour12: true }).format(d);
  if (!short) return s;
  // "3:00 PM" -> "3pm", "3:30 PM" -> "3:30pm"
  return s.replace(':00', '').replace(/\s?([AP])\.?M\.?/i, (_, ap) => ap.toLowerCase() + 'm');
}

export function formatHour(h, settings) {
  const d = new Date(2000, 0, 1, h);
  if (settings?.timeFormat === '24h') return `${String(h).padStart(2, '0')}:00`;
  return fmt({ hour: 'numeric', hour12: true }).format(d).replace(/\s?([AP])\.?M\.?/i, (_, ap) => ap.toLowerCase() + 'm');
}

export const formatWeekday = (d, style = 'long') => fmt({ weekday: style }).format(d);
export const formatMonthYear = (d) => fmt({ month: 'long', year: 'numeric' }).format(d);
export const formatMonthDay = (d) => fmt({ month: 'long', day: 'numeric' }).format(d);
export const formatShortDate = (d) => fmt({ weekday: 'short', month: 'short', day: 'numeric' }).format(d);
export const formatLongDate = (d) => fmt({ weekday: 'long', month: 'long', day: 'numeric' }).format(d);

export function weekdayNames(weekStart = 0, style = 'short') {
  const base = new Date(2024, 0, 7); // a Sunday
  return Array.from({ length: 7 }, (_, i) => fmt({ weekday: style }).format(addDays(base, i + weekStart)));
}

// ---- events -------------------------------------------------------------

export function eventStart(ev) {
  return ev.allDay ? fromYmd(ev.start) : new Date(ev.start);
}

export function eventEnd(ev) {
  return ev.allDay ? fromYmd(ev.end) : new Date(ev.end);
}

/** Events touching the local calendar day `day`. */
export function eventsOn(events, day) {
  const s = startOfDay(day);
  const e = addDays(s, 1);
  return events.filter((ev) => {
    const a = eventStart(ev);
    const b = eventEnd(ev);
    if (ev.allDay) return a < e && b > s;
    return (a < e && b > s) || (+a === +b && a >= s && a < e);
  });
}

export function sortEvents(list) {
  return [...list].sort((a, b) => {
    if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
    return eventStart(a) - eventStart(b) || eventEnd(b) - eventEnd(a) || a.title.localeCompare(b.title);
  });
}

export function timeRange(ev, settings, day) {
  if (ev.allDay) {
    const days = daysBetween(eventStart(ev), eventEnd(ev));
    if (days > 1 && day) return `All day · day ${daysBetween(eventStart(ev), day) + 1} of ${days}`;
    return 'All day';
  }
  const a = eventStart(ev);
  const b = eventEnd(ev);
  if (+a === +b) return formatTime(a, settings);
  if (!sameDay(a, b)) {
    return `${formatShortDate(a)} ${formatTime(a, settings)} – ${formatShortDate(b)} ${formatTime(b, settings)}`;
  }
  return `${formatTime(a, settings)} – ${formatTime(b, settings)}`;
}

export function relativeDayLabel(d) {
  const diff = daysBetween(new Date(), d);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  return formatShortDate(d);
}
