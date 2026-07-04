// luna/ui/js/screens/memory.js
// Memory manager: list with category chips + filter, add / inline-edit /
// delete / delete-all. GET/POST/PUT/DELETE /api/memories.

import { el, formatRelativeTime } from '../util.js';
import { api } from '../api.js';
import { toast } from '../components/toast.js';
import { confirmDialog } from '../components/modal.js';
import { renderShell } from '../components/shell.js';

const CATEGORIES = ['preference', 'fact', 'app', 'style', 'other'];
const CATEGORY_CHIP = {
  preference: 'chip', fact: 'chip-info', app: 'chip-success', style: 'chip-warning',
  other: 'chip-neutral',
};
const SOURCE_LABEL = { explicit: 'you told Luna', extracted: 'learned from chat', manual: 'added here' };

export async function render(container) {
  const main = renderShell(container, 'memory');

  let memories = [];
  let filter = 'all';

  const listEl = el('div', { class: 'list-stack' });
  const filterBar = el('div', { class: 'memory-filters' });

  /* ---- add form ---- */
  const addInput = el('input', {
    class: 'text-input', type: 'text',
    placeholder: 'e.g. I prefer short, to-the-point answers',
    'aria-label': 'New memory text',
  });
  const addCategory = el('select', { class: 'select-input', 'aria-label': 'Category' },
    CATEGORIES.map((c) => el('option', { value: c }, c)));
  const addBtn = el('button', { class: 'btn btn-primary', onClick: addMemory }, 'Remember');
  addInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') addMemory(); });

  async function addMemory() {
    const text = addInput.value.trim();
    if (!text) { addInput.focus(); return; }
    addBtn.disabled = true;
    try {
      await api.createMemory(text, addCategory.value);
      addInput.value = '';
      toast('Memory saved', 'success');
      await load();
    } catch (err) {
      toast(`Couldn’t save: ${err.message}`, 'error');
    } finally {
      addBtn.disabled = false;
    }
  }

  const deleteAllBtn = el('button', {
    class: 'btn btn-danger',
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
  }, 'Delete all');

  /* ---- filters ---- */
  function renderFilters() {
    filterBar.innerHTML = '';
    const counts = { all: memories.length };
    for (const c of CATEGORIES) counts[c] = memories.filter((m) => m.category === c).length;
    for (const f of ['all', ...CATEGORIES]) {
      filterBar.appendChild(el('button', {
        class: `filter-chip${filter === f ? ' active' : ''}`,
        onClick: () => { filter = f; renderFilters(); renderList(); },
      }, `${f}${counts[f] ? ` · ${counts[f]}` : ''}`));
    }
  }

  /* ---- list ---- */
  function renderList() {
    listEl.innerHTML = '';
    const shown = filter === 'all' ? memories : memories.filter((m) => m.category === filter);
    if (!shown.length) {
      listEl.appendChild(el('div', { class: 'empty-state' }, [
        el('div', { class: 'empty-icon' }, '🧠'),
        el('h4', {}, memories.length ? 'Nothing in this category' : 'Luna hasn’t remembered anything yet'),
        el('p', {}, memories.length
          ? 'Try another filter, or add a memory above.'
          : 'Chat naturally — Luna picks up preferences and facts as you go. Or add one manually above.'),
      ]));
      return;
    }
    for (const m of shown) listEl.appendChild(memoryRow(m));
  }

  function memoryRow(m) {
    const title = el('div', { class: 'row-title' }, m.text || '');
    const row = el('div', { class: 'row-card' }, [
      el('div', { class: 'row-body' }, [
        title,
        el('div', { class: 'row-meta' }, [
          el('span', { class: `chip ${CATEGORY_CHIP[m.category] || 'chip-neutral'}` }, m.category || 'other'),
          m.source && el('span', {}, SOURCE_LABEL[m.source] || m.source),
          m.created_at && el('span', {}, formatRelativeTime(m.created_at)),
        ]),
      ]),
      el('div', { class: 'row-actions' }, [
        el('button', {
          class: 'icon-btn', title: 'Edit', 'aria-label': 'Edit memory',
          html: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z"/></svg>',
          onClick: () => startEdit(m, row, title),
        }),
        el('button', {
          class: 'icon-btn', title: 'Delete', 'aria-label': 'Delete memory',
          html: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>',
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
      const fresh = el('div', { class: 'row-title' }, m.text || '');
      editor.replaceWith(fresh);
      // re-arm edit button target
      row.querySelector('.row-actions .icon-btn')?.replaceWith(
        el('button', {
          class: 'icon-btn', title: 'Edit', 'aria-label': 'Edit memory',
          html: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z"/></svg>',
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
        el('div', {}, [
          el('h2', {}, 'Memory'),
          el('p', { class: 'page-sub' },
            'Everything Luna knows about you lives here — on this device only. Review it, correct it, or wipe it any time.'),
        ]),
        el('div', { class: 'page-actions' }, [deleteAllBtn]),
      ]),
      el('div', { class: 'memory-add-form' }, [addInput, addCategory, addBtn]),
      filterBar,
      listEl,
    ]),
  ]));

  await load();
}
