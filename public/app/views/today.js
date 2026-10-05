import { html, useMemo } from '/vendor/preact-htm.js';
import { useApp, useNow, useEvents } from '../lib/store.js';
import { Icon, Avatar, AvatarStack, Empty, colorVars, eventColor, eventMembers, navigate } from '../lib/ui.js';
import {
  startOfDay, addDays, eventsOn, sortEvents, eventStart, eventEnd, formatTime, formatLongDate, formatWeekday, ymd, fromYmd,
} from '../lib/dates.js';
import { describeWeather } from '../lib/weather-codes.js';
import { progressFor } from '../lib/chores.js';
import { useEventModals } from '../components/event-modals.js';

function greeting(d) {
  const h = d.getHours();
  if (h < 5) return 'Good night';
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

function Clock({ now, settings }) {
  const text = formatTime(now, settings);
  const m = text.match(/^(.*?)\s?([AaPp]\.?[Mm]\.?)$/);
  return html`<div class="clock">${m ? m[1] : text}${m && html`<span class="ampm">${m[2]}</span>`}</div>`;
}

function WeatherNow({ weather }) {
  if (!weather) return null;
  const { current, days, units } = weather;
  const today = days[0];
  const d = describeWeather(current.code, current.isDay);
  return html`<button class="weather-now" onClick=${() => navigate('#/settings/weather')} title=${weather.location}>
    <span class="weather-icon">${d.icon}</span>
    <span>
      <span class="weather-temp">${current.temp}°</span>
      <span class="weather-label">${d.label}</span>
      ${today && html`<span class="weather-hilo">H ${today.high}° · L ${today.low}°${today.precip ? ` · ${today.precip}% 💧` : ''}</span>`}
      <span class="weather-hilo">Feels ${current.feelsLike}° · Wind ${current.wind} ${units.wind}</span>
    </span>
  </button>`;
}

function WeatherCard({ app }) {
  const { weather, weatherError, state } = app;
  if (!state.settings.location) {
    return html`<section class="card weather-card">
      <header class="card-head"><h2>Weather</h2></header>
      <${Empty} icon="🌤️" title="Where do you live?">
        <button class="btn primary" onClick=${() => navigate('#/settings/weather')}>Set location</button>
      </${Empty}>
    </section>`;
  }
  if (!weather) {
    return html`<section class="card weather-card"><header class="card-head"><h2>Weather</h2></header>
      <p class="muted">${weatherError || 'Loading forecast…'}</p></section>`;
  }
  const hours = weather.hours.filter((h, i) => i % 2 === 0).slice(0, 6);
  const settings = state.settings;
  return html`<section class="card weather-card">
    <header class="card-head">
      <h2>Forecast</h2>
      <span class="muted small">${weather.location}${weather.stale ? ' · offline' : ''}</span>
    </header>
    <div class="hourly">
      ${hours.map((h, i) => {
        const d = describeWeather(h.code, h.isDay);
        return html`<div class="hour" key=${h.time}>
          <span class="hour-time">${i === 0 ? 'Now' : formatTime(new Date(h.time), settings, { short: true })}</span>
          <span class="hour-icon">${d.icon}</span>
          <span class="hour-temp">${h.temp}°</span>
          <span class="hour-precip">${h.precip >= 20 ? `${h.precip}%` : ''}</span>
        </div>`;
      })}
    </div>
    <div class="daily">
      ${weather.days.slice(1, 6).map((day) => {
        const d = describeWeather(day.code, true);
        return html`<div class="day-col" key=${day.date} title=${d.label}>
          <span class="day-name">${formatWeekday(fromYmd(day.date), 'short')}</span>
          <span class="day-icon">${d.icon}</span>
          <span class="day-temps"><b>${day.high}°</b> <span class="muted">${day.low}°</span></span>
        </div>`;
      })}
    </div>
  </section>`;
}

function AgendaItem({ ev, state, now, onOpen }) {
  const color = eventColor(ev, state);
  const people = eventMembers(ev, state);
  const past = !ev.allDay && eventEnd(ev) < now;
  const live = !ev.allDay && eventStart(ev) <= now && eventEnd(ev) > now;
  const start = eventStart(ev);
  return html`<button class="agenda-item ${past ? 'past' : ''} ${live ? 'live' : ''}" style=${colorVars(color)} onClick=${() => onOpen(ev)}>
    <span class="agenda-time">
      ${ev.allDay ? 'All day' : formatTime(start, state.settings)}
      ${!ev.allDay && +eventEnd(ev) !== +start && html`<small>${formatTime(eventEnd(ev), state.settings)}</small>`}
    </span>
    <span class="agenda-bar"></span>
    <span class="agenda-main">
      <span class="agenda-title">${ev.title}</span>
      ${(ev.location || live) && html`<span class="agenda-sub">${live && html`<b class="now-pill">Now</b>`} ${ev.location}</span>`}
    </span>
    <${AvatarStack} members=${people} size=${30} />
  </button>`;
}

function ChoresCard({ state, today }) {
  if (!state.members.length) {
    return html`<section class="card chores-card">
      <header class="card-head"><h2>Chores</h2></header>
      <${Empty} icon="👨‍👩‍👧" title="Add your family">
        <button class="btn primary" onClick=${() => navigate('#/settings/family')}>Add people</button>
      </${Empty}>
    </section>`;
  }
  return html`<section class="card chores-card">
    <header class="card-head"><h2>Chores</h2>
      <button class="link" onClick=${() => navigate('#/chores')}>Open <${Icon} name="right" size=${18} /></button></header>
    <div class="chore-progress-list">
      ${state.members.map((m) => {
        const { done, total } = progressFor(state, m.id, today);
        const pct = total ? Math.round((done / total) * 100) : 0;
        return html`<button class="chore-progress" key=${m.id} style=${colorVars(m.color)} onClick=${() => navigate(`#/chores`)}>
          <${Avatar} member=${m} size=${40} />
          <span class="grow">
            <span class="cp-name">${m.name}</span>
            <span class="bar"><span style="width:${pct}%"></span></span>
          </span>
          <span class="cp-count">${total ? (done === total ? '🎉' : `${done}/${total}`) : '—'}</span>
          <span class="cp-stars">${state.points[m.id] || 0}⭐</span>
        </button>`;
      })}
    </div>
  </section>`;
}

function MealsCard({ state, today }) {
  const meals = state.meals[ymd(today)] || {};
  const order = [['breakfast', '🍳', 'Breakfast'], ['lunch', '🥪', 'Lunch'], ['dinner', '🍝', 'Dinner']];
  const planned = order.filter(([k]) => meals[k]);
  return html`<section class="card meals-card" onClick=${() => navigate('#/meals')}>
    <header class="card-head"><h2>Meals</h2></header>
    ${planned.length
      ? html`<div class="meal-lines">${planned.map(([k, icon, label]) => html`<div class="meal-line" key=${k}>
          <span class="meal-icon">${icon}</span><span class="muted small">${label}</span><b>${meals[k]}</b></div>`)}</div>`
      : html`<p class="muted">Nothing planned. Tap to plan meals.</p>`}
  </section>`;
}

export function TodayView() {
  const app = useApp();
  const { state } = app;
  const now = useNow(1000 * 15);
  const today = startOfDay(now);
  const range = useMemo(() => [today, addDays(today, 2)], [ymd(today)]);
  const events = useEvents(range[0], range[1]);
  const modals = useEventModals();
  const settings = state.settings;

  const todays = events ? sortEvents(eventsOn(events, today)) : [];
  const allDay = todays.filter((e) => e.allDay);
  const timed = todays.filter((e) => !e.allDay);
  const tomorrow = events ? sortEvents(eventsOn(events, addDays(today, 1))) : [];
  const nextIdx = timed.findIndex((e) => eventEnd(e) > now);

  return html`<div class="view today-view">
    <section class="today-main">
      <div class="hero card">
        <div class="hero-left">
          <div class="greeting">${greeting(now)}, ${settings.householdName}</div>
          <${Clock} now=${now} settings=${settings} />
          <div class="hero-date">${formatLongDate(now)}</div>
        </div>
        <${WeatherNow} weather=${app.weather} />
      </div>

      <section class="card agenda">
        <header class="card-head">
          <h2>Today’s agenda</h2>
          <span class="muted small">${events ? `${todays.length} event${todays.length === 1 ? '' : 's'}` : ''}</span>
          <button class="btn small soft" onClick=${() => modals.create({ start: nextSlot(now) })}><${Icon} name="plus" size=${18} /> Event</button>
        </header>
        <div class="agenda-scroll">
          ${allDay.length > 0 && html`<div class="allday-row">
            ${allDay.map((ev) => html`<button key=${ev.id} class="allday-chip" style=${colorVars(eventColor(ev, state))}
              onClick=${() => modals.show(ev)}>${ev.title}</button>`)}
          </div>`}
          ${events && !todays.length && html`<${Empty} icon="🌿" title="Nothing on the calendar today">
            ${state.calendars.length
              ? 'Enjoy the free time.'
              : html`Bring in your Google or Outlook calendars to see everyone’s plans here.<br />
                <button class="btn primary" onClick=${() => navigate('#/settings/calendars')}>Connect a calendar</button>`}
          </${Empty}>`}
          ${timed.map((ev, i) => html`
            ${i === nextIdx && i > 0 && html`<div class="now-line"><span>${formatTime(now, settings)}</span></div>`}
            <${AgendaItem} key=${ev.id} ev=${ev} state=${state} now=${now} onOpen=${modals.show} />`)}
          ${tomorrow.length > 0 && html`
            <h3 class="subhead">Tomorrow</h3>
            ${tomorrow.slice(0, 5).map((ev) => html`<button key=${ev.id} class="mini-event" style=${colorVars(eventColor(ev, state))} onClick=${() => modals.show(ev)}>
              <span class="dot"></span><span class="mini-time">${ev.allDay ? 'All day' : formatTime(eventStart(ev), settings)}</span>
              <span class="grow">${ev.title}</span></button>`)}
            ${tomorrow.length > 5 && html`<button class="link" onClick=${() => navigate('#/calendar')}>+${tomorrow.length - 5} more</button>`}`}
        </div>
      </section>
    </section>

    <aside class="today-side">
      <${WeatherCard} app=${app} />
      <${ChoresCard} state=${state} today=${today} />
      <${MealsCard} state=${state} today=${today} />
    </aside>
    ${modals.element}
  </div>`;
}

function nextSlot(now) {
  const d = new Date(now);
  d.setMinutes(0, 0, 0);
  d.setHours(d.getHours() + 1);
  return d;
}
