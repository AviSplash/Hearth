import { html, useState, useMemo, useRef, useEffect } from '/vendor/preact-htm.js';
import { useApp, useEvents, useNow } from '../lib/store.js';
import { Icon, Avatar, AvatarStack, Segmented, colorVars, eventColor, eventMembers } from '../lib/ui.js';
import {
  startOfDay, addDays, addMonths, startOfWeek, sameDay, eventsOn, sortEvents, eventStart, eventEnd,
  formatTime, formatHour, formatMonthYear, formatLongDate, weekdayNames, ymd, DAY_MS,
} from '../lib/dates.js';
import { useEventModals } from '../components/event-modals.js';

const HOUR_PX = 64;

function load(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
}
function save(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore */
  }
}

function rangeFor(view, anchor, weekStart) {
  if (view === 'day') return [startOfDay(anchor), addDays(startOfDay(anchor), 1)];
  if (view === 'week') {
    const s = startOfWeek(anchor, weekStart);
    return [s, addDays(s, 7)];
  }
  const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const s = startOfWeek(first, weekStart);
  return [s, addDays(s, 42)];
}

function titleFor(view, anchor, range) {
  if (view === 'day') return formatLongDate(anchor);
  if (view === 'month') return formatMonthYear(anchor);
  const a = range[0];
  const b = addDays(range[1], -1);
  const fmt = (d, o) => new Intl.DateTimeFormat(undefined, o).format(d);
  if (a.getMonth() === b.getMonth()) return `${fmt(a, { month: 'long' })} ${a.getDate()} – ${b.getDate()}, ${b.getFullYear()}`;
  return `${fmt(a, { month: 'short', day: 'numeric' })} – ${fmt(b, { month: 'short', day: 'numeric' })}, ${b.getFullYear()}`;
}

function useSwipe(onLeft, onRight) {
  const start = useRef(null);
  return {
    onPointerDown: (e) => {
      if (e.pointerType === 'mouse') return;
      start.current = { x: e.clientX, y: e.clientY, t: Date.now() };
    },
    onPointerUp: (e) => {
      const s = start.current;
      start.current = null;
      if (!s || Date.now() - s.t > 600) return;
      const dx = e.clientX - s.x;
      const dy = e.clientY - s.y;
      if (Math.abs(dx) > 80 && Math.abs(dy) < 60) (dx < 0 ? onLeft : onRight)();
    },
  };
}

export function CalendarView() {
  const { state } = useApp();
  const settings = state.settings;
  const [view, setViewRaw] = useState(() => load('hearth:calendar-view', window.innerWidth < 720 ? 'day' : 'week'));
  const [anchor, setAnchor] = useState(() => startOfDay(new Date()));
  const [hidden, setHiddenRaw] = useState(() => load('hearth:hidden-members', []));
  const modals = useEventModals();

  const setView = (v) => {
    setViewRaw(v);
    save('hearth:calendar-view', v);
  };
  const setHidden = (v) => {
    setHiddenRaw(v);
    save('hearth:hidden-members', v);
  };

  const range = useMemo(() => rangeFor(view, anchor, settings.weekStart), [view, +anchor, settings.weekStart]);
  const allEvents = useEvents(range[0], range[1]);
  const events = useMemo(() => {
    if (!allEvents) return [];
    if (!hidden.length) return allEvents;
    return allEvents.filter((ev) => {
      const people = eventMembers(ev, state);
      return !people.length || people.some((p) => !hidden.includes(p.id));
    });
  }, [allEvents, hidden, state]);

  const step = (dir) => {
    if (view === 'day') setAnchor(addDays(anchor, dir));
    else if (view === 'week') setAnchor(addDays(anchor, 7 * dir));
    else setAnchor(addMonths(anchor, dir));
  };
  const swipe = useSwipe(() => step(1), () => step(-1));
  const openDay = (d) => {
    setAnchor(startOfDay(d));
    setView('day');
  };

  const isCurrent = range[0] <= new Date() && new Date() < range[1];

  return html`<div class="view calendar">
    <header class="view-head">
      <div class="nav-group">
        <button class="btn soft" disabled=${isCurrent && view !== 'month'} onClick=${() => setAnchor(startOfDay(new Date()))}>Today</button>
        <button class="icon-btn" onClick=${() => step(-1)} aria-label="Previous"><${Icon} name="left" /></button>
        <button class="icon-btn" onClick=${() => step(1)} aria-label="Next"><${Icon} name="right" /></button>
      </div>
      <h1 class="view-title">${titleFor(view, anchor, range)}</h1>
      <div class="head-tools">
        ${state.members.length > 1 && html`<div class="member-filter" aria-label="Show people">
          ${state.members.map((m) => html`<button key=${m.id} class="filter-avatar ${hidden.includes(m.id) ? 'off' : ''}"
            onClick=${() => setHidden(hidden.includes(m.id) ? hidden.filter((x) => x !== m.id) : [...hidden, m.id])}
            aria-pressed=${!hidden.includes(m.id)} title=${m.name}><${Avatar} member=${m} size=${36} /></button>`)}
        </div>`}
        <${Segmented} value=${view} onChange=${setView} options=${[['day', 'Day'], ['week', 'Week'], ['month', 'Month']]} />
        <button class="btn primary" onClick=${() => modals.create({ start: defaultStart(anchor) })}><${Icon} name="plus" size=${20} /> Event</button>
      </div>
    </header>
    <div class="calendar-body" ...${swipe}>
      ${view === 'month' && html`<${MonthView} range=${range} anchor=${anchor} events=${events} state=${state} onDay=${openDay} onEvent=${modals.show} />`}
      ${view === 'week' && html`<${WeekView} range=${range} events=${events} state=${state} onDay=${openDay} onEvent=${modals.show}
        onCreate=${(d) => modals.create({ start: defaultStart(d) })} />`}
      ${view === 'day' && html`<${DayView} day=${range[0]} events=${events} state=${state} onEvent=${modals.show}
        onCreate=${(start) => modals.create({ start })} />`}
    </div>
    ${modals.element}
  </div>`;
}

function defaultStart(day) {
  const now = new Date();
  const d = sameDay(day, now) ? new Date(now) : new Date(day);
  if (sameDay(day, now)) d.setHours(now.getHours() + 1, 0, 0, 0);
  else d.setHours(9, 0, 0, 0);
  return d;
}

// ---- month ----------------------------------------------------------------

function MonthView({ range, anchor, events, state, onDay, onEvent }) {
  const days = Array.from({ length: 42 }, (_, i) => addDays(range[0], i));
  const names = weekdayNames(state.settings.weekStart, 'short');
  const today = new Date();
  return html`<div class="month">
    <div class="month-head">${names.map((n) => html`<span key=${n}>${n}</span>`)}</div>
    <div class="month-grid">
      ${days.map((d) => {
        const list = sortEvents(eventsOn(events, d));
        const other = d.getMonth() !== anchor.getMonth();
        return html`<div key=${ymd(d)} class="month-cell ${other ? 'other' : ''} ${sameDay(d, today) ? 'today' : ''}"
          onClick=${() => onDay(d)}>
          <span class="mc-date">${d.getDate()}</span>
          <div class="mc-events">
            ${list.slice(0, 3).map((ev) => html`<button key=${ev.id} class="mc-chip ${ev.allDay ? 'allday' : ''}"
              style=${colorVars(eventColor(ev, state))} onClick=${(e) => { e.stopPropagation(); onEvent(ev); }}>
              ${!ev.allDay && html`<span class="mc-time">${formatTime(eventStart(ev), state.settings, { short: true })}</span>`}
              <span class="mc-title">${ev.title}</span>
            </button>`)}
            ${list.length > 3 && html`<span class="mc-more">+${list.length - 3} more</span>`}
          </div>
          ${list.length > 0 && html`<span class="mc-dots">${list.slice(0, 4).map((ev) => html`<i style=${colorVars(eventColor(ev, state))}></i>`)}</span>`}
        </div>`;
      })}
    </div>
  </div>`;
}

// ---- week -----------------------------------------------------------------

function WeekView({ range, events, state, onDay, onEvent, onCreate }) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(range[0], i));
  const today = new Date();
  const settings = state.settings;
  return html`<div class="week">
    ${days.map((d) => {
      const list = sortEvents(eventsOn(events, d));
      const isTodayCol = sameDay(d, today);
      return html`<div key=${ymd(d)} class="week-col ${isTodayCol ? 'today' : ''} ${d < startOfDay(today) ? 'past' : ''}">
        <button class="week-day-head" onClick=${() => onDay(d)}>
          <span class="wd">${new Intl.DateTimeFormat(undefined, { weekday: 'short' }).format(d)}</span>
          <span class="wn">${d.getDate()}</span>
        </button>
        <div class="week-events" onClick=${(e) => e.target === e.currentTarget && onCreate(d)}>
          ${list.map((ev) => {
            const people = eventMembers(ev, state);
            return html`<button key=${ev.id} class="week-event ${ev.allDay ? 'allday' : ''} ${!ev.allDay && eventEnd(ev) < today ? 'done' : ''}"
              style=${colorVars(eventColor(ev, state))} onClick=${() => onEvent(ev)}>
              <span class="we-time">${ev.allDay ? 'All day' : formatTime(eventStart(ev), settings, { short: true })}</span>
              <span class="we-title">${ev.title}</span>
              ${people.length > 0 && html`<${AvatarStack} members=${people} size=${20} />`}
            </button>`;
          })}
          ${!list.length && html`<span class="week-empty" onClick=${() => onCreate(d)}>+</span>`}
        </div>
      </div>`;
    })}
  </div>`;
}

// ---- day (time grid) --------------------------------------------------------

function layoutDay(events, day) {
  const dayStart = startOfDay(day).getTime();
  const items = events
    .map((ev) => {
      const s = Math.max(eventStart(ev).getTime(), dayStart);
      const e = Math.min(eventEnd(ev).getTime(), dayStart + DAY_MS);
      const top = (s - dayStart) / 60000;
      const bottom = Math.max(top + 30, (e - dayStart) / 60000);
      return { ev, top, bottom, col: 0, cols: 1 };
    })
    .sort((a, b) => a.top - b.top || b.bottom - a.bottom);

  let cluster = [];
  let columns = [];
  let clusterEnd = -1;
  const flush = () => {
    for (const it of cluster) it.cols = columns.length;
    cluster = [];
    columns = [];
  };
  for (const it of items) {
    if (it.top >= clusterEnd && cluster.length) flush();
    let col = columns.findIndex((end) => end <= it.top);
    if (col === -1) {
      col = columns.length;
      columns.push(it.bottom);
    } else columns[col] = it.bottom;
    it.col = col;
    cluster.push(it);
    clusterEnd = Math.max(clusterEnd, it.bottom);
  }
  flush();
  return items;
}

function DayView({ day, events, state, onEvent, onCreate }) {
  const now = useNow(60_000);
  const scroller = useRef();
  const list = eventsOn(events, day);
  const allDay = sortEvents(list.filter((e) => e.allDay));
  const timed = layoutDay(list.filter((e) => !e.allDay), day);
  const isTodayView = sameDay(day, now);
  const settings = state.settings;

  useEffect(() => {
    const first = timed[0]?.top ?? 8 * 60;
    const focus = isTodayView ? Math.min(now.getHours() * 60 - 60, first) : Math.min(first, 8 * 60);
    if (scroller.current) scroller.current.scrollTop = Math.max(0, (focus / 60) * HOUR_PX - 8);
  }, [ymd(day)]);

  const createAt = (e) => {
    if (e.target !== e.currentTarget) return;
    const y = e.offsetY;
    const minutes = Math.floor((y / HOUR_PX) * 2) * 30;
    const start = new Date(startOfDay(day));
    start.setMinutes(minutes);
    onCreate(start);
  };

  return html`<div class="dayview">
    ${allDay.length > 0 && html`<div class="allday-row">
      ${allDay.map((ev) => html`<button key=${ev.id} class="allday-chip" style=${colorVars(eventColor(ev, state))} onClick=${() => onEvent(ev)}>${ev.title}</button>`)}
    </div>`}
    <div class="timegrid-scroll" ref=${scroller}>
      <div class="timegrid" style="height:${24 * HOUR_PX}px">
        ${Array.from({ length: 24 }, (_, h) => html`<div key=${h} class="hour-line" style="top:${h * HOUR_PX}px">
          <span>${h === 0 ? '' : formatHour(h, settings)}</span></div>`)}
        <div class="slot-layer" onClick=${createAt}>
          ${timed.map(({ ev, top, bottom, col, cols }) => {
            const people = eventMembers(ev, state);
            const height = ((bottom - top) / 60) * HOUR_PX - 3;
            return html`<button key=${ev.id} class="tg-event ${height < 54 ? 'compact' : ''}"
              style="${colorVars(eventColor(ev, state))};top:${(top / 60) * HOUR_PX + 1}px;height:${height}px;left:calc(${(col / cols) * 100}% + 2px);width:calc(${100 / cols}% - 6px)"
              onClick=${() => onEvent(ev)}>
              <span class="tg-title">${ev.title}</span>
              <span class="tg-time">${formatTime(eventStart(ev), settings)} – ${formatTime(eventEnd(ev), settings)}${ev.location ? ` · ${ev.location}` : ''}</span>
              ${people.length > 0 && height >= 90 && html`<${AvatarStack} members=${people} size=${22} />`}
            </button>`;
          })}
        </div>
        ${isTodayView && html`<div class="tg-now" style="top:${((now.getHours() * 60 + now.getMinutes()) / 60) * HOUR_PX}px"></div>`}
      </div>
    </div>
  </div>`;
}
