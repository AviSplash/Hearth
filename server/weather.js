// Weather comes from Open-Meteo: free, no API key, no account. Results are
// cached so a dozen screens refreshing doesn't hammer the service, and the
// last good forecast is served if the internet drops.

const TTL_MS = 15 * 60_000;
const cache = new Map();

export async function getWeather(location, units) {
  if (!location) return null;
  const key = `${location.lat},${location.lon},${units}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.data;

  const imperial = units !== 'metric';
  const params = new URLSearchParams({
    latitude: String(location.lat),
    longitude: String(location.lon),
    current: 'temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,is_day,wind_speed_10m,precipitation',
    hourly: 'temperature_2m,weather_code,precipitation_probability,is_day',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset,uv_index_max',
    timezone: 'auto',
    forecast_days: '7',
    temperature_unit: imperial ? 'fahrenheit' : 'celsius',
    wind_speed_unit: imperial ? 'mph' : 'kmh',
    precipitation_unit: imperial ? 'inch' : 'mm',
  });

  try {
    const res = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`, {
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`Open-Meteo answered ${res.status}`);
    const raw = await res.json();
    const data = shape(raw, location, imperial);
    cache.set(key, { at: Date.now(), data });
    return data;
  } catch (err) {
    if (hit) return { ...hit.data, stale: true };
    throw err;
  }
}

function shape(raw, location, imperial) {
  const { current, hourly, daily } = raw;
  // Open-Meteo returns local wall times ("2026-10-05T14:00") for the
  // location; pair them with the UTC offset so the browser can compare.
  const offset = raw.utc_offset_seconds || 0;
  const toIso = (local) => new Date(Date.parse(`${local}:00Z`) - offset * 1000).toISOString();
  const nowMs = Date.now();

  const hours = [];
  for (let i = 0; i < hourly.time.length && hours.length < 24; i++) {
    const at = toIso(hourly.time[i]);
    if (Date.parse(at) < nowMs - 3600_000) continue;
    hours.push({
      time: at,
      temp: Math.round(hourly.temperature_2m[i]),
      code: hourly.weather_code[i],
      precip: hourly.precipitation_probability?.[i] ?? null,
      isDay: !!hourly.is_day?.[i],
    });
  }

  const days = daily.time.map((date, i) => ({
    date,
    code: daily.weather_code[i],
    high: Math.round(daily.temperature_2m_max[i]),
    low: Math.round(daily.temperature_2m_min[i]),
    precip: daily.precipitation_probability_max?.[i] ?? null,
    sunrise: daily.sunrise?.[i] ? toIso(daily.sunrise[i]) : null,
    sunset: daily.sunset?.[i] ? toIso(daily.sunset[i]) : null,
    uv: daily.uv_index_max?.[i] ?? null,
  }));

  return {
    location: location.name,
    units: imperial ? { temp: '°F', wind: 'mph' } : { temp: '°C', wind: 'km/h' },
    fetchedAt: new Date().toISOString(),
    current: {
      temp: Math.round(current.temperature_2m),
      feelsLike: Math.round(current.apparent_temperature),
      humidity: current.relative_humidity_2m,
      wind: Math.round(current.wind_speed_10m),
      code: current.weather_code,
      isDay: !!current.is_day,
    },
    hours,
    days,
  };
}

export async function searchPlaces(query) {
  // The geocoder matches place names only, so "Austin, TX" searches for
  // "Austin" and uses "TX" to rank the results.
  const [name, ...rest] = query.split(',').map((s) => s.trim());
  const hint = rest.join(' ').toLowerCase();
  const params = new URLSearchParams({ name, count: hint ? '20' : '8', language: 'en', format: 'json' });
  const res = await fetch(`https://geocoding-api.open-meteo.com/v1/search?${params}`, {
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Place search failed (${res.status})`);
  const body = await res.json();
  const places = (body.results || []).map((r) => ({
    name: r.name,
    region: [r.admin1, r.country].filter(Boolean).join(', '),
    code: [r.admin1, r.country_code, r.country].filter(Boolean).join(' ').toLowerCase(),
    lat: r.latitude,
    lon: r.longitude,
    timezone: r.timezone,
  }));
  if (hint) {
    const score = (p) => {
      const words = new Set(p.code.split(/\s+/));
      return hint.split(/\s+/).filter((w) => words.has(w) || abbreviation(p.region) === w).length;
    };
    places.sort((a, b) => score(b) - score(a));
  }
  return places.slice(0, 8).map(({ code, ...p }) => p);
}

const US_STATES = {
  alabama: 'al', alaska: 'ak', arizona: 'az', arkansas: 'ar', california: 'ca', colorado: 'co',
  connecticut: 'ct', delaware: 'de', florida: 'fl', georgia: 'ga', hawaii: 'hi', idaho: 'id',
  illinois: 'il', indiana: 'in', iowa: 'ia', kansas: 'ks', kentucky: 'ky', louisiana: 'la',
  maine: 'me', maryland: 'md', massachusetts: 'ma', michigan: 'mi', minnesota: 'mn',
  mississippi: 'ms', missouri: 'mo', montana: 'mt', nebraska: 'ne', nevada: 'nv',
  'new hampshire': 'nh', 'new jersey': 'nj', 'new mexico': 'nm', 'new york': 'ny',
  'north carolina': 'nc', 'north dakota': 'nd', ohio: 'oh', oklahoma: 'ok', oregon: 'or',
  pennsylvania: 'pa', 'rhode island': 'ri', 'south carolina': 'sc', 'south dakota': 'sd',
  tennessee: 'tn', texas: 'tx', utah: 'ut', vermont: 'vt', virginia: 'va', washington: 'wa',
  'west virginia': 'wv', wisconsin: 'wi', wyoming: 'wy',
};

function abbreviation(region) {
  return US_STATES[region.split(',')[0].trim().toLowerCase()] || '';
}
