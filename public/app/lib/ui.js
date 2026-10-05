import { html, useEffect, useRef } from '/vendor/preact-htm.js';

// ---- icons (24px stroke icons) -------------------------------------------

const PATHS = {
  today: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>',
  calendar: '<rect width="18" height="18" x="3" y="4" rx="3"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  chores: '<path d="m3 17 2 2 4-4"/><path d="m3 7 2 2 4-4"/><path d="M13 6h8M13 12h8M13 18h8"/>',
  lists: '<path d="M9 6h12M9 12h12M9 18h12"/><circle cx="4" cy="6" r="1"/><circle cx="4" cy="12" r="1"/><circle cx="4" cy="18" r="1"/>',
  meals: '<path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2M7 2v20"/><path d="M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7"/>',
  settings: '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  left: '<path d="m15 18-6-6 6-6"/>',
  right: '<path d="m9 18 6-6-6-6"/>',
  close: '<path d="M18 6 6 18M6 6l12 12"/>',
  edit: '<path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>',
  trash: '<path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>',
  pin: '<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/>',
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  gift: '<rect x="3" y="8" width="18" height="4" rx="1"/><path d="M12 8v13M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7M7.5 8a2.5 2.5 0 0 1 0-5C9.5 3 12 8 12 8s2.5-5 4.5-5a2.5 2.5 0 0 1 0 5"/>',
  lock: '<rect width="18" height="11" x="3" y="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>',
  wifi: '<path d="M5 12.55a11 11 0 0 1 14.08 0M1.42 9a16 16 0 0 1 21.16 0M8.53 16.11a6 6 0 0 1 6.95 0M12 20h.01"/>',
  cloud: '<path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/>',
  home: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  palette: '<circle cx="13.5" cy="6.5" r="1.5"/><circle cx="17.5" cy="10.5" r="1.5"/><circle cx="8.5" cy="7.5" r="1.5"/><circle cx="6.5" cy="12.5" r="1.5"/><path d="M12 2a10 10 0 0 0 0 20c.93 0 1.5-.75 1.5-1.5 0-.39-.15-.74-.39-1.04-.23-.29-.38-.63-.38-1.02A1.5 1.5 0 0 1 14.25 17H16a6 6 0 0 0 6-6c0-4.97-4.48-9-10-9Z"/>',
  sparkle: '<path d="M12 3l1.9 5.6L19.5 10l-5.6 1.9L12 17.5l-1.9-5.6L4.5 10l5.6-1.4z"/>',
  monitor: '<rect width="20" height="14" x="2" y="3" rx="2"/><path d="M8 21h8M12 17v4"/>',
  repeat: '<path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/>',
  note: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M16 13H8M16 17H8M10 9H8"/>',
  star: '<path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>',
};

export function Icon({ name, size = 24, class: cls = '' }) {
  return html`<svg class="icon ${cls}" width=${size} height=${size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"
    dangerouslySetInnerHTML=${{ __html: PATHS[name] || '' }}></svg>`;
}

// ---- colors ------------------------------------------------------------

export const PALETTE = ['#f28b82', '#fbbc6b', '#f5d565', '#8bd3a0', '#6ccfc4', '#7cb7f2', '#9b9cf2', '#c49beb', '#f29cc9', '#a0aec0'];

export function tint(hex, alpha) {
  const n = parseInt((hex || '#a0aec0').slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/** Darker version of a pastel for readable text on light backgrounds. */
export function deepen(hex, amount = 0.45) {
  const n = parseInt((hex || '#a0aec0').slice(1), 16);
  const f = (c) => Math.round(c * (1 - amount));
  return `rgb(${f((n >> 16) & 255)}, ${f((n >> 8) & 255)}, ${f(n & 255)})`;
}

export function colorVars(hex) {
  return `--c:${hex};--c-soft:${tint(hex, 0.22)};--c-softer:${tint(hex, 0.12)};--c-deep:${deepen(hex)}`;
}

/** The color an event is drawn in: its person, else its calendar. */
export function eventColor(ev, state) {
  const memberId = ev.memberIds?.[0] || state.calendars.find((c) => c.id === ev.calendarId)?.memberId;
  const member = memberId && state.members.find((m) => m.id === memberId);
  if (member) return member.color;
  const cal = ev.calendarId && state.calendars.find((c) => c.id === ev.calendarId);
  return cal?.color || '#a0aec0';
}

export function eventMembers(ev, state) {
  const ids = ev.memberIds?.length ? ev.memberIds : [state.calendars.find((c) => c.id === ev.calendarId)?.memberId].filter(Boolean);
  return ids.map((id) => state.members.find((m) => m.id === id)).filter(Boolean);
}

// ---- small components ----------------------------------------------------

export function Avatar({ member, size = 40, ring = false }) {
  if (!member) return null;
  const label = member.emoji || member.name.slice(0, 1).toUpperCase();
  return html`<span class="avatar ${ring ? 'ring' : ''}" title=${member.name}
    style="${colorVars(member.color)};width:${size}px;height:${size}px;font-size:${Math.round(size * (member.emoji ? 0.55 : 0.45))}px">${label}</span>`;
}

export function AvatarStack({ members, size = 26 }) {
  if (!members.length) return null;
  return html`<span class="avatar-stack">${members.slice(0, 4).map((m) => html`<${Avatar} key=${m.id} member=${m} size=${size} />`)}</span>`;
}

export function Modal({ title, onClose, children, footer, wide = false, className = '' }) {
  const ref = useRef();
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose?.();
    window.addEventListener('keydown', onKey);
    document.body.classList.add('has-modal');
    const first = ref.current?.querySelector('[autofocus]');
    if (first) setTimeout(() => first.focus(), 50);
    return () => {
      window.removeEventListener('keydown', onKey);
      if (!document.querySelector('.modal-backdrop + .modal-backdrop')) document.body.classList.remove('has-modal');
    };
  }, []);
  return html`
    <div class="modal-backdrop" onPointerDown=${(e) => e.target === e.currentTarget && onClose?.()}>
      <div class="modal ${wide ? 'wide' : ''} ${className}" role="dialog" aria-modal="true" aria-label=${title} ref=${ref}>
        <header class="modal-head">
          <h2>${title}</h2>
          ${onClose && html`<button class="icon-btn" onClick=${onClose} aria-label="Close"><${Icon} name="close" /></button>`}
        </header>
        <div class="modal-body">${children}</div>
        ${footer && html`<footer class="modal-foot">${footer}</footer>`}
      </div>
    </div>`;
}

export function MemberPicker({ members, value, onChange, multiple = true }) {
  const toggle = (id) => {
    if (!multiple) return onChange([id]);
    onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);
  };
  if (!members.length) return html`<p class="muted small">Add family members in Settings to assign people.</p>`;
  return html`<div class="chip-row">
    ${members.map(
      (m) => html`<button type="button" key=${m.id} class="member-chip ${value.includes(m.id) ? 'on' : ''}"
        style=${colorVars(m.color)} onClick=${() => toggle(m.id)} aria-pressed=${value.includes(m.id)}>
        <${Avatar} member=${m} size=${28} /> ${m.name}
      </button>`,
    )}
  </div>`;
}

export function ColorPicker({ value, onChange }) {
  return html`<div class="swatches">
    ${PALETTE.map(
      (c) => html`<button type="button" key=${c} class="swatch ${value === c ? 'on' : ''}" style="background:${c}"
        aria-label=${c} onClick=${() => onChange(c)}>${value === c && html`<${Icon} name="check" size=${18} />`}</button>`,
    )}
  </div>`;
}

export function EmojiPicker({ value, onChange, choices }) {
  return html`<div class="emoji-grid">
    ${choices.map(
      (e) => html`<button type="button" key=${e} class="emoji-btn ${value === e ? 'on' : ''}" onClick=${() => onChange(e)}>${e}</button>`,
    )}
    <input class="emoji-input" value=${choices.includes(value) ? '' : value} placeholder="Other"
      maxlength="4" onInput=${(e) => e.target.value && onChange(e.target.value)} aria-label="Custom emoji" />
  </div>`;
}

export function Segmented({ options, value, onChange, small = false }) {
  return html`<div class="segmented ${small ? 'small' : ''}" role="tablist">
    ${options.map(
      ([v, label]) => html`<button type="button" key=${v} role="tab" aria-selected=${value === v}
        class=${value === v ? 'on' : ''} onClick=${() => onChange(v)}>${label}</button>`,
    )}
  </div>`;
}

export function Toggle({ checked, onChange, label }) {
  return html`<label class="toggle">
    <input type="checkbox" checked=${checked} onChange=${(e) => onChange(e.target.checked)} />
    <span class="track"><span class="thumb"></span></span>
    ${label && html`<span>${label}</span>`}
  </label>`;
}

export function Empty({ icon = '✨', title, children }) {
  return html`<div class="empty">
    <div class="empty-icon">${icon}</div>
    <div class="empty-title">${title}</div>
    ${children && html`<div class="empty-body">${children}</div>`}
  </div>`;
}

export function navigate(hash) {
  if (location.hash !== hash) location.hash = hash;
}
