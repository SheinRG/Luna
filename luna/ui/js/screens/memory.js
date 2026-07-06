// luna/ui/js/screens/memory.js
// Memory manager: hairline list with category dots + text-tab filter, add /
// inline-edit / delete / forget-all. GET/POST/PUT/DELETE /api/memories.

import { el, formatRelativeTime } from '../util.js';
import { api } from '../api.js';
import { toast } from '../components/toast.js';
import { confirmDialog } from '../components/modal.js';
import { renderShell } from '../components/shell.js';

// Filter tabs (REDESIGN): all preference fact app style.
const FILTERS = ['all', 'preference', 'fact', 'app', 'style'];
const CATEGORIES = ['preference', 'fact', 'app', 'style', 'other'];
const SOURCE_LABEL = {
  explicit: 'you told Luna', extracted: 'learned from chat', manual: 'added here',
};

const EDIT_ICON = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z"/></svg>';
const TRASH_ICON = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>';

export async function render(container) {
  const main = renderShell(container, 'memory');

  let memories = [];
  let filter = 'all';

  const listEl = el('div', { class: 'hair-list' });
  const filterBar = el('div', { class: 'text-tabs' });

  /* ---- add ---- */
  const addInput = el('input', {
    class: 'text-input', type: 'text',
    placeholder: 'Add something Luna should remember…',
    'aria-label': 'New memory text',
  });
  addInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') addMemory(); });

  async function addMemory() {
    const text = addInput.value.trim();
    if (!text) { addInput.focus(); return; }
    addInput.disabled = true;
    try {
      await api.createMemory(text); // category defaults to 'other' (manual)
      addInput.value = '';
      toast('Memory saved', 'success');
      await load();
    } catch (err) {
      toast(`Couldn’t save: ${err.message}`, 'error');
    } finally {
      addInput.disabled = false;
      addInput.focus();
    }
  }

  /* ---- forget everything ---- */
  const forgetBtn = el('button', {
    class: 'text-btn danger',
    onClick: async () => {
      if (!memories.length) return;
      const ok = await confirmDialog({
        title: 'Forget everything?',
        message: `All ${memories.length} memories will be permanently deleted. Luna will start with a blank slate.`,
        confirmLabel: 'Delete all memories', danger: true,
      });
      if (!ok) return;
      try {
        await api.deleteAllMemories();
        toast('All memories deleted', 'success');
        await load();
      } catch (err) {
        toast(`Couldn’t delete: ${err.message}`, 'error');
      }
    },
  }, 'Forget everything');

  /* ---- filters ---- */
  function renderFilters() {
    filterBar.innerHTML = '';
    for (const f of FILTERS) {
      filterBar.appendChild(el('button', {
        class: `text-tab${filter === f ? ' active' : ''}`,
        onClick: () => { filter = f; renderFilters(); renderList(); },
      }, f.charAt(0).toUpperCase() + f.slice(1)));
    }
  }

  /* ---- list ---- */
  function renderList() {
    listEl.innerHTML = '';
    const shown = filter === 'all' ? memories : memories.filter((m) => m.category === filter);
    if (!shown.length) {
      listEl.appendChild(el('div', { class: 'empty-state' }, [
        el('div', { class: 'empty-icon' }, '🌙'),
        el('h4', {}, memories.length ? 'Nothing in this category' : 'Luna hasn’t remembered anything yet'),
        el('p', {}, memories.length
          ? 'Try another filter, or add a memory above.'
          : 'Chat naturally — Luna picks up preferences and facts as you go. Or add one above.'),
      ]));
      return;
    }
    for (const m of shown) listEl.appendChild(memoryRow(m));
  }

  function metaText(m) {
    const parts = [];
    if (m.source && SOURCE_LABEL[m.source]) parts.push(SOURCE_LABEL[m.source]);
    else if (m.source) parts.push(m.source);
    if (m.created_at) parts.push(formatRelativeTime(m.created_at));
    return parts.join(' · ');
  }

  function memoryRow(m) {
    const cat = CATEGORIES.includes(m.category) ? m.category : 'other';
    const title = el('div', { class: 'hair-title' }, m.text || '');
    const row = el('div', { class: 'hair-row' }, [
      el('span', { class: `cat-dot ${cat}`, title: cat }),
      el('div', { class: 'hair-body' }, [
        title,
        el('div', { class: 'hair-meta' }, metaText(m)),
      ]),
      el('div', { class: 'row-actions' }, [
        el('button', {
          class: 'icon-btn', title: 'Edit', 'aria-label': 'Edit memory', html: EDIT_ICON,
          onClick: () => startEdit(m, row, title),
        }),
        el('button', {
          class: 'icon-btn', title: 'Delete', 'aria-label': 'Delete memory', html: TRASH_ICON,
          onClick: async () => {
            try {
              await api.deleteMemory(m.id);
              memories = memories.filter((x) => x.id !== m.id);
              renderFilters();
              renderList();
              toast('Memory deleted', 'success');
            } catch (err) {
              toast(`Couldn’t delete: ${err.message}`, 'error');
            }
          },
        }),
      ]),
    ]);
    return row;
  }

  function startEdit(m, row, title) {
    const editor = el('input', { class: 'edit-input', type: 'text', value: m.text || '' });
    title.replaceWith(editor);
    editor.focus();
    editor.setSelectionRange(editor.value.length, editor.value.length);

    const finish = async (save) => {
      const newText = editor.value.trim();
      if (save && newText && newText !== m.text) {
        try {
          await api.updateMemory(m.id, { text: newText, category: m.category });
          m.text = newText;
          toast('Memory updated', 'success');
        } catch (err) {
          toast(`Couldn’t update: ${err.message}`, 'error');
        }
      }
      const fresh = el('div', { class: 'hair-title' }, m.text || '');
      editor.replaceWith(fresh);
      row.querySelector('.row-actions .icon-btn')?.replaceWith(
        el('button', {
          class: 'icon-btn', title: 'Edit', 'aria-label': 'Edit memory', html: EDIT_ICON,
          onClick: () => startEdit(m, row, fresh),
        })
      );
    };
    editor.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') finish(true);
      else if (e.key === 'Escape') finish(false);
    });
    editor.addEventListener('blur', () => finish(true));
  }

  /* ---- data ---- */
  async function load() {
    try {
      const res = await api.listMemories();
      memories = Array.isArray(res) ? res : res?.memories || [];
    } catch (err) {
      memories = [];
      listEl.innerHTML = '';
      listEl.appendChild(el('div', { class: 'empty-state' }, [
        el('div', { class: 'empty-icon' }, '🌫️'),
        el('h4', {}, 'Couldn’t load memories'),
        el('p', {}, `${err.message} — is Luna’s backend running?`),
      ]));
      renderFilters();
      return;
    }
    renderFilters();
    renderList();
  }

  main.appendChild(el('div', { class: 'page' }, [
    el('div', { class: 'page-inner' }, [
      el('div', { class: 'page-header' }, [
        el('div', { class: 'page-head-row' }, [
          el('h2', { class: 'page-title' }, 'Memory'),
          forgetBtn,
        ]),
        el('p', { class: 'page-sub' },
          'What Luna knows about you — stored on this device only.'),
      ]),
      el('div', { class: 'add-row' }, [addInput]),
      filterBar,
      listEl,
    ]),
  ]));

  await load();
}
