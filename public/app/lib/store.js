import { useEffect, useReducer, useState, useRef } from '/vendor/preact-htm.js';

// One shared app object. Components call useApp() to re-render when it
// changes. The server pushes "something changed" over Server-Sent Events, so
// a chore checked off on a phone shows up on the wall tablet within a second.
// (In the cloud, where there can be many servers, screens poll instead.)

const CACHE_KEY = 'hearth:state';
const listeners = new Set();

function readCache() {
  try {
    return JSON.parse(localStorage.getItem(CACHE_KEY));
  } catch {
    return null;
  }
}

export const app = {
  state: readCache(),
  weather: null,
  weatherError: null,
  online: navigator.onLine,
  eventsVersion: 0,
  toasts: [],
  pinRequest: null,
  // From /api/hello: mode (home or cloud), live (sse or poll), loginRequired...
  server: null,
  needsLogin: false,
  // Set-up problems the person who deployed Hearth needs to fix.
  problems: null,
};

let version = 0;

export function emit() {
  version += 1;
  for (const fn of listeners) fn();
}

export function useApp() {
  const [, force] = useReducer((x) => x + 1, 0);
  const seen = version;
  useEffect(() => {
    listeners.add(force);
    // Catch changes that landed between rendering and subscribing.
    if (version !== seen) force();
    return () => listeners.delete(force);
  }, []);
  return app;
}

// ---- API ------------------------------------------------------------------

export class Cancelled extends Error {}

let pin = null;
let pinExpires = 0;
const PIN_MINUTES = 10;

function currentPin() {
  if (pin && Date.now() < pinExpires) return pin;
  pin = null;
  return null;
}

export function rememberPin(value) {
  pin = value;
  pinExpires = Date.now() + PIN_MINUTES * 60_000;
}

export function forgetPin() {
  pin = null;
}

/** Ask for the parent PIN; resolves with the PIN or null if cancelled. */
export function requestPin(reason) {
  return new Promise((resolve) => {
    app.pinRequest = {
      reason,
      resolve: (value) => {
        app.pinRequest = null;
        emit();
        resolve(value);
      },
    };
    emit();
  });
}

export async function api(path, { method = 'GET', body } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const p = currentPin();
  if (p) headers['X-Hearth-Pin'] = p;
  let res;
  try {
    res = await fetch(`/api${path}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  } catch {
    throw new Error("Can't reach the Hearth server. Check that it's running and you're on the same network.");
  }
  const cached = res.headers.get('X-Hearth-Offline') === '1';
  if (cached === app.online) {
    app.online = !cached;
    emit();
  }
  if (res.status === 401) {
    const err = await res.json().catch(() => ({}));
    if (err.code === 'login_required') {
      signedOut();
      throw new Cancelled('signed out');
    }
    if (err.code === 'pin_required' || err.code === 'pin_wrong') {
      forgetPin();
      const entered = await requestPin(err.code === 'pin_wrong' ? 'That PIN didn’t work' : null);
      if (!entered) throw new Cancelled('cancelled');
      rememberPin(entered);
      return api(path, { method, body });
    }
    throw new Error(err.error || 'Not allowed');
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Request failed (${res.status})`);
  }
  if (res.status === 204) return null;
  return res.json();
}

// ---- toasts ----------------------------------------------------------------

let toastId = 0;
export function toast(message, kind = 'info') {
  const id = ++toastId;
  app.toasts = [...app.toasts, { id, message, kind }];
  emit();
  setTimeout(() => {
    app.toasts = app.toasts.filter((t) => t.id !== id);
    emit();
  }, kind === 'error' ? 5000 : 2600);
}

/** Run an API action and show any error as a toast. */
export async function attempt(fn, success) {
  try {
    const result = await fn();
    if (success) toast(success, 'ok');
    return result;
  } catch (err) {
    if (!(err instanceof Cancelled)) toast(err.message, 'error');
    return undefined;
  }
}

// ---- signing in --------------------------------------------------------------

async function loadHello() {
  try {
    app.server = await api('/hello');
  } catch {
    app.online = false;
    emit();
    return false;
  }
  app.needsLogin = app.server.loginRequired && !app.server.signedIn;
  app.problems = app.server.problems?.length ? app.server.problems : null;
  emit();
  return true;
}

let live = false;

/** True until the app has loaded and is listening for changes. */
export function needsStart() {
  return !live && !app.needsLogin;
}

/** Load everything and start listening for changes, once signed in. */
export async function start() {
  if ((!app.server || app.problems) && !(await loadHello())) return false;
  if (app.needsLogin || app.problems) return false;
  refreshState();
  refreshWeather();
  if (!live) {
    live = true;
    connectLive();
  }
  return true;
}

/** Returns an error message, or null once signed in. */
export async function login(password) {
  try {
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    await api('/login', { method: 'POST', body: { password, timezone } });
  } catch (err) {
    return err.message;
  }
  app.needsLogin = false;
  emit();
  start();
  return null;
}

export async function logout() {
  await api('/logout', { method: 'POST' }).catch(() => {});
  signedOut();
}

/** Forget everything this screen saved, so nothing private stays on it. */
function signedOut() {
  forgetPin();
  app.state = null;
  app.weather = null;
  app.needsLogin = true;
  eventCache.clear();
  try {
    localStorage.removeItem(CACHE_KEY);
  } catch {
    /* ignore */
  }
  if (typeof caches !== 'undefined') {
    caches.keys().then((keys) => keys.filter((k) => k.startsWith('hearth-api')).forEach((k) => caches.delete(k))).catch(() => {});
  }
  emit();
}

// ---- loading ---------------------------------------------------------------

export async function refreshState() {
  try {
    const before = app.state?.settings;
    app.state = await api('/state');
    // Polling screens don't hear about weather changes separately.
    const after = app.state.settings;
    if (before && (before.units !== after.units || JSON.stringify(before.location) !== JSON.stringify(after.location))) {
      refreshWeather();
    }
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(app.state));
    } catch {
      /* storage full or blocked; the app still works */
    }
  } catch (err) {
    if (!(err instanceof Cancelled)) app.online = false;
  }
  emit();
}

let stateTimer = null;
function refreshStateSoon() {
  clearTimeout(stateTimer);
  stateTimer = setTimeout(refreshState, 120);
}

export async function refreshWeather() {
  try {
    app.weather = await api('/weather');
    app.weatherError = null;
  } catch (err) {
    app.weatherError = err.message;
  }
  emit();
}

export function bumpEvents() {
  app.eventsVersion += 1;
  emit();
}

/** Update local state right away (before the server confirms). */
export function patchState(fn) {
  if (!app.state) return;
  fn(app.state);
  app.state = { ...app.state };
  emit();
}

export function connectLive() {
  if (app.server?.live === 'poll') return pollForChanges(app.server.pollSeconds || 15);
  let source;
  const open = () => {
    source = new EventSource('/api/stream');
    source.addEventListener('hello', () => {
      app.online = true;
      refreshState();
      bumpEvents();
    });
    source.addEventListener('change', (e) => {
      const { scopes } = JSON.parse(e.data);
      if (scopes.some((s) => s === 'state' || s === 'calendars')) refreshStateSoon();
      if (scopes.some((s) => s === 'events' || s === 'calendars')) bumpEvents();
      if (scopes.includes('weather')) refreshWeather();
    });
    source.onerror = () => {
      if (app.online) {
        app.online = false;
        emit();
      }
    };
  };
  open();
  // Refresh weather every 15 minutes and everything else every 5 as a
  // safety net in case a push was missed.
  setInterval(refreshWeather, 15 * 60_000);
  setInterval(() => {
    refreshState();
    bumpEvents();
  }, 5 * 60_000);
}

/** Ask the server every few seconds whether anything changed. */
function pollForChanges(seconds) {
  let rev = null;
  const check = async () => {
    if (document.hidden || app.needsLogin) return;
    try {
      const res = await api('/poll');
      if (rev !== null && res.rev !== rev) {
        refreshState();
        bumpEvents();
      }
      rev = res.rev;
      if (!app.online) {
        app.online = true;
        emit();
      }
    } catch (err) {
      if (!(err instanceof Cancelled) && app.online) {
        app.online = false;
        emit();
      }
    }
  };
  // Serverless hosts have no clock of their own, so screens remind them to
  // refresh synced calendars (the server skips any that are still fresh).
  const syncCalendars = () => {
    if (!document.hidden && !app.needsLogin) api('/calendars/sync?due=1', { method: 'POST' }).catch(() => {});
  };
  check();
  syncCalendars();
  setInterval(check, seconds * 1000);
  setInterval(syncCalendars, 5 * 60_000);
  setInterval(refreshWeather, 15 * 60_000);
  document.addEventListener('visibilitychange', check);
  window.addEventListener('online', check);
}

// ---- hooks -----------------------------------------------------------------

/** Re-render every `ms` milliseconds (aligned to the minute by default). */
export function useNow(ms = 60_000) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    let timer;
    const tick = () => {
      setNow(new Date());
      const delay = ms - (Date.now() % ms) + 20;
      timer = setTimeout(tick, delay);
    };
    timer = setTimeout(tick, ms - (Date.now() % ms) + 20);
    return () => clearTimeout(timer);
  }, [ms]);
  return now;
}

const eventCache = new Map();

/** Events between two Dates, refetched whenever anything changes. */
export function useEvents(from, to) {
  const key = `${from.toISOString()}|${to.toISOString()}`;
  const { eventsVersion } = useApp();
  const [events, setEvents] = useState(() => eventCache.get(key)?.events || null);
  const latest = useRef(key);
  useEffect(() => {
    latest.current = key;
    const cached = eventCache.get(key);
    if (cached) setEvents(cached.events);
    const params = new URLSearchParams({ start: from.toISOString(), end: to.toISOString() });
    api(`/events?${params}`)
      .then((list) => {
        eventCache.set(key, { events: list, version: eventsVersion });
        if (eventCache.size > 30) eventCache.delete(eventCache.keys().next().value);
        if (latest.current === key) setEvents(list);
      })
      .catch(() => {
        if (latest.current === key && !cached) setEvents([]);
      });
  }, [key, eventsVersion]);
  return events;
}
