import { html, useState } from '/vendor/preact-htm.js';
import { app, api, attempt, refreshState } from '../lib/store.js';
import { Modal, Icon, MemberPicker, EmojiPicker, Segmented, Avatar, colorVars } from '../lib/ui.js';
import { TIME_OF_DAY, CHORE_EMOJI, REWARD_EMOJI } from '../lib/chores.js';
import { ymd } from '../lib/dates.js';

const DAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

function Stepper({ value, onChange, min = 0, max = 100, suffix }) {
  return html`<div class="stepper">
    <button type="button" class="icon-btn" onClick=${() => onChange(Math.max(min, value - 1))} aria-label="Less">−</button>
    <span class="stepper-value">${value}${suffix && html` <small>${suffix}</small>`}</span>
    <button type="button" class="icon-btn" onClick=${() => onChange(Math.min(max, value + 1))} aria-label="More">+</button>
  </div>`;
}

export function ChoreEditor({ chore, seed = {}, onClose }) {
  const state = app.state;
  const [form, setForm] = useState(() => ({
    title: chore?.title || '',
    emoji: chore?.emoji || '🛏️',
    memberIds: chore?.memberIds || seed.memberIds || (state.members.length === 1 ? [state.members[0].id] : []),
    scheduleType: chore?.schedule.type || 'daily',
    days: chore?.schedule.days || [1, 2, 3, 4, 5],
    date: chore?.schedule.date || seed.date || ymd(new Date()),
    timeOfDay: chore?.timeOfDay || 'anytime',
    points: chore?.points ?? 1,
  }));
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  const schedule =
    form.scheduleType === 'weekly' ? { type: 'weekly', days: form.days } : form.scheduleType === 'once' ? { type: 'once', date: form.date } : { type: 'daily' };
  const valid = form.title.trim() && form.memberIds.length && (form.scheduleType !== 'weekly' || form.days.length);

  const save = async (e) => {
    e?.preventDefault();
    if (!valid) return;
    setSaving(true);
    const body = { title: form.title, emoji: form.emoji, memberIds: form.memberIds, schedule, timeOfDay: form.timeOfDay, points: form.points };
    const ok = await attempt(
      () => api(chore ? `/chores/${chore.id}` : '/chores', { method: chore ? 'PUT' : 'POST', body }),
      chore ? 'Chore updated' : 'Chore added',
    );
    setSaving(false);
    if (ok) {
      await refreshState();
      onClose();
    }
  };

  const remove = async () => {
    const ok = await attempt(() => api(`/chores/${chore.id}`, { method: 'DELETE' }), 'Chore deleted');
    if (ok !== undefined) {
      await refreshState();
      onClose();
    }
  };

  const toggleDay = (d) => set({ days: form.days.includes(d) ? form.days.filter((x) => x !== d) : [...form.days, d].sort() });

  return html`<${Modal} title=${chore ? 'Edit chore' : 'New chore'} onClose=${onClose} wide
    footer=${confirming
      ? html`<span class="grow muted">Delete this chore for everyone?</span>
        <button class="btn ghost" onClick=${() => setConfirming(false)}>Keep</button>
        <button class="btn danger" onClick=${remove}>Delete</button>`
      : html`${chore && html`<button class="btn ghost danger" onClick=${() => setConfirming(true)}><${Icon} name="trash" size=${20} /> Delete</button>`}
        <span class="grow"></span>
        <button class="btn ghost" onClick=${onClose}>Cancel</button>
        <button class="btn primary" disabled=${!valid || saving} onClick=${save}>${chore ? 'Save' : 'Add chore'}</button>`}>
    <form class="form" onSubmit=${save}>
      <div class="title-with-emoji">
        <span class="emoji-preview">${form.emoji}</span>
        <input class="input big" placeholder="Chore name, e.g. Make bed" value=${form.title} autofocus maxlength="80"
          onInput=${(e) => set({ title: e.target.value })} />
      </div>
      <${EmojiPicker} value=${form.emoji} choices=${CHORE_EMOJI} onChange=${(v) => set({ emoji: v })} />
      <div class="field"><span>Who does it</span>
        <${MemberPicker} members=${state.members} value=${form.memberIds} onChange=${(v) => set({ memberIds: v })} />
        ${form.memberIds.length > 1 && html`<small class="muted">Everyone picked gets their own check-off.</small>`}
      </div>
      <div class="field"><span>Repeats</span>
        <${Segmented} value=${form.scheduleType} onChange=${(v) => set({ scheduleType: v })}
          options=${[['daily', 'Every day'], ['weekly', 'Some days'], ['once', 'Once']]} />
        ${form.scheduleType === 'weekly' && html`<div class="day-picker">
          ${DAYS.map((label, i) => html`<button type="button" key=${i} class=${form.days.includes(i) ? 'on' : ''} onClick=${() => toggleDay(i)}>${label}</button>`)}
        </div>`}
        ${form.scheduleType === 'once' && html`<input type="date" class="input" value=${form.date} onInput=${(e) => set({ date: e.target.value })} />`}
      </div>
      <div class="field-grid">
        <div class="field"><span>Time of day</span>
          <select class="input" value=${form.timeOfDay} onChange=${(e) => set({ timeOfDay: e.target.value })}>
            ${TIME_OF_DAY.map(([v, label]) => html`<option value=${v}>${label}</option>`)}
          </select>
        </div>
        <div class="field"><span>Stars earned</span>
          <${Stepper} value=${form.points} onChange=${(v) => set({ points: v })} max=${50} suffix="⭐" />
        </div>
      </div>
    </form>
  </${Modal}>`;
}

export function RewardEditor({ reward, onClose }) {
  const [form, setForm] = useState({ title: reward?.title || '', emoji: reward?.emoji || '🍦', cost: reward?.cost ?? 10 });
  const [confirming, setConfirming] = useState(false);
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  const save = async (e) => {
    e?.preventDefault();
    if (!form.title.trim()) return;
    const ok = await attempt(
      () => api(reward ? `/rewards/${reward.id}` : '/rewards', { method: reward ? 'PUT' : 'POST', body: form }),
      reward ? 'Reward updated' : 'Reward added',
    );
    if (ok) {
      await refreshState();
      onClose();
    }
  };

  const remove = async () => {
    const ok = await attempt(() => api(`/rewards/${reward.id}`, { method: 'DELETE' }), 'Reward deleted');
    if (ok !== undefined) {
      await refreshState();
      onClose();
    }
  };

  return html`<${Modal} title=${reward ? 'Edit reward' : 'New reward'} onClose=${onClose}
    footer=${confirming
      ? html`<span class="grow muted">Delete this reward?</span>
        <button class="btn ghost" onClick=${() => setConfirming(false)}>Keep</button>
        <button class="btn danger" onClick=${remove}>Delete</button>`
      : html`${reward && html`<button class="btn ghost danger" onClick=${() => setConfirming(true)}><${Icon} name="trash" size=${20} /></button>`}
        <span class="grow"></span>
        <button class="btn ghost" onClick=${onClose}>Cancel</button>
        <button class="btn primary" disabled=${!form.title.trim()} onClick=${save}>${reward ? 'Save' : 'Add reward'}</button>`}>
    <form class="form" onSubmit=${save}>
      <div class="title-with-emoji">
        <span class="emoji-preview">${form.emoji}</span>
        <input class="input big" placeholder="e.g. Ice cream trip" value=${form.title} autofocus maxlength="80"
          onInput=${(e) => set({ title: e.target.value })} />
      </div>
      <${EmojiPicker} value=${form.emoji} choices=${REWARD_EMOJI} onChange=${(v) => set({ emoji: v })} />
      <div class="field"><span>Costs</span>
        <${Stepper} value=${form.cost} onChange=${(v) => set({ cost: v })} min=${1} max=${1000} suffix="⭐" />
      </div>
    </form>
  </${Modal}>`;
}

export function RedeemDialog({ reward, onClose }) {
  const state = app.state;
  const [memberId, setMemberId] = useState(null);

  const redeem = async () => {
    const ok = await attempt(() => api(`/rewards/${reward.id}/redeem`, { method: 'POST', body: { memberId } }), `🎉 Enjoy your ${reward.title}!`);
    if (ok) {
      await refreshState();
      onClose();
    }
  };

  return html`<${Modal} title=${`${reward.emoji} ${reward.title}`} onClose=${onClose}
    footer=${html`<button class="btn ghost" onClick=${onClose}>Cancel</button>
      <button class="btn primary" disabled=${!memberId} onClick=${redeem}>Redeem for ${reward.cost} ⭐</button>`}>
    <p class="muted">Who is cashing in their stars?</p>
    <div class="redeem-list">
      ${state.members.map((m) => {
        const balance = state.points[m.id] || 0;
        const enough = balance >= reward.cost;
        return html`<button key=${m.id} class="redeem-member ${memberId === m.id ? 'on' : ''}" disabled=${!enough}
          style=${colorVars(m.color)} onClick=${() => setMemberId(m.id)}>
          <${Avatar} member=${m} size=${40} />
          <span class="grow">${m.name}</span>
          <span class="stars">${balance} ⭐</span>
          ${!enough && html`<small class="muted">needs ${reward.cost - balance} more</small>`}
        </button>`;
      })}
    </div>
  </${Modal}>`;
}
