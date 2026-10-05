// Timezone helpers built on Intl, so they work the same on Windows, Linux and
// inside Docker (where the system clock is usually UTC).

const formatters = new Map();

function formatter(tz) {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(tz, f);
  }
  return f;
}

export function isValidTimezone(tz) {
  if (!tz || typeof tz !== 'string') return false;
  try {
    formatter(tz);
    return true;
  } catch {
    return false;
  }
}

/** Wall-clock parts of a UTC instant in `tz` (month is 1-based). */
export function utcToWall(ms, tz) {
  const parts = {};
  for (const p of formatter(tz).formatToParts(new Date(ms))) parts[p.type] = Number(p.value);
  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: parts.hour,
    minute: parts.minute,
    second: parts.second,
  };
}

function offsetAt(ms, tz) {
  const w = utcToWall(ms, tz);
  const asUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
  return asUtc - Math.floor(ms / 1000) * 1000;
}

/** UTC instant for a wall-clock time in `tz` (month is 1-based). */
export function wallToUtc(year, month, day, hour, minute, second, tz) {
  const guess = Date.UTC(year, month - 1, day, hour, minute, second);
  const first = offsetAt(guess, tz);
  const candidate = guess - first;
  const second_ = offsetAt(candidate, tz);
  return second_ === first ? candidate : guess - second_;
}

export function ymd(year, month, day) {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function parseYmd(s) {
  const [y, m, d] = s.split('-').map(Number);
  return { year: y, month: m, day: d };
}

/** Midnight at the start of a YYYY-MM-DD date in `tz`, as UTC ms. */
export function dateStartMs(s, tz) {
  const { year, month, day } = parseYmd(s);
  return wallToUtc(year, month, day, 0, 0, 0, tz);
}

export function addDays(s, n) {
  const { year, month, day } = parseYmd(s);
  const d = new Date(Date.UTC(year, month - 1, day + n));
  return ymd(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

// Outlook / Exchange feeds name zones the Windows way. These cover the zones
// most households live in; anything else falls back to the feed's own
// VTIMEZONE definition.
const WINDOWS_ZONES = {
  'Dateline Standard Time': 'Etc/GMT+12',
  'Hawaiian Standard Time': 'Pacific/Honolulu',
  'Alaskan Standard Time': 'America/Anchorage',
  'Pacific Standard Time': 'America/Los_Angeles',
  'Pacific Standard Time (Mexico)': 'America/Tijuana',
  'US Mountain Standard Time': 'America/Phoenix',
  'Mountain Standard Time': 'America/Denver',
  'Mountain Standard Time (Mexico)': 'America/Mazatlan',
  'Central Standard Time': 'America/Chicago',
  'Central Standard Time (Mexico)': 'America/Mexico_City',
  'Canada Central Standard Time': 'America/Regina',
  'Central America Standard Time': 'America/Guatemala',
  'Eastern Standard Time': 'America/New_York',
  'US Eastern Standard Time': 'America/Indianapolis',
  'Eastern Standard Time (Mexico)': 'America/Cancun',
  'SA Pacific Standard Time': 'America/Bogota',
  'Atlantic Standard Time': 'America/Halifax',
  'Newfoundland Standard Time': 'America/St_Johns',
  'E. South America Standard Time': 'America/Sao_Paulo',
  'Argentina Standard Time': 'America/Buenos_Aires',
  UTC: 'UTC',
  'GMT Standard Time': 'Europe/London',
  'Greenwich Standard Time': 'Atlantic/Reykjavik',
  'W. Europe Standard Time': 'Europe/Berlin',
  'Romance Standard Time': 'Europe/Paris',
  'Central Europe Standard Time': 'Europe/Budapest',
  'Central European Standard Time': 'Europe/Warsaw',
  'E. Europe Standard Time': 'Europe/Chisinau',
  'FLE Standard Time': 'Europe/Kiev',
  'GTB Standard Time': 'Europe/Bucharest',
  'Russian Standard Time': 'Europe/Moscow',
  'Israel Standard Time': 'Asia/Jerusalem',
  'South Africa Standard Time': 'Africa/Johannesburg',
  'Arabian Standard Time': 'Asia/Dubai',
  'India Standard Time': 'Asia/Kolkata',
  'SE Asia Standard Time': 'Asia/Bangkok',
  'Singapore Standard Time': 'Asia/Singapore',
  'China Standard Time': 'Asia/Shanghai',
  'Taipei Standard Time': 'Asia/Taipei',
  'Tokyo Standard Time': 'Asia/Tokyo',
  'Korea Standard Time': 'Asia/Seoul',
  'W. Australia Standard Time': 'Australia/Perth',
  'Cen. Australia Standard Time': 'Australia/Adelaide',
  'AUS Central Standard Time': 'Australia/Darwin',
  'E. Australia Standard Time': 'Australia/Brisbane',
  'AUS Eastern Standard Time': 'Australia/Sydney',
  'Tasmania Standard Time': 'Australia/Hobart',
  'New Zealand Standard Time': 'Pacific/Auckland',
};

/** Map a TZID from a calendar feed to an IANA zone, or null if unknown. */
export function toIanaZone(tzid) {
  if (!tzid) return null;
  const clean = String(tzid).replace(/^"|"$/g, '').trim();
  if (WINDOWS_ZONES[clean]) return WINDOWS_ZONES[clean];
  if (isValidTimezone(clean)) return clean;
  // e.g. "/mozilla.org/20050126_1/America/New_York"
  const tail = clean.split('/').slice(-2).join('/');
  if (isValidTimezone(tail)) return tail;
  return null;
}
