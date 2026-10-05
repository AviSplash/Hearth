import { html, useState, useMemo } from '/vendor/preact-htm.js';
import { useApp, api, attempt, patchState, refreshState } from '../lib/store.js';
import { Icon, Modal } from '../lib/ui.js';
import { startOfWeek, addDays, ymd, sameDay, formatShortDate } from '../lib/dates.js';

const MEALS = [
  ['breakfast', '🍳', 'Breakfast'],
  ['lunch', '🥪', 'Lunch'],
  ['dinner', '🍝', 'Dinner'],
  ['snack', '🍎', 'Snack'],
];

function MealEditor({ date, meal, value, suggestions, onClose }) {
  const [text, setText] = useState(value || '');
  const [, icon, label] = MEALS.find(([k]) => k === meal);
  const save = async (next) => {
    const v = (next ?? text).trim();
    patchState((s) => {
      const day = { ...(s.meals[date] || {}), [meal]: v };
      s.meals = { ...s.meals, [date]: day };
    });
    onClose();
    await attempt(() => api(`/meals/${date}`, { method: 'PUT', body: { [meal]: v } }));
    refreshState();
  };
  return html`<${Modal} title=${`${icon} ${label} · ${formatShortDate(new Date(`${date}T12:00`))}`} onClose=${onClose}
    footer=${html`${value && html`<button class="btn ghost danger" onClick=${() => save('')}>Clear</button>`}
      <span class="grow"></span>
      <button class="btn ghost" onClick=${onClose}>Cancel</button>
      <button class="btn primary" onClick=${() => save()}>Save</button>`}>
    <form class="form" onSubmit=${(e) => { e.preventDefault(); save(); }}>
      <input class="input big" placeholder="What's cooking?" value=${text} autofocus maxlength="120" onInput=${(e) => setText(e.target.value)} />
      ${suggestions.length > 0 && html`<div class="field"><span>Recent</span><div class="chip-row">
        ${suggestions.map((s) => html`<button type="button" key=${s} class="chip" onClick=${() => save(s)}>${s}</button>`)}
      </div></div>`}
    </form>
  </${Modal}>`;
}

export function MealsView() {
  const { state } = useApp();
  const [anchor, setAnchor] = useState(() => startOfWeek(new Date(), state.settings.weekStart));
  const [editing, setEditing] = useState(null);
  const days = Array.from({ length: 7 }, (_, i) => addDays(anchor, i));
  const today = new Date();

  const suggestions = useMemo(() => {
    const counts = new Map();
    for (const day of Object.values(state.meals)) {
      for (const [k] of MEALS) if (day[k]) counts.set(day[k], (counts.get(day[k]) || 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([name]) => name);
  }, [state.meals]);

  const fmt = (d, o) => new Intl.DateTimeFormat(undefined, o).format(d);

  return html`<div class="view meals">
    <header class="view-head">
      <div class="nav-group">
        <button class="btn soft" onClick=${() => setAnchor(startOfWeek(new Date(), state.settings.weekStart))}>This week</button>
        <button class="icon-btn" onClick=${() => setAnchor(addDays(anchor, -7))} aria-label="Previous week"><${Icon} name="left" /></button>
        <button class="icon-btn" onClick=${() => setAnchor(addDays(anchor, 7))} aria-label="Next week"><${Icon} name="right" /></button>
      </div>
      <h1 class="view-title">Meals · ${fmt(anchor, { month: 'short', day: 'numeric' })} – ${fmt(addDays(anchor, 6), { month: 'short', day: 'numeric' })}</h1>
    </header>
    <div class="meal-grid">
      <div class="meal-corner"></div>
      ${days.map((d) => html`<div key=${ymd(d)} class="meal-day ${sameDay(d, today) ? 'today' : ''}">
        <span class="wd">${fmt(d, { weekday: 'short' })}</span><span class="wn">${d.getDate()}</span></div>`)}
      ${MEALS.map(([key, icon, label]) => html`
        <div class="meal-label" key=${key}><span>${icon}</span>${label}</div>
        ${days.map((d) => {
          const date = ymd(d);
          const value = state.meals[date]?.[key];
          return html`<button key=${date + key} class="meal-slot ${value ? 'filled' : ''} ${sameDay(d, today) ? 'today' : ''}"
            onClick=${() => setEditing({ date, meal: key, value })}>
            ${value || html`<span class="plus">+</span>`}
          </button>`;
        })}`)}
    </div>
    ${editing && html`<${MealEditor} ...${editing} suggestions=${suggestions} onClose=${() => setEditing(null)} />`}
  </div>`;
}
