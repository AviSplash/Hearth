import { html, useState } from '/vendor/preact-htm.js';
import { useApp, api, attempt, patchState, refreshState } from '../lib/store.js';
import { Icon, Modal, EmojiPicker, Empty } from '../lib/ui.js';

const LIST_EMOJI = ['🛒', '✅', '📝', '🎁', '🏠', '🧳', '📚', '💡', '🎄', '🧰', '💊', '🐾'];

function ListEditor({ list, onClose, onDeleted }) {
  const [name, setName] = useState(list?.name || '');
  const [emoji, setEmoji] = useState(list?.emoji || '📝');
  const [confirming, setConfirming] = useState(false);

  const save = async (e) => {
    e?.preventDefault();
    if (!name.trim()) return;
    const ok = await attempt(() => api(list ? `/lists/${list.id}` : '/lists', { method: list ? 'PUT' : 'POST', body: { name, emoji } }));
    if (ok) {
      await refreshState();
      onClose(ok.id);
    }
  };
  const remove = async () => {
    const ok = await attempt(() => api(`/lists/${list.id}`, { method: 'DELETE' }), 'List deleted');
    if (ok !== undefined) {
      await refreshState();
      onDeleted();
    }
  };

  return html`<${Modal} title=${list ? 'Edit list' : 'New list'} onClose=${() => onClose()}
    footer=${confirming
      ? html`<span class="grow muted">Delete “${list.name}” and its items?</span>
        <button class="btn ghost" onClick=${() => setConfirming(false)}>Keep</button>
        <button class="btn danger" onClick=${remove}>Delete</button>`
      : html`${list && html`<button class="btn ghost danger" onClick=${() => setConfirming(true)}><${Icon} name="trash" size=${20} /></button>`}
        <span class="grow"></span>
        <button class="btn ghost" onClick=${() => onClose()}>Cancel</button>
        <button class="btn primary" disabled=${!name.trim()} onClick=${save}>${list ? 'Save' : 'Create list'}</button>`}>
    <form class="form" onSubmit=${save}>
      <div class="title-with-emoji"><span class="emoji-preview">${emoji}</span>
        <input class="input big" placeholder="List name" value=${name} autofocus maxlength="60" onInput=${(e) => setName(e.target.value)} /></div>
      <${EmojiPicker} value=${emoji} choices=${LIST_EMOJI} onChange=${setEmoji} />
    </form>
  </${Modal}>`;
}

export function ListsView() {
  const { state } = useApp();
  const [selectedId, setSelectedId] = useState(() => state.lists[0]?.id);
  const [draft, setDraft] = useState('');
  const [modal, setModal] = useState(null);
  const [showDone, setShowDone] = useState(false);
  const list = state.lists.find((l) => l.id === selectedId) || state.lists[0];

  const add = async (e) => {
    e.preventDefault();
    const text = draft.trim();
    if (!text || !list) return;
    setDraft('');
    patchState((s) => {
      s.lists = s.lists.map((l) => (l.id === list.id ? { ...l, items: [{ id: `tmp-${Date.now()}`, text, done: false }, ...l.items] } : l));
    });
    await attempt(() => api(`/lists/${list.id}/items`, { method: 'POST', body: { text } }));
    refreshState();
  };

  const toggle = async (item) => {
    patchState((s) => {
      s.lists = s.lists.map((l) => (l.id === list.id ? { ...l, items: l.items.map((i) => (i.id === item.id ? { ...i, done: !i.done } : i)) } : l));
    });
    await attempt(() => api(`/lists/${list.id}/items/${item.id}`, { method: 'PUT', body: { done: !item.done } }));
    refreshState();
  };

  const remove = async (item) => {
    patchState((s) => {
      s.lists = s.lists.map((l) => (l.id === list.id ? { ...l, items: l.items.filter((i) => i.id !== item.id) } : l));
    });
    await attempt(() => api(`/lists/${list.id}/items/${item.id}`, { method: 'DELETE' }));
    refreshState();
  };

  const clearDone = async () => {
    await attempt(() => api(`/lists/${list.id}/clear-done`, { method: 'POST' }), 'Cleared');
    refreshState();
  };

  const open = list ? list.items.filter((i) => !i.done) : [];
  const done = list ? list.items.filter((i) => i.done) : [];

  return html`<div class="view lists">
    <header class="view-head">
      <h1 class="view-title">Lists</h1>
      <div class="head-tools">
        <button class="btn primary" onClick=${() => setModal({ list: null })}><${Icon} name="plus" size=${20} /> List</button>
      </div>
    </header>
    <div class="lists-layout">
      <nav class="list-tabs">
        ${state.lists.map((l) => {
          const remaining = l.items.filter((i) => !i.done).length;
          return html`<button key=${l.id} class="list-tab ${list?.id === l.id ? 'on' : ''}" onClick=${() => setSelectedId(l.id)}>
            <span class="list-emoji">${l.emoji}</span><span class="grow">${l.name}</span>
            ${remaining > 0 && html`<span class="count">${remaining}</span>`}
          </button>`;
        })}
      </nav>
      ${list
        ? html`<section class="card list-panel">
          <header class="card-head">
            <h2>${list.emoji} ${list.name}</h2>
            <button class="icon-btn" onClick=${() => setModal({ list })} aria-label="Edit list"><${Icon} name="edit" size=${20} /></button>
          </header>
          <form class="add-item" onSubmit=${add}>
            <input class="input big" placeholder=${`Add to ${list.name}…`} value=${draft} onInput=${(e) => setDraft(e.target.value)} maxlength="200" />
            <button class="btn primary" disabled=${!draft.trim()}><${Icon} name="plus" size=${22} /></button>
          </form>
          <div class="items">
            ${!open.length && !done.length && html`<${Empty} icon=${list.emoji} title="This list is empty" />`}
            ${open.map((i) => html`<div class="item" key=${i.id}>
              <button class="item-check" onClick=${() => toggle(i)} aria-label="Mark done"></button>
              <span class="item-text" onClick=${() => toggle(i)}>${i.text}</span>
              <button class="icon-btn item-del" onClick=${() => remove(i)} aria-label="Delete"><${Icon} name="close" size=${18} /></button>
            </div>`)}
            ${done.length > 0 && html`<div class="done-head">
              <button class="link" onClick=${() => setShowDone(!showDone)}>${showDone ? 'Hide' : 'Show'} ${done.length} checked</button>
              <button class="link" onClick=${clearDone}>Clear checked</button>
            </div>`}
            ${showDone && done.map((i) => html`<div class="item done" key=${i.id}>
              <button class="item-check on" onClick=${() => toggle(i)} aria-label="Mark not done"><${Icon} name="check" size=${18} /></button>
              <span class="item-text" onClick=${() => toggle(i)}>${i.text}</span>
              <button class="icon-btn item-del" onClick=${() => remove(i)} aria-label="Delete"><${Icon} name="close" size=${18} /></button>
            </div>`)}
          </div>
        </section>`
        : html`<${Empty} icon="📝" title="No lists yet" />`}
    </div>
    ${modal && html`<${ListEditor} list=${modal.list} onClose=${(id) => { setModal(null); if (id) setSelectedId(id); }}
      onDeleted=${() => { setModal(null); setSelectedId(null); }} />`}
  </div>`;
}
