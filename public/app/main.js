import { html, render, useEffect, useState } from '/vendor/preact-htm.js';
import { app, useApp, useNow, api, refreshState, refreshWeather, connectLive } from './lib/store.js';
import { Icon, navigate } from './lib/ui.js';
import { PinPad } from './components/pinpad.js';
import { TodayView } from './views/today.js';
import { CalendarView } from './views/calendar.js';
import { ChoresView } from './views/chores.js';
import { ListsView } from './views/lists.js';
import { MealsView } from './views/meals.js';
import { SettingsView } from './views/settings.js';

const PAGES = [
  ['today', 'Today', 'today', TodayView],
  ['calendar', 'Calendar', 'calendar', CalendarView],
  ['chores', 'Chores', 'chores', ChoresView],
  ['lists', 'Lists', 'lists', ListsView],
  ['meals', 'Meals', 'meals', MealsView],
  ['settings', 'Settings', 'settings', SettingsView],
];

function useRoute() {
  const [hash, setHash] = useState(location.hash);
  useEffect(() => {
    const onChange = () => setHash(location.hash);
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  const [, page = 'today', sub] = (hash || '#/today').split('/');
  return { page: PAGES.some(([k]) => k === page) ? page : 'today', sub };
}

/** After a few idle minutes, go back to Today and close any open dialogs. */
function useIdleReturn(minutes, onIdle) {
  useEffect(() => {
    if (!minutes) return undefined;
    let timer;
    const reset = () => {
      clearTimeout(timer);
      timer = setTimeout(onIdle, minutes * 60_000);
    };
    const events = ['pointerdown', 'keydown', 'wheel', 'touchstart'];
    events.forEach((e) => window.addEventListener(e, reset, { passive: true }));
    reset();
    return () => {
      clearTimeout(timer);
      events.forEach((e) => window.removeEventListener(e, reset));
    };
  }, [minutes]);
}

function useTheme(theme) {
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const dark = theme === 'dark' || (theme === 'auto' && media.matches);
      document.documentElement.dataset.theme = dark ? 'dark' : 'light';
      document.querySelector('meta[name=theme-color]')?.setAttribute('content', dark ? '#17130f' : '#f6f1ea');
      try {
        localStorage.setItem('hearth:theme', dark ? 'dark' : 'light');
      } catch {
        /* ignore */
      }
    };
    apply();
    media.addEventListener?.('change', apply);
    return () => media.removeEventListener?.('change', apply);
  }, [theme]);
}

/** Keep the screen on, where the browser allows it (needs https). */
function useWakeLock() {
  useEffect(() => {
    if (!('wakeLock' in navigator)) return undefined;
    let lock = null;
    const request = async () => {
      try {
        if (document.visibilityState === 'visible') lock = await navigator.wakeLock.request('screen');
      } catch {
        /* not allowed right now */
      }
    };
    request();
    document.addEventListener('visibilitychange', request);
    return () => {
      document.removeEventListener('visibilitychange', request);
      lock?.release?.();
    };
  }, []);
}

/** Dim the screen overnight; a tap brightens it for a minute. */
function NightDim({ settings }) {
  const now = useNow(30_000);
  const [awakeUntil, setAwakeUntil] = useState(0);
  const dim = settings?.nightDim;
  useEffect(() => {
    if (!dim?.enabled) return undefined;
    const wake = () => setAwakeUntil(Date.now() + 60_000);
    window.addEventListener('pointerdown', wake, { passive: true });
    return () => window.removeEventListener('pointerdown', wake);
  }, [dim?.enabled]);
  if (!dim?.enabled) return null;
  const minutes = now.getHours() * 60 + now.getMinutes();
  const toMin = (s) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3));
  const from = toMin(dim.from);
  const to = toMin(dim.to);
  const inWindow = from <= to ? minutes >= from && minutes < to : minutes >= from || minutes < to;
  if (!inWindow || Date.now() < awakeUntil) return null;
  return html`<div class="night-dim" aria-hidden="true"></div>`;
}

function Nav({ page }) {
  return html`<nav class="nav" aria-label="Main">
    <div class="brand" aria-hidden="true"><img src="/icons/icon.svg" alt="" width="44" height="44" /></div>
    ${PAGES.map(([key, label, icon]) => html`<a key=${key} href=${`#/${key}`} class="nav-item ${page === key ? 'on' : ''} ${key === 'settings' ? 'nav-settings' : ''}"
      aria-current=${page === key ? 'page' : undefined}>
      <span class="nav-icon"><${Icon} name=${icon} size=${26} /></span><span class="nav-label">${label}</span></a>`)}
  </nav>`;
}

function Toasts({ toasts }) {
  return html`<div class="toasts" role="status" aria-live="polite">
    ${toasts.map((t) => html`<div key=${t.id} class="toast ${t.kind}">${t.message}</div>`)}
  </div>`;
}

function GlobalPin({ request }) {
  if (!request) return null;
  const check = async (pin) => {
    try {
      const res = await api('/pin/check', { method: 'POST', body: { pin } });
      return res.ok ? null : res.error;
    } catch (err) {
      return err.message;
    }
  };
  return html`<${PinPad} reason=${request.reason} check=${check} onDone=${(pin) => request.resolve(pin)} onCancel=${() => request.resolve(null)} />`;
}

function App() {
  const state = useApp();
  const { page, sub } = useRoute();
  const [resetKey, setResetKey] = useState(0);

  useTheme(state.state?.settings.theme || 'auto');
  useWakeLock();
  useIdleReturn(state.state?.settings.idleMinutes ?? 3, () => {
    navigate('#/today');
    setResetKey((k) => k + 1);
  });

  if (!state.state) {
    return html`<div class="boot">
      <img src="/icons/icon.svg" alt="" width="88" height="88" />
      <p>${state.online ? 'Connecting to Hearth…' : 'Can’t reach the Hearth server. Retrying…'}</p>
    </div>`;
  }

  const View = PAGES.find(([k]) => k === page)[3];
  return html`<div class="shell">
    <${Nav} page=${page} />
    <main class="main">
      ${!state.online && html`<div class="offline-pill"><${Icon} name="wifi" size=${16} /> Offline · showing saved info</div>`}
      <${View} key=${`${page}-${resetKey}`} sub=${sub} />
    </main>
    <${Toasts} toasts=${state.toasts} />
    <${GlobalPin} request=${state.pinRequest} />
    <${NightDim} settings=${state.state.settings} />
  </div>`;
}

render(html`<${App} />`, document.getElementById('app'));

refreshState();
refreshWeather();
connectLive();
window.addEventListener('online', () => {
  refreshState();
  refreshWeather();
});
// Before the household data has loaded once, keep retrying.
const retry = setInterval(() => (app.state ? clearInterval(retry) : refreshState()), 4000);

if ('serviceWorker' in navigator && window.isSecureContext) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}
