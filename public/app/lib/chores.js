import { ymd } from './dates.js';
import { api, attempt, patchState, refreshState } from './store.js';

export const TIME_OF_DAY = [
  ['anytime', 'Anytime'],
  ['morning', 'Morning'],
  ['afternoon', 'Afternoon'],
  ['evening', 'Evening'],
];
const ORDER = { morning: 0, afternoon: 1, evening: 2, anytime: 3 };

export function isDue(chore, date) {
  const key = ymd(date);
  if (chore.createdAt && key < chore.createdAt.slice(0, 10) && chore.schedule.type !== 'once') return false;
  switch (chore.schedule.type) {
    case 'weekly':
      return chore.schedule.days.includes(date.getDay());
    case 'once':
      return chore.schedule.date === key;
    default:
      return true;
  }
}

export function choresFor(state, memberId, date) {
  return state.chores
    .filter((c) => c.memberIds.includes(memberId) && isDue(c, date))
    .sort((a, b) => ORDER[a.timeOfDay] - ORDER[b.timeOfDay]);
}

export function isDone(state, choreId, memberId, date) {
  const key = typeof date === 'string' ? date : ymd(date);
  return state.completions.some((c) => c.choreId === choreId && c.memberId === memberId && c.date === key);
}

export function progressFor(state, memberId, date) {
  const list = choresFor(state, memberId, date);
  const done = list.filter((c) => isDone(state, c.id, memberId, date)).length;
  return { done, total: list.length };
}

export function scheduleLabel(schedule) {
  if (schedule.type === 'daily') return 'Every day';
  if (schedule.type === 'once') return 'One time';
  const days = schedule.days;
  if (days.length === 5 && [1, 2, 3, 4, 5].every((d) => days.includes(d))) return 'Weekdays';
  if (days.length === 2 && days.includes(0) && days.includes(6)) return 'Weekends';
  const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return days.map((d) => names[d]).join(', ');
}

/** Check a chore off (or un-check it) for one person, instantly on screen. */
export async function toggleChore(chore, memberId, date) {
  const key = ymd(date);
  patchState((s) => {
    const idx = s.completions.findIndex((c) => c.choreId === chore.id && c.memberId === memberId && c.date === key);
    const points = { ...s.points };
    if (idx >= 0) {
      s.completions = s.completions.filter((_, i) => i !== idx);
      points[memberId] = (points[memberId] || 0) - (chore.points || 0);
    } else {
      s.completions = [...s.completions, { id: `tmp-${Date.now()}`, choreId: chore.id, memberId, date: key, points: chore.points }];
      points[memberId] = (points[memberId] || 0) + (chore.points || 0);
    }
    s.points = points;
  });
  await attempt(() => api(`/chores/${chore.id}/toggle`, { method: 'POST', body: { memberId, date: key } }));
  refreshState();
}

export const CHORE_EMOJI = ['🛏️', '🧹', '🍽️', '🧺', '🗑️', '🐶', '🐱', '🐟', '🪴', '🦷', '🚿', '👕', '🧸', '🎒', '📚', '✏️', '🎹', '💊', '🧽', '🚗', '🥗', '🧼', '📦', '⭐'];
export const REWARD_EMOJI = ['🍦', '🎮', '📱', '🎬', '🍕', '🧸', '🎨', '🎟️', '💵', '🍩', '🌙', '🏊', '🛝', '📖', '🎁', '🍿'];
