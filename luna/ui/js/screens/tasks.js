// luna/ui/js/screens/tasks.js
// Tasks hub: Reminders (natural-language due time), To-dos (checkable),
// Notes. GET/POST/PUT/DELETE /api/reminders /api/todos /api/notes.

import {
  el, parseNaturalDueTime, formatRelativeTime, formatClockTime, formatDateTimeLocalValue,
} from '../util.js';
import { api } from '../api.js';
import { toast } from '../components/toast.js';
import { renderShell } from '../components/shell.js';

const TRASH_ICON = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>';

export async function render(container, param) {
  const main = renderShell(container, 'tasks');

  let tab = ['reminders', 'todos', 'notes'].includes(param) ? param : 'reminders';
  const tabBar = el('div', { class: 'tasks-tabs', role: 'tablist' });
  const body = el('div', {});

  function renderTabs() {
    tabBar.innerHTML = '';
    for (const t of [
      { id: 'reminders', label: '⏰ Reminders' },
      { id: 'todos', label: '☑️ To-dos' },
      { id: 'notes', label: '📝 Notes' },
    ]) {
      tabBar.appendChild(el('button', {
        class: `task-tab${tab === t.id ? ' active' : ''}`, role: 'tab',
        'aria-selected': tab === t.id ? 'true' : 'false',
        onClick: () => { tab = t.id; renderTabs(); renderBody(); },
      }, t.label));
    }
  }

  function loadError(err) {
    return el('div', { class: 'empty-state' }, [
      el('div', { class: 'empty-icon' }, '🌫️'),
      el('h4', {}, 'Couldn’t load'),
      el('p', {}, `${err.message} — is Luna’s backend running?`),
    ]);
  }

  /* ================= Reminders ================= */
  async function renderReminders() {
    body.innerHTML = '';

    const textInput = el('input', {
      class: 'text-input', type: 'text',
      placeholder: 'What should Luna remind you about?', 'aria-label': 'Reminder text',
    });
    const whenInput = el('input', {
      class: 'text-input', type: 'text', style: 'max-width:220px',
      placeholder: 'tomorrow at 9', 'aria-label': 'When (natural language)',
    });
    const dtFallback = el('input', {
      class: 'text-input hidden', type: 'datetime-local', style: 'max-width:220px',
      'aria-label': 'Due date and time',
    });
    const duePreview = el('div', { class: 'due-preview' });

    whenInput.addEventListener('input', () => {
      const parsed = parseNaturalDueTime(whenInput.value);
      if (parsed) {
        duePreview.textContent = `→ ${parsed.toLocaleString(undefined, {
          weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
        })}`;
        dtFallback.classList.add('hidden');
      } else if (whenInput.value.trim()) {
        duePreview.textContent = 'Couldn’t parse that — pick a time below instead';
        dtFallback.classList.remove('hidden');
        if (!dtFallback.value) dtFallback.value = formatDateTimeLocalValue(new Date(Date.now() + 3600e3));
      } else {
        duePreview.textContent = '';
        dtFallback.classList.add('hidden');
      }
    });

    const addBtn = el('button', { class: 'btn btn-primary', onClick: add }, 'Set reminder');
    async function add() {
      const text = textInput.value.trim();
      if (!text) { textInput.focus(); return; }
      let due = parseNaturalDueTime(whenInput.value);
      if (!due && dtFallback.value) due = new Date(dtFallback.value);
      if (!due || Number.isNaN(due.getTime())) {
        duePreview.textContent = 'When should this fire? Try "tomorrow at 9" or use the picker.';
        dtFallback.classList.remove('hidden');
        whenInput.focus();
        return;
      }
      addBtn.disabled = true;
      try {
        await api.createReminder(text, due.toISOString());
        textInput.value = ''; whenInput.value = ''; dtFallback.value = '';
        duePreview.textContent = '';
        toast('Reminder set — Luna will toast you 🔔', 'success');
        await renderReminders();
      } catch (err) {
        toast(`Couldn’t set reminder: ${err.message}`, 'error');
      } finally {
        addBtn.disabled = false;
      }
    }
    textInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') whenInput.focus(); });
    whenInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') add(); });

    body.appendChild(el('div', { class: 'task-add-form' }, [textInput, whenInput, addBtn]));
    body.appendChild(duePreview);
    body.appendChild(dtFallback);

    const list = el('div', { class: 'list-stack', style: 'margin-top:16px' });
    body.appendChild(list);
    try {
      const res = await api.listReminders();
      const reminders = Array.isArray(res) ? res : res?.reminders || [];
      if (!reminders.length) {
        list.appendChild(el('div', { class: 'empty-state' }, [
          el('div', { class: 'empty-icon' }, '⏰'),
          el('h4', {}, 'No reminders yet'),
          el('p', {}, 'Set one above, or just tell Luna in chat: “remind me tomorrow at 9 to stretch”.'),
        ]));
        return;
      }
      for (const r of reminders) {
        const due = r.due_at ? new Date(r.due_at) : null;
        const fired = r.fired === 1 || r.fired === true || r.fired === '1';
        const overdue = due && !fired && due < new Date();
        list.appendChild(el('div', { class: `row-card${fired ? ' done' : ''}` }, [
          el('div', { class: 'row-body' }, [
            el('div', { class: 'row-title' }, r.text || ''),
            el('div', { class: 'row-meta' }, [
              due && el('span', { class: overdue ? 'reminder-overdue' : '' },
                `${overdue ? '⚠ overdue — ' : ''}${due.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })} at ${formatClockTime(due)}`),
              fired && el('span', { class: 'chip chip-neutral' }, 'delivered'),
            ]),
          ]),
          el('div', { class: 'row-actions' }, [
            el('button', {
              class: 'icon-btn', title: 'Delete', 'aria-label': 'Delete reminder', html: TRASH_ICON,
              onClick: async () => {
                try { await api.deleteReminder(r.id); await renderReminders(); }
                catch (err) { toast(`Couldn’t delete: ${err.message}`, 'error'); }
              },
            }),
          ]),
        ]));
      }
    } catch (err) {
      list.appendChild(loadError(err));
    }
  }

  /* ================= To-dos ================= */
  async function renderTodos() {
    body.innerHTML = '';
    const input = el('input', {
      class: 'text-input', type: 'text', placeholder: 'Add a to-do…', 'aria-label': 'New to-do',
    });
    const addBtn = el('button', { class: 'btn btn-primary', onClick: add }, 'Add');
    async function add() {
      const item = input.value.trim();
      if (!item) { input.focus(); return; }
      addBtn.disabled = true;
      try {
        await api.createTodo(item);
        input.value = '';
        await renderTodos();
      } catch (err) {
        toast(`Couldn’t add: ${err.message}`, 'error');
      } finally {
        addBtn.disabled = false;
      }
    }
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') add(); });
    body.appendChild(el('div', { class: 'task-add-form' }, [input, addBtn]));

    const list = el('div', { class: 'list-stack' });
    body.appendChild(list);
    try {
      const res = await api.listTodos();
      const todos = Array.isArray(res) ? res : res?.todos || [];
      if (!todos.length) {
        list.appendChild(el('div', { class: 'empty-state' }, [
          el('div', { class: 'empty-icon' }, '☑️'),
          el('h4', {}, 'All clear'),
          el('p', {}, 'Nothing on the list. Add one above, or ask Luna: “add milk to my shopping list”.'),
        ]));
        return;
      }
      for (const t of todos) {
        const done = t.done === 1 || t.done === true || t.done === '1';
        const checkbox = el('input', { type: 'checkbox' });
        checkbox.checked = done;
        const row = el('div', { class: `row-card${done ? ' done' : ''}` }, [
          el('label', { class: 'check' }, [
            checkbox,
            el('span', { class: 'box', html: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><path d="m5 13 4 4L19 7"/></svg>' }),
          ]),
          el('div', { class: 'row-body' }, [
            el('div', { class: 'row-title' }, t.item || ''),
            t.list_name && t.list_name !== 'default' &&
              el('div', { class: 'row-meta' }, [el('span', { class: 'chip chip-neutral' }, t.list_name)]),
          ]),
          el('div', { class: 'row-actions' }, [
            el('button', {
              class: 'icon-btn', title: 'Delete', 'aria-label': 'Delete to-do', html: TRASH_ICON,
              onClick: async () => {
                try { await api.deleteTodo(t.id); await renderTodos(); }
                catch (err) { toast(`Couldn’t delete: ${err.message}`, 'error'); }
              },
            }),
          ]),
        ]);
        checkbox.addEventListener('change', async () => {
          row.classList.toggle('done', checkbox.checked);
          try {
            await api.updateTodo(t.id, { done: checkbox.checked });
          } catch (err) {
            checkbox.checked = !checkbox.checked;
            row.classList.toggle('done', checkbox.checked);
            toast(`Couldn’t update: ${err.message}`, 'error');
          }
        });
        list.appendChild(row);
      }
    } catch (err) {
      list.appendChild(loadError(err));
    }
  }

  /* ================= Notes ================= */
  async function renderNotes() {
    body.innerHTML = '';
    const titleInput = el('input', {
      class: 'text-input', type: 'text', placeholder: 'Note title…', 'aria-label': 'Note title',
    });
    const addBtn = el('button', { class: 'btn btn-primary', onClick: add }, 'Create note');
    async function add() {
      const title = titleInput.value.trim();
      if (!title) { titleInput.focus(); return; }
      addBtn.disabled = true;
      try {
        await api.createNote(title);
        titleInput.value = '';
        toast('Note created in your Luna data folder', 'success');
        await renderNotes();
      } catch (err) {
        toast(`Couldn’t create: ${err.message}`, 'error');
      } finally {
        addBtn.disabled = false;
      }
    }
    titleInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') add(); });
    body.appendChild(el('div', { class: 'task-add-form' }, [titleInput, addBtn]));

    const list = el('div', { class: 'list-stack' });
    body.appendChild(list);
    try {
      const res = await api.listNotes();
      const notes = Array.isArray(res) ? res : res?.notes || [];
      if (!notes.length) {
        list.appendChild(el('div', { class: 'empty-state' }, [
          el('div', { class: 'empty-icon' }, '📝'),
          el('h4', {}, 'No notes yet'),
          el('p', {}, 'Create one above, or in chat say: “note: ideas for the demo video”. Notes are plain .md files you own.'),
        ]));
        return;
      }
      for (const n of notes) {
        list.appendChild(el('div', { class: 'row-card' }, [
          el('div', { class: 'row-body' }, [
            el('div', { class: 'row-title' }, n.title || 'Untitled note'),
            el('div', { class: 'row-meta' }, [
              n.path && el('span', { title: n.path, style: 'font-family:var(--font-mono);overflow:hidden;text-overflow:ellipsis;max-width:340px;white-space:nowrap;' }, n.path),
              n.created_at && el('span', {}, formatRelativeTime(n.created_at)),
            ]),
          ]),
          el('div', { class: 'row-actions' }, [
            el('button', {
              class: 'icon-btn', title: 'Delete', 'aria-label': 'Delete note', html: TRASH_ICON,
              onClick: async () => {
                try { await api.deleteNote(n.id); await renderNotes(); }
                catch (err) { toast(`Couldn’t delete: ${err.message}`, 'error'); }
              },
            }),
          ]),
        ]));
      }
    } catch (err) {
      list.appendChild(loadError(err));
    }
  }

  function renderBody() {
    if (tab === 'reminders') renderReminders();
    else if (tab === 'todos') renderTodos();
    else renderNotes();
  }

  main.appendChild(el('div', { class: 'page' }, [
    el('div', { class: 'page-inner' }, [
      el('div', { class: 'page-header' }, [
        el('div', {}, [
          el('h2', {}, 'Tasks'),
          el('p', { class: 'page-sub' },
            'Reminders fire as Windows toasts even while you’re in another app. All of it also works by just asking Luna in chat.'),
        ]),
      ]),
      tabBar,
      body,
    ]),
  ]));

  renderTabs();
  renderBody();
}
