import { html, useState, useEffect, useRef } from '/vendor/preact-htm.js';
import { useApp } from '../lib/store.js';
import { Icon, Avatar, Segmented, Empty, colorVars, navigate } from '../lib/ui.js';
import { startOfDay, addDays, relativeDayLabel, sameDay, formatShortDate } from '../lib/dates.js';
import { choresFor, isDone, toggleChore, scheduleLabel } from '../lib/chores.js';
import { ChoreEditor, RewardEditor, RedeemDialog } from '../components/chore-modals.js';

function Ring({ done, total, size = 64 }) {
  const r = (size - 8) / 2;
  const c = 2 * Math.PI * r;
  const pct = total ? done / total : 0;
  return html`<svg class="ring" width=${size} height=${size} viewBox="0 0 ${size} ${size}">
    <circle cx=${size / 2} cy=${size / 2} r=${r} class="ring-bg" />
    <circle cx=${size / 2} cy=${size / 2} r=${r} class="ring-fg"
      stroke-dasharray=${c} stroke-dashoffset=${c * (1 - pct)} transform="rotate(-90 ${size / 2} ${size / 2})" />
  </svg>`;
}

function Confetti() {
  const pieces = Array.from({ length: 28 }, (_, i) => i);
  const colors = ['#f28b82', '#fbbc6b', '#f5d565', '#8bd3a0', '#7cb7f2', '#c49beb'];
  return html`<div class="confetti" aria-hidden="true">
    ${pieces.map((i) => html`<i key=${i} style="left:${(i * 37) % 100}%;background:${colors[i % colors.length]};animation-delay:${(i % 7) * 60}ms;--x:${((i * 53) % 80) - 40}px"></i>`)}
  </div>`;
}

function MemberColumn({ member, state, date, onEdit, onAdd }) {
  const list = choresFor(state, member.id, date);
  const done = list.filter((c) => isDone(state, c.id, member.id, date)).length;
  const allDone = list.length > 0 && done === list.length;
  const [celebrate, setCelebrate] = useState(false);
  const prev = useRef(allDone);

  useEffect(() => {
    if (allDone && !prev.current) {
      setCelebrate(true);
      const t = setTimeout(() => setCelebrate(false), 2200);
      prev.current = allDone;
      return () => clearTimeout(t);
    }
    prev.current = allDone;
  }, [allDone]);

  return html`<section class="chore-col ${allDone ? 'all-done' : ''}" style=${colorVars(member.color)}>
    ${celebrate && html`<${Confetti} />`}
    <header class="chore-col-head">
      <div class="ring-wrap">
        <${Ring} done=${done} total=${list.length} />
        <${Avatar} member=${member} size=${48} />
      </div>
      <div class="grow">
        <div class="cc-name">${member.name}</div>
        <div class="cc-sub">${list.length ? (allDone ? 'All done! 🎉' : `${done} of ${list.length} done`) : 'No chores'}</div>
      </div>
      <div class="cc-stars" title="Stars">${state.points[member.id] || 0}<span>⭐</span></div>
    </header>
    <div class="chore-list">
      ${list.map((chore) => {
        const checked = isDone(state, chore.id, member.id, date);
        return html`<div key=${chore.id} class="chore-card ${checked ? 'checked' : ''}">
          <button class="chore-hit" onClick=${() => toggleChore(chore, member.id, date)} aria-pressed=${checked}>
            <span class="chore-emoji">${chore.emoji}</span>
            <span class="chore-text">
              <span class="chore-title">${chore.title}</span>
              <span class="chore-meta">${chore.timeOfDay !== 'anytime' ? chore.timeOfDay : scheduleLabel(chore.schedule)}${chore.points ? ` · ${chore.points}⭐` : ''}</span>
            </span>
            <span class="check">${checked && html`<${Icon} name="check" size=${22} />`}</span>
          </button>
          <button class="chore-edit" onClick=${() => onEdit(chore)} aria-label="Edit chore"><${Icon} name="edit" size=${16} /></button>
        </div>`;
      })}
      <button class="chore-add" onClick=${() => onAdd(member)}><${Icon} name="plus" size=${18} /> Add chore</button>
    </div>
  </section>`;
}

function Rewards({ state, onEdit, onRedeem }) {
  return html`<div class="rewards">
    <div class="balances">
      ${state.members.map((m) => html`<div key=${m.id} class="balance" style=${colorVars(m.color)}>
        <${Avatar} member=${m} size=${44} />
        <div><div class="cc-name">${m.name}</div><div class="balance-num">${state.points[m.id] || 0} ⭐</div></div>
      </div>`)}
    </div>
    ${!state.rewards.length
      ? html`<${Empty} icon="🎁" title="No rewards yet">Add rewards the kids can spend their stars on.
          <br /><button class="btn primary" onClick=${() => onEdit(null)}>Add a reward</button></${Empty}>`
      : html`<div class="reward-grid">
        ${state.rewards.map((r) => html`<div key=${r.id} class="reward-card">
          <button class="reward-edit icon-btn" onClick=${() => onEdit(r)} aria-label="Edit reward"><${Icon} name="edit" size=${16} /></button>
          <span class="reward-emoji">${r.emoji}</span>
          <span class="reward-title">${r.title}</span>
          <button class="btn primary small" onClick=${() => onRedeem(r)}>${r.cost} ⭐ Redeem</button>
        </div>`)}
      </div>`}
    ${state.redemptions.length > 0 && html`<div class="history">
      <h3 class="subhead">Recently redeemed</h3>
      ${[...state.redemptions].reverse().slice(0, 8).map((x) => {
        const m = state.members.find((mm) => mm.id === x.memberId);
        return html`<div key=${x.id} class="history-row">
          ${m && html`<${Avatar} member=${m} size=${28} />`}
          <span class="grow">${m?.name || 'Someone'} redeemed <b>${x.emoji} ${x.title}</b></span>
          <span class="muted small">${formatShortDate(new Date(x.at))} · −${x.cost}⭐</span>
        </div>`;
      })}
    </div>`}
  </div>`;
}

export function ChoresView({ sub }) {
  const { state } = useApp();
  const [date, setDate] = useState(() => startOfDay(new Date()));
  const [modal, setModal] = useState(null);
  const tab = sub === 'rewards' ? 'rewards' : 'chores';
  const close = () => setModal(null);

  // Roll over to the new day at midnight.
  useEffect(() => {
    const t = setInterval(() => {
      const today = startOfDay(new Date());
      setDate((d) => (sameDay(d, addDays(today, -1)) ? today : d));
    }, 60_000);
    return () => clearInterval(t);
  }, []);

  if (!state.members.length) {
    return html`<div class="view chores"><header class="view-head"><h1 class="view-title">Chores</h1></header>
      <${Empty} icon="👨‍👩‍👧‍👦" title="Add your family first">Chores are assigned to people.
        <br /><button class="btn primary" onClick=${() => navigate('#/settings/family')}>Add family members</button></${Empty}></div>`;
  }

  return html`<div class="view chores">
    <header class="view-head">
      ${tab === 'chores'
        ? html`<div class="nav-group">
            <button class="icon-btn" onClick=${() => setDate(addDays(date, -1))} aria-label="Previous day"><${Icon} name="left" /></button>
            <button class="btn soft day-label" onClick=${() => setDate(startOfDay(new Date()))}>${relativeDayLabel(date)}</button>
            <button class="icon-btn" onClick=${() => setDate(addDays(date, 1))} aria-label="Next day"><${Icon} name="right" /></button>
          </div>
          <h1 class="view-title">${relativeDayLabel(date) === 'Today' ? 'Today’s chores' : formatShortDate(date)}</h1>`
        : html`<h1 class="view-title">Rewards</h1>`}
      <div class="head-tools">
        <${Segmented} value=${tab} onChange=${(v) => navigate(v === 'rewards' ? '#/chores/rewards' : '#/chores')}
          options=${[['chores', 'Chores'], ['rewards', 'Rewards']]} />
        ${tab === 'chores'
          ? html`<button class="btn primary" onClick=${() => setModal({ type: 'chore', seed: {} })}><${Icon} name="plus" size=${20} /> Chore</button>`
          : html`<button class="btn primary" onClick=${() => setModal({ type: 'reward' })}><${Icon} name="plus" size=${20} /> Reward</button>`}
      </div>
    </header>
    ${tab === 'chores'
      ? html`<div class="chore-board">
          ${state.members.map((m) => html`<${MemberColumn} key=${m.id} member=${m} state=${state} date=${date}
            onEdit=${(chore) => setModal({ type: 'chore', chore })}
            onAdd=${(member) => setModal({ type: 'chore', seed: { memberIds: [member.id], date: undefined } })} />`)}
        </div>`
      : html`<${Rewards} state=${state} onEdit=${(r) => setModal({ type: 'reward', reward: r })} onRedeem=${(r) => setModal({ type: 'redeem', reward: r })} />`}
    ${modal?.type === 'chore' && html`<${ChoreEditor} chore=${modal.chore} seed=${modal.seed} onClose=${close} />`}
    ${modal?.type === 'reward' && html`<${RewardEditor} reward=${modal.reward} onClose=${close} />`}
    ${modal?.type === 'redeem' && html`<${RedeemDialog} reward=${modal.reward} onClose=${close} />`}
  </div>`;
}
