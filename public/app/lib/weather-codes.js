// WMO weather interpretation codes, as returned by Open-Meteo.

const CODES = {
  0: ['Clear', '☀️', '🌙'],
  1: ['Mostly clear', '🌤️', '🌙'],
  2: ['Partly cloudy', '⛅', '☁️'],
  3: ['Cloudy', '☁️', '☁️'],
  45: ['Fog', '🌫️', '🌫️'],
  48: ['Freezing fog', '🌫️', '🌫️'],
  51: ['Light drizzle', '🌦️', '🌧️'],
  53: ['Drizzle', '🌦️', '🌧️'],
  55: ['Heavy drizzle', '🌧️', '🌧️'],
  56: ['Freezing drizzle', '🌧️', '🌧️'],
  57: ['Freezing drizzle', '🌧️', '🌧️'],
  61: ['Light rain', '🌦️', '🌧️'],
  63: ['Rain', '🌧️', '🌧️'],
  65: ['Heavy rain', '🌧️', '🌧️'],
  66: ['Freezing rain', '🌧️', '🌧️'],
  67: ['Freezing rain', '🌧️', '🌧️'],
  71: ['Light snow', '🌨️', '🌨️'],
  73: ['Snow', '🌨️', '🌨️'],
  75: ['Heavy snow', '❄️', '❄️'],
  77: ['Snow grains', '🌨️', '🌨️'],
  80: ['Showers', '🌦️', '🌧️'],
  81: ['Showers', '🌧️', '🌧️'],
  82: ['Heavy showers', '⛈️', '⛈️'],
  85: ['Snow showers', '🌨️', '🌨️'],
  86: ['Snow showers', '❄️', '❄️'],
  95: ['Thunderstorms', '⛈️', '⛈️'],
  96: ['Thunderstorms, hail', '⛈️', '⛈️'],
  99: ['Thunderstorms, hail', '⛈️', '⛈️'],
};

export function describeWeather(code, isDay = true) {
  const [label, day, night] = CODES[code] || ['—', '🌡️', '🌡️'];
  return { label, icon: isDay ? day : night };
}
