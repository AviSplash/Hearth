import { html, useState, useEffect, useRef } from '/vendor/preact-htm.js';
import { useApp, api, attempt, toast, refreshState, refreshWeather, rememberPin, forgetPin } from '../lib/store.js';
import { Icon, Avatar, Modal, Segmented, ColorPicker, EmojiPicker, Toggle, Empty, colorVars, navigate, PALETTE } from '../lib/ui.js';
import { PinPad } from '../components/pinpad.js';

const SECTIONS = [
  ['general', 'General', 'home'],
  ['family', 'Family', 'users'],
  ['calendars', 'Calendars', 'calendar'],
  ['weather', 'Weather', 'cloud'],
  ['devices', 'Connect devices', 'monitor'],
  ['security', 'Parent PIN', 'lock'],
];

async function saveSettings(patch, message = 'Saved') {
  const ok = await attempt(() => api('/settings', { method: 'PUT', body: patch }), message);
  if (ok) await refreshState();
  return ok;
}

function ago(iso) {
  if (!iso) return 'never';
  const mins = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const h = Math.round(mins / 60);
  if (h < 24) return `${h} hr ago`;
  return new Date(iso).toLocaleDateString();
}

// ---- general -----------------------------------------------------------------

function General({ settings }) {
  const [name, setName] = useState(settings.householdName);
  const zones = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [settings.timezone];
  return html`<div class="settings-section">
    <label class="field"><span>Household name</span>
      <input class="input" value=${name} maxlength="60" onInput=${(e) => setName(e.target.value)}
        onBlur=${() => name.trim() && name !== settings.householdName && saveSettings({ householdName: name })} /></label>
    <div class="field"><span>Clock</span>
      <${Segmented} value=${settings.timeFormat} onChange=${(v) => saveSettings({ timeFormat: v })} options=${[['12h', '12-hour'], ['24h', '24-hour']]} /></div>
    <div class="field"><span>Week starts on</span>
      <${Segmented} value=${String(settings.weekStart)} onChange=${(v) => saveSettings({ weekStart: Number(v) })} options=${[['0', 'Sunday'], ['1', 'Monday']]} /></div>
    <div class="field"><span>Appearance</span>
      <${Segmented} value=${settings.theme} onChange=${(v) => saveSettings({ theme: v })} options=${[['auto', 'Auto'], ['light', 'Light'], ['dark', 'Dark']]} />
      <small class="muted">Auto follows the device’s light/dark setting.</small></div>
    <label class="field"><span>Go back to Today when nobody has touched the screen for</span>
      <select class="input" value=${String(settings.idleMinutes)} onChange=${(e) => saveSettings({ idleMinutes: Number(e.target.value) })}>
        ${[[0, 'Never'], [1, '1 minute'], [3, '3 minutes'], [5, '5 minutes'], [10, '10 minutes'], [30, '30 minutes']].map(([v, l]) => html`<option value=${v}>${l}</option>`)}
      </select></label>
    <div class="field"><span>Dim the screen at night</span>
      <div class="row">
        <${Toggle} checked=${!!settings.nightDim?.enabled} onChange=${(v) => saveSettings({ nightDim: { enabled: v } })} />
        ${settings.nightDim?.enabled && html`
          <label class="inline-field compact">from
            <input type="time" class="input" value=${settings.nightDim.from} onChange=${(e) => saveSettings({ nightDim: { from: e.target.value } })} /></label>
          <label class="inline-field compact">to
            <input type="time" class="input" value=${settings.nightDim.to} onChange=${(e) => saveSettings({ nightDim: { to: e.target.value } })} /></label>`}
      </div>
      <small class="muted">Tap the screen to brighten it for a minute.</small></div>
    <label class="field"><span>Time zone</span>
      <select class="input" value=${settings.timezone} onChange=${(e) => saveSettings({ timezone: e.target.value })}>
        ${zones.map((z) => html`<option value=${z}>${z.replace(/_/g, ' ')}</option>`)}
      </select>
      <small class="muted">Used for recurring events and calendar feeds without a time zone.</small></label>
  </div>`;
}

// ---- family ------------------------------------------------------------------

const PEOPLE_EMOJI = ['', '👩', '👨', '👧', '👦', '🧒', '👶', '👵', '👴', '🧑', '🐶', '🐱', '🦊', '🐻', '🦄', '🐼'];

function MemberEditor({ member, used, onClose }) {
  const [name, setName] = useState(member?.name || '');
  const [emoji, setEmoji] = useState(member?.emoji || '');
  const [color, setColor] = useState(member?.color || PALETTE.find((c) => !used.includes(c)) || PALETTE[0]);
  const [confirming, setConfirming] = useState(false);
  const preview = { name: name || '?', emoji, color };

  const save = async (e) => {
    e?.preventDefault();
    if (!name.trim()) return;
    const ok = await attempt(() => api(member ? `/members/${member.id}` : '/members', { method: member ? 'PUT' : 'POST', body: { name, emoji, color } }), member ? 'Saved' : `Welcome, ${name}!`);
    if (ok) {
      await refreshState();
      onClose();
    }
  };
  const remove = async () => {
    const ok = await attempt(() => api(`/members/${member.id}`, { method: 'DELETE' }), 'Removed');
    if (ok !== undefined) {
      await refreshState();
      onClose();
    }
  };

  return html`<${Modal} title=${member ? 'Edit person' : 'Add a person'} onClose=${onClose}
    footer=${confirming
      ? html`<span class="grow muted">Remove ${member.name}? Their chores go too.</span>
        <button class="btn ghost" onClick=${() => setConfirming(false)}>Keep</button>
        <button class="btn danger" onClick=${remove}>Remove</button>`
      : html`${member && html`<button class="btn ghost danger" onClick=${() => setConfirming(true)}><${Icon} name="trash" size=${20} /></button>`}
        <span class="grow"></span>
        <button class="btn ghost" onClick=${onClose}>Cancel</button>
        <button class="btn primary" disabled=${!name.trim()} onClick=${save}>${member ? 'Save' : 'Add'}</button>`}>
    <form class="form" onSubmit=${save}>
      <div class="title-with-emoji"><${Avatar} member=${preview} size=${56} />
        <input class="input big" placeholder="Name" value=${name} autofocus maxlength="40" onInput=${(e) => setName(e.target.value)} /></div>
      <div class="field"><span>Color</span><${ColorPicker} value=${color} onChange=${setColor} /></div>
      <div class="field"><span>Picture <small class="muted">(blank shows their initial)</small></span>
        <${EmojiPicker} value=${emoji} choices=${PEOPLE_EMOJI} onChange=${setEmoji} /></div>
    </form>
  </${Modal}>`;
}

function Family({ state }) {
  const [editing, setEditing] = useState(null);
  return html`<div class="settings-section">
    <p class="muted">Everyone gets a color. Their events, chores and stars use it.</p>
    <div class="row-list">
      ${state.members.map((m) => html`<button key=${m.id} class="row-item" style=${colorVars(m.color)} onClick=${() => setEditing({ member: m })}>
        <${Avatar} member=${m} size=${44} /><span class="grow"><b>${m.name}</b></span>
        <span class="muted small">${state.chores.filter((c) => c.memberIds.includes(m.id)).length} chores · ${state.points[m.id] || 0}⭐</span>
        <${Icon} name="edit" size=${18} /></button>`)}
    </div>
    <button class="btn primary" onClick=${() => setEditing({ member: null })}><${Icon} name="plus" size=${20} /> Add person</button>
    ${editing && html`<${MemberEditor} member=${editing.member} used=${state.members.map((m) => m.color)} onClose=${() => setEditing(null)} />`}
  </div>`;
}

// ---- calendars -------------------------------------------------------------------

function CalendarHelp() {
  const [open, setOpen] = useState(null);
  const item = (key, title, steps) => html`<div class="help ${open === key ? 'open' : ''}">
    <button type="button" class="help-head" onClick=${() => setOpen(open === key ? null : key)}>${title}<${Icon} name="right" size=${18} /></button>
    ${open === key && html`<ol>${steps.map((s) => html`<li>${s}</li>`)}</ol>`}
  </div>`;
  return html`<div class="help-list">
    ${item('google', 'Where do I find my Google Calendar link?', [
      'On a computer, open calendar.google.com.',
      'Hover the calendar under “My calendars”, click ⋮ → Settings and sharing.',
      'Scroll to “Integrate calendar”.',
      'Copy “Secret address in iCal format” (ends in .ics) and paste it here.',
    ])}
    ${item('outlook', 'Where do I find my Outlook / Microsoft 365 link?', [
      'Open outlook.com (or Outlook on the web for work/school) → Settings ⚙ → Calendar → Shared calendars.',
      'Under “Publish a calendar”, pick the calendar and “Can view all details”, then Publish.',
      'Copy the ICS link and paste it here.',
    ])}
    ${item('icloud', 'Apple iCloud calendar?', [
      'In the Calendar app on iPhone, tap Calendars → ⓘ next to the calendar.',
      'Turn on Public Calendar and tap Share Link → Copy. Paste it here (webcal:// links work).',
    ])}
  </div>`;
}

function CalendarEditor({ calendar, state, onClose }) {
  const [form, setForm] = useState({
    name: calendar?.name || '',
    url: '',
    color: calendar?.color || '#7cb7f2',
    memberId: calendar?.memberId || '',
    enabled: calendar?.enabled ?? true,
  });
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const set = (p) => setForm((f) => ({ ...f, ...p }));
  const valid = form.name.trim() && (calendar || form.url.trim());

  const save = async (e) => {
    e?.preventDefault();
    if (!valid) return;
    setSaving(true);
    const body = { ...form, memberId: form.memberId || null };
    if (!body.url) delete body.url;
    const result = await attempt(() => api(calendar ? `/calendars/${calendar.id}` : '/calendars', { method: calendar ? 'PUT' : 'POST', body }));
    setSaving(false);
    if (result) {
      await refreshState();
      if (result.lastError) toast(`Saved, but the calendar couldn’t be downloaded: ${result.lastError}`, 'error');
      else toast(calendar ? 'Calendar saved' : `Added ${result.eventCount} events`, 'ok');
      onClose();
    }
  };
  const remove = async () => {
    const ok = await attempt(() => api(`/calendars/${calendar.id}`, { method: 'DELETE' }), 'Calendar removed');
    if (ok !== undefined) {
      await refreshState();
      onClose();
    }
  };

  return html`<${Modal} title=${calendar ? 'Edit calendar' : 'Add a calendar'} onClose=${onClose} wide
    footer=${confirming
      ? html`<span class="grow muted">Stop syncing “${calendar.name}”?</span>
        <button class="btn ghost" onClick=${() => setConfirming(false)}>Keep</button>
        <button class="btn danger" onClick=${remove}>Remove</button>`
      : html`${calendar && html`<button class="btn ghost danger" onClick=${() => setConfirming(true)}><${Icon} name="trash" size=${20} /></button>`}
        <span class="grow"></span>
        <button class="btn ghost" onClick=${onClose}>Cancel</button>
        <button class="btn primary" disabled=${!valid || saving} onClick=${save}>${saving ? 'Syncing…' : calendar ? 'Save' : 'Add & sync'}</button>`}>
    <form class="form" onSubmit=${save}>
      <label class="field"><span>Name</span>
        <input class="input" placeholder="e.g. Mom’s work, Soccer, Family" value=${form.name} autofocus maxlength="60" onInput=${(e) => set({ name: e.target.value })} /></label>
      <label class="field"><span>Calendar link (iCal / .ics)</span>
        <textarea class="input mono" rows="2" placeholder=${calendar ? `Leave blank to keep the current link (${calendar.urlHint})` : 'https://calendar.google.com/calendar/ical/…/basic.ics'}
          value=${form.url} onInput=${(e) => set({ url: e.target.value.trim() })}></textarea></label>
      <${CalendarHelp} />
      <div class="field"><span>Whose calendar is it?</span>
        <select class="input" value=${form.memberId} onChange=${(e) => set({ memberId: e.target.value })}>
          <option value="">Everyone / shared</option>
          ${state.members.map((m) => html`<option value=${m.id}>${m.name}</option>`)}
        </select>
        <small class="muted">Events show in that person’s color. Shared calendars use the color below.</small></div>
      ${!form.memberId && html`<div class="field"><span>Color</span><${ColorPicker} value=${form.color} onChange=${(c) => set({ color: c })} /></div>`}
      ${calendar && html`<${Toggle} checked=${form.enabled} onChange=${(v) => set({ enabled: v })} label="Show this calendar" />`}
    </form>
  </${Modal}>`;
}

function Calendars({ state }) {
  const [editing, setEditing] = useState(null);
  const [syncing, setSyncing] = useState(null);
  const syncOne = async (id) => {
    setSyncing(id);
    await attempt(() => api(`/calendars/${id}/sync`, { method: 'POST' }));
    await refreshState();
    setSyncing(null);
  };
  const owner = (c) => state.members.find((m) => m.id === c.memberId);
  return html`<div class="settings-section">
    <p class="muted">Hearth reads your Google, Outlook or iCloud calendars through their private iCal links and refreshes them every few minutes. Events you add on this screen are saved in Hearth.</p>
    <div class="row-list">
      ${!state.calendars.length && html`<${Empty} icon="📅" title="No calendars connected yet" />`}
      ${state.calendars.map((c) => {
        const m = owner(c);
        return html`<div key=${c.id} class="row-item static ${c.enabled === false ? 'disabled' : ''}" style=${colorVars(m?.color || c.color)}>
          ${m ? html`<${Avatar} member=${m} size=${40} />` : html`<span class="cal-dot"></span>`}
          <span class="grow">
            <b>${c.name}</b>
            <small class=${c.lastError ? 'error-text' : 'muted'}>
              ${c.lastError ? `⚠ ${c.lastError}` : `${c.urlHint} · synced ${ago(c.lastSync)} · ${c.eventCount || 0} events`}
            </small>
          </span>
          <button class="icon-btn" onClick=${() => syncOne(c.id)} aria-label="Sync now" disabled=${syncing === c.id}>
            <${Icon} name="refresh" size=${20} class=${syncing === c.id ? 'spin' : ''} /></button>
          <button class="icon-btn" onClick=${() => setEditing({ calendar: c })} aria-label="Edit"><${Icon} name="edit" size=${20} /></button>
        </div>`;
      })}
    </div>
    <div class="row">
      <button class="btn primary" onClick=${() => setEditing({ calendar: null })}><${Icon} name="plus" size=${20} /> Add calendar</button>
      <label class="inline-field">Check for changes every
        <select class="input" value=${String(state.settings.syncMinutes)} onChange=${(e) => saveSettings({ syncMinutes: Number(e.target.value) })}>
          ${[5, 10, 15, 30, 60].map((v) => html`<option value=${v}>${v} min</option>`)}
        </select></label>
    </div>
    ${editing && html`<${CalendarEditor} calendar=${editing.calendar} state=${state} onClose=${() => setEditing(null)} />`}
  </div>`;
}

// ---- weather -----------------------------------------------------------------

function Weather({ settings }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const timer = useRef();

  useEffect(() => {
    clearTimeout(timer.current);
    if (q.trim().length < 2) {
      setResults([]);
      return;
    }
    timer.current = setTimeout(async () => {
      setSearching(true);
      const found = await attempt(() => api(`/places?q=${encodeURIComponent(q.trim())}`));
      setResults(found || []);
      setSearching(false);
    }, 400);
  }, [q]);

  const pick = async (p) => {
    const ok = await saveSettings({ location: { name: p.name, lat: p.lat, lon: p.lon, timezone: p.timezone } }, `Weather set to ${p.name}`);
    if (ok) {
      setQ('');
      setResults([]);
      refreshWeather();
    }
  };

  return html`<div class="settings-section">
    <div class="current-loc">
      <${Icon} name="pin" />
      <span class="grow">${settings.location ? html`<b>${settings.location.name}</b> <small class="muted">${settings.location.lat.toFixed(2)}, ${settings.location.lon.toFixed(2)}</small>` : html`<span class="muted">No location set</span>`}</span>
    </div>
    <label class="field"><span>${settings.location ? 'Change location' : 'Find your town or city'}</span>
      <input class="input" placeholder="e.g. Austin, TX" value=${q} onInput=${(e) => setQ(e.target.value)} /></label>
    ${searching && html`<p class="muted small">Searching…</p>`}
    ${results.length > 0 && html`<div class="row-list">
      ${results.map((p) => html`<button key=${`${p.lat},${p.lon}`} class="row-item" onClick=${() => pick(p)}>
        <${Icon} name="pin" size=${20} /><span class="grow"><b>${p.name}</b> <small class="muted">${p.region}</small></span></button>`)}
    </div>`}
    <div class="field"><span>Units</span>
      <${Segmented} value=${settings.units} onChange=${async (v) => { await saveSettings({ units: v }); refreshWeather(); }}
        options=${[['imperial', '°F, mph'], ['metric', '°C, km/h']]} /></div>
    <p class="muted small">Forecasts by Open-Meteo.com, free and without an account.</p>
  </div>`;
}

// ---- devices ---------------------------------------------------------------------

function Devices() {
  const [info, setInfo] = useState(null);
  const [os, setOs] = useState(null);
  useEffect(() => {
    api('/system').then(setInfo).catch(() => setInfo({ urls: [] }));
  }, []);
  if (!info) return html`<div class="settings-section"><p class="muted">Loading…</p></div>`;
  const secure = window.isSecureContext;
  const primary = info.urls[0];
  const caUrl = info.https ? `${location.protocol}//${location.host}${info.https.caPath}` : null;
  const hasName = info.urls.some((u) => u.label?.startsWith('By name'));

  const steps = {
    android: [
      'Download the certificate with the button above.',
      'Open Settings → Security & privacy → More security settings → Encryption & credentials → Install a certificate → CA certificate. (Search Settings for “CA certificate” if it’s elsewhere.)',
      'Choose the downloaded hearth-ca.crt and confirm.',
      `Open ${primary?.https || 'the https:// address'} in Chrome, then ⋮ → Add to Home screen → Install.`,
    ],
    ipad: [
      'Open this page in Safari and download the certificate. Tap Allow when asked to download a profile.',
      'Open Settings → Profile Downloaded → Install.',
      'Then Settings → General → About → Certificate Trust Settings → turn on “Hearth Local CA”.',
      `Open ${primary?.https || 'the https:// address'} in Safari → Share → Add to Home Screen.`,
    ],
    windows: [
      'Download the certificate and double-click it → Install Certificate.',
      'Pick “Local Machine” (or Current User) → “Place all certificates in the following store” → Trusted Root Certification Authorities → Finish.',
      `Open ${primary?.https || 'the https:// address'} in Edge or Chrome and click the install icon in the address bar (or ⋯ → Apps → Install).`,
    ],
    mac: [
      'Download the certificate and double-click it. Keychain Access opens: add it to the System keychain.',
      'In Keychain Access, double-click “Hearth Local CA” → Trust → When using this certificate: Always Trust. Close the window and enter your password.',
      `Open ${primary?.https || 'the https:// address'} in Safari → File → Add to Dock (macOS Sonoma or newer), or use the install icon in Chrome or Edge.`,
    ],
    linux: [
      'Chrome, Chromium or Edge: Settings → Privacy and security → Security → Manage certificates → Installed by you (or Authorities) → Import hearth-ca.crt and trust it for websites.',
      'Firefox: Settings → Privacy & Security → Certificates → View Certificates → Authorities → Import, and tick “Trust this CA to identify websites”.',
      `Open ${primary?.https || 'the https:// address'} and use the browser’s Install option in the address bar or menu.`,
    ],
    fire: [
      'Amazon Fire tablets: Settings → Security & Privacy → Install from storage (or Credential storage) → choose hearth-ca.crt.',
      `Open ${primary?.https || 'the https:// address'} in Silk and use the menu → Add to Home.`,
    ],
  };

  return html`<div class="settings-section">
    <p>Open Hearth on any tablet, phone or computer on the same Wi-Fi by typing one of these addresses or scanning the code.</p>
    <div class="connect-grid">
      ${info.urls.map((u) => html`<div key=${u.host} class="connect-card">
        <img class="qr" src=${`/api/qr.svg?text=${encodeURIComponent(u.https || u.http)}`} alt="QR code" width="160" height="160" />
        <div>
          ${u.label && html`<div class="connect-label">${u.label}</div>`}
          ${u.https && html`<div class="addr"><small class="muted">Secure (installable)</small><code>${u.https}</code></div>`}
          <div class="addr"><small class="muted">Plain</small><code>${u.http}</code></div>
        </div>
      </div>`)}
      ${!info.urls.length && html`<p class="muted">This computer doesn’t seem to be on a network.</p>`}
    </div>

    <h3 class="subhead">Install it as an app</h3>
    <p class="muted">Browsers only offer “Install app”, full-screen mode and keep-awake over a secure (https) connection.
      Hearth makes its own certificate for your home. Install it once on each tablet and the https address works without warnings.</p>
    <div class=${`status-pill ${secure ? 'ok' : 'warn'}`}>
      ${secure ? '✓ This screen is using a secure connection.' : '⚠ This screen is not using a secure connection.'}
    </div>
    ${caUrl && html`<a class="btn primary" href=${info.https.caPath} download="hearth-ca.crt"><${Icon} name="download" size=${20} /> Download certificate</a>`}
    <div class="os-tabs">
      <${Segmented} value=${os} onChange=${setOs} small
        options=${[['android', 'Android'], ['ipad', 'iPad / iPhone'], ['windows', 'Windows'], ['mac', 'Mac'], ['linux', 'Linux'], ['fire', 'Fire tablet']]} />
      ${os && html`<ol class="steps">${steps[os].map((s) => html`<li>${s}</li>`)}</ol>`}
    </div>
    <p class="muted small">On the computer running Hearth itself, http://localhost:${location.port || '3000'} already counts as secure, so you can install it there without a certificate.
      On Android you can also skip the certificate: open chrome://flags, enable “Insecure origins treated as secure”, and add ${primary?.http || 'the http:// address'}.</p>
    <p class="muted small">Tip: give this computer a fixed IP (a DHCP reservation in your router) so the address never changes${hasName ? ', or use the “by name” address' : ''}.
      Hearth ${info.version} · ${info.devicesConnected} screen${info.devicesConnected === 1 ? '' : 's'} connected.</p>
  </div>`;
}

// ---- security ----------------------------------------------------------------------

function Security({ settings }) {
  const [step, setStep] = useState(null);
  const [first, setFirst] = useState('');

  const finish = async (pin) => {
    if (pin !== first) return 'PINs didn’t match. Try again.';
    const ok = await attempt(() => api('/pin', { method: 'PUT', body: { pin } }), 'Parent PIN set');
    if (ok !== undefined) {
      rememberPin(pin);
      await refreshState();
    }
    setStep(null);
    return null;
  };
  const clear = async () => {
    const ok = await attempt(() => api('/pin', { method: 'PUT', body: { pin: null } }), 'Parent PIN removed');
    if (ok !== undefined) {
      forgetPin();
      await refreshState();
    }
  };

  return html`<div class="settings-section">
    <p class="muted">With a parent PIN, kids can still check off chores, add events and edit lists, but changing settings, family, calendars, chores and rewards (and spending stars) asks for the PIN.</p>
    <div class=${`status-pill ${settings.hasPin ? 'ok' : ''}`}>${settings.hasPin ? '🔒 A parent PIN is set' : 'No PIN set. Anyone can change everything.'}</div>
    <div class="row">
      <button class="btn primary" onClick=${() => setStep('new')}>${settings.hasPin ? 'Change PIN' : 'Set a PIN'}</button>
      ${settings.hasPin && html`<button class="btn ghost danger" onClick=${clear}>Remove PIN</button>`}
      ${settings.hasPin && html`<button class="btn ghost" onClick=${() => { forgetPin(); }}>Lock now</button>`}
    </div>
    ${step === 'new' && html`<${PinPad} title="Choose a PIN" check=${async (p) => { setFirst(p); setStep('confirm'); return null; }}
      onDone=${() => {}} onCancel=${() => setStep(null)} />`}
    ${step === 'confirm' && html`<${PinPad} key="confirm" title="Type it again" check=${finish} onDone=${() => {}} onCancel=${() => setStep(null)} />`}
  </div>`;
}

// ---- page ---------------------------------------------------------------------------

export function SettingsView({ sub }) {
  const { state } = useApp();
  const section = SECTIONS.some(([k]) => k === sub) ? sub : 'general';
  const [, title] = SECTIONS.find(([k]) => k === section);
  return html`<div class="view settings">
    <header class="view-head"><h1 class="view-title">Settings</h1></header>
    <div class="settings-layout">
      <nav class="settings-nav">
        ${SECTIONS.map(([key, label, icon]) => html`<button key=${key} class=${section === key ? 'on' : ''} onClick=${() => navigate(`#/settings/${key}`)}>
          <${Icon} name=${icon} size=${20} /> ${label}</button>`)}
      </nav>
      <section class="card settings-panel">
        <header class="card-head"><h2>${title}</h2></header>
        ${section === 'general' && html`<${General} settings=${state.settings} />`}
        ${section === 'family' && html`<${Family} state=${state} />`}
        ${section === 'calendars' && html`<${Calendars} state=${state} />`}
        ${section === 'weather' && html`<${Weather} settings=${state.settings} />`}
        ${section === 'devices' && html`<${Devices} />`}
        ${section === 'security' && html`<${Security} settings=${state.settings} />`}
      </section>
    </div>
  </div>`;
}
