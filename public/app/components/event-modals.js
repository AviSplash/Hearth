import { html, useState, useEffect } from '/vendor/preact-htm.js';
import { app, api, attempt, bumpEvents } from '../lib/store.js';
import { Modal, Icon, MemberPicker, Toggle, AvatarStack, colorVars, eventColor, eventMembers } from '../lib/ui.js';
import { ymd, fromYmd, addDays, timeRange, eventStart, formatLongDate, daysBetween } from '../lib/dates.js';

const REPEATS = [
  ['', 'Does not repeat'],
  ['FREQ=DAILY', 'Every day'],
  ['FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR', 'Every weekday'],
  ['FREQ=WEEKLY', 'Every week'],
  ['FREQ=WEEKLY;INTERVAL=2', 'Every 2 weeks'],
  ['FREQ=MONTHLY', 'Every month'],
  ['FREQ=YEARLY', 'Every year'],
];

const hhmm = (d) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

function combine(dateStr, timeStr) {
  const d = fromYmd(dateStr);
  const [h, m] = timeStr.split(':').map(Number);
  d.setHours(h, m, 0, 0);
  return d;
}

/** Create or edit a household event. `seed` sets defaults for a new event. */
export function EventEditor({ eventId, seed = {}, onClose }) {
  const state = app.state;
  const [loading, setLoading] = useState(!!eventId);
  const [form, setForm] = useState(() => {
    const start = seed.start || roundedNow();
    const end = seed.end || new Date(start.getTime() + 3600_000);
    return {
      title: '',
      allDay: !!seed.allDay,
      date: ymd(start),
      endDate: ymd(seed.allDay && seed.end ? addDays(seed.end, -1) : start),
      startTime: hhmm(start),
      endTime: hhmm(end),
      rrule: '',
      memberIds: seed.memberIds || [],
      location: '',
      notes: '',
    };
  });
  const [saving, setSaving] = useState(false);
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  useEffect(() => {
    if (!eventId) return;
    api(`/events/${eventId}`)
      .then((ev) => {
        const s = ev.allDay ? fromYmd(ev.start) : new Date(ev.start);
        const e = ev.allDay ? addDays(fromYmd(ev.end), -1) : new Date(ev.end);
        setForm({
          title: ev.title,
          allDay: ev.allDay,
          date: ymd(s),
          endDate: ymd(e),
          startTime: hhmm(s),
          endTime: hhmm(e),
          rrule: ev.rrule || '',
          memberIds: ev.memberIds || [],
          location: ev.location || '',
          notes: ev.notes || '',
        });
        setLoading(false);
      })
      .catch(() => onClose());
  }, [eventId]);

  const save = async (e) => {
    e?.preventDefault();
    if (!form.title.trim()) return;
    let start;
    let end;
    if (form.allDay) {
      start = form.date;
      end = ymd(addDays(fromYmd(form.endDate < form.date ? form.date : form.endDate), 1));
    } else {
      const s = combine(form.date, form.startTime);
      let en = combine(form.date, form.endTime);
      if (en <= s) en = addDays(en, 1);
      start = s.toISOString();
      end = en.toISOString();
    }
    const body = { title: form.title, allDay: form.allDay, start, end, rrule: form.rrule || null, memberIds: form.memberIds, location: form.location, notes: form.notes };
    setSaving(true);
    const ok = await attempt(
      () => api(eventId ? `/events/${eventId}` : '/events', { method: eventId ? 'PUT' : 'POST', body }),
      eventId ? 'Event updated' : 'Event added',
    );
    setSaving(false);
    if (ok) {
      bumpEvents();
      onClose();
    }
  };

  const customRule = form.rrule && !REPEATS.some(([v]) => v === form.rrule);

  return html`<${Modal} title=${eventId ? 'Edit event' : 'New event'} onClose=${onClose} wide
    footer=${html`
      <button class="btn ghost" onClick=${onClose}>Cancel</button>
      <button class="btn primary" disabled=${saving || loading || !form.title.trim()} onClick=${save}>${eventId ? 'Save' : 'Add event'}</button>`}>
    ${loading
      ? html`<div class="loading">Loading…</div>`
      : html`<form class="form" onSubmit=${save}>
      <input class="input big" placeholder="What's happening?" value=${form.title} autofocus
        onInput=${(e) => set({ title: e.target.value })} maxlength="200" />
      <div class="row">
        <${Toggle} checked=${form.allDay} onChange=${(v) => set({ allDay: v })} label="All day" />
      </div>
      <div class="field-grid">
        <label class="field"><span>${form.allDay ? 'From' : 'Date'}</span>
          <input type="date" class="input" value=${form.date} required onInput=${(e) => set({ date: e.target.value, endDate: e.target.value > form.endDate ? e.target.value : form.endDate })} /></label>
        ${form.allDay
          ? html`<label class="field"><span>To</span>
              <input type="date" class="input" value=${form.endDate} min=${form.date} onInput=${(e) => set({ endDate: e.target.value })} /></label>`
          : html`
            <label class="field"><span>Starts</span>
              <input type="time" class="input" value=${form.startTime} step="300" onInput=${(e) => set({ startTime: e.target.value })} /></label>
            <label class="field"><span>Ends</span>
              <input type="time" class="input" value=${form.endTime} step="300" onInput=${(e) => set({ endTime: e.target.value })} /></label>`}
      </div>
      <label class="field"><span>Repeats</span>
        <select class="input" value=${form.rrule} onChange=${(e) => set({ rrule: e.target.value })}>
          ${REPEATS.map(([v, label]) => html`<option value=${v}>${label}</option>`)}
          ${customRule && html`<option value=${form.rrule}>Custom (${form.rrule})</option>`}
        </select></label>
      <div class="field"><span>Who's going</span>
        <${MemberPicker} members=${state.members} value=${form.memberIds} onChange=${(v) => set({ memberIds: v })} /></div>
      <label class="field"><span>Location</span>
        <input class="input" placeholder="Optional" value=${form.location} onInput=${(e) => set({ location: e.target.value })} /></label>
      <label class="field"><span>Notes</span>
        <textarea class="input" rows="3" placeholder="Optional" value=${form.notes} onInput=${(e) => set({ notes: e.target.value })}></textarea></label>
    </form>`}
  </${Modal}>`;
}

function roundedNow() {
  const d = new Date();
  d.setMinutes(Math.ceil((d.getMinutes() + 1) / 15) * 15, 0, 0);
  return d;
}

/** Read-only view of any event, with edit/delete for household events. */
export function EventDetails({ event, onClose, onEdit }) {
  const state = app.state;
  const color = eventColor(event, state);
  const people = eventMembers(event, state);
  const calendar = event.calendarId && state.calendars.find((c) => c.id === event.calendarId);
  const local = !event.calendarId;
  const [confirming, setConfirming] = useState(false);

  const remove = async (onlyThis) => {
    const q = onlyThis ? `?occurrence=${event.occurrence}` : '';
    const ok = await attempt(() => api(`/events/${event.seriesId}${q}`, { method: 'DELETE' }), 'Event deleted');
    if (ok !== undefined) {
      bumpEvents();
      onClose();
    }
  };

  const start = eventStart(event);
  const multiDay = event.allDay && daysBetween(start, fromYmd(event.end)) > 1;

  return html`<${Modal} title="Event" onClose=${onClose} className="event-details"
    footer=${local
      ? confirming
        ? html`
          <span class="grow muted">Delete ${event.rrule ? 'which events' : 'this event'}?</span>
          ${event.rrule && html`<button class="btn danger ghost" onClick=${() => remove(true)}>Just this one</button>`}
          <button class="btn danger" onClick=${() => remove(false)}>${event.rrule ? 'All of them' : 'Delete'}</button>
          <button class="btn ghost" onClick=${() => setConfirming(false)}>Keep</button>`
        : html`
          <button class="btn ghost danger" onClick=${() => setConfirming(true)}><${Icon} name="trash" size=${20} /> Delete</button>
          <span class="grow"></span>
          <button class="btn primary" onClick=${() => onEdit(event.seriesId)}><${Icon} name="edit" size=${20} /> Edit${event.rrule ? ' series' : ''}</button>`
      : html`<span class="grow muted small">Synced from ${calendar?.name || 'a calendar'} · edit it there</span>
        <button class="btn" onClick=${onClose}>Done</button>`}>
    <div class="detail" style=${colorVars(color)}>
      <div class="detail-bar"></div>
      <div>
        <h3 class="detail-title">${event.title}</h3>
        <p class="detail-when">
          ${multiDay ? `${formatLongDate(start)} – ${formatLongDate(addDays(fromYmd(event.end), -1))}` : formatLongDate(start)}
          ${!multiDay && html`<br />${timeRange(event, state.settings)}`}
        </p>
        ${event.rrule && html`<p class="detail-line"><${Icon} name="repeat" size=${18} /> Repeats</p>`}
        ${people.length > 0 && html`<p class="detail-line"><${AvatarStack} members=${people} size=${28} /> ${people.map((p) => p.name).join(', ')}</p>`}
        ${event.location && html`<p class="detail-line"><${Icon} name="pin" size=${18} /> ${event.location}</p>`}
        ${calendar && html`<p class="detail-line"><${Icon} name="calendar" size=${18} /> ${calendar.name}</p>`}
        ${event.notes && html`<p class="detail-notes">${event.notes}</p>`}
      </div>
    </div>
  </${Modal}>`;
}

/** Shared modal state for screens that show events. */
export function useEventModals() {
  const [modal, setModal] = useState(null);
  const close = () => setModal(null);
  let element = null;
  if (modal?.type === 'details') {
    element = html`<${EventDetails} event=${modal.event} onClose=${close} onEdit=${(id) => setModal({ type: 'edit', id })} />`;
  } else if (modal?.type === 'edit') {
    element = html`<${EventEditor} eventId=${modal.id} seed=${modal.seed} onClose=${close} />`;
  }
  return {
    show: (event) => setModal({ type: 'details', event }),
    create: (seed = {}) => setModal({ type: 'edit', seed }),
    element,
  };
}
