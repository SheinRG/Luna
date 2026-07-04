// luna/ui/js/screens/privacy.js
// Privacy dashboard: permission toggles, activity timeline, stored-data
// summary, and the double-confirmed "Delete all my data".
// GET/PUT /api/permissions · GET /api/activity?limit=100 · POST /api/data/delete-all

import { el, formatRelativeTime } from '../util.js';
import { api } from '../api.js';
import { state, truthy } from '../state.js';
import { toast } from '../components/toast.js';
import { confirmDialog } from '../components/modal.js';
import { renderShell } from '../components/shell.js';

const PERMISSION_META = {
  apps: { icon: '🚀', desc: 'Launch installed applications for you' },
  files: { icon: '📁', desc: 'Search and organize files in your user folders' },
  notifications: { icon: '🔔', desc: 'Show Windows toast reminders' },
  voice: { icon: '🎙️', desc: 'Use your microphone for voice input' },
};

export async function render(container) {
  const main = renderShell(container, 'privacy');

  const permGrid = el('div', { class: 'perm-grid' });
  const activityEl = el('div', {});
  const summaryEl = el('div', {});

  /* ================= permissions ================= */
  async function loadPermissions() {
    permGrid.innerHTML = '';
    let perms = {};
    try {
      const res = await api.getPermissions();
      // tolerate {apps: true, ...} or [{category, granted}, ...]
      if (Array.isArray(res)) {
        for (const p of res) perms[p.category] = truthy(p.granted);
      } else if (res && typeof res === 'object') {
        for (const [k, v] of Object.entries(res)) perms[k] = truthy(v);
      }
      state.permissions = perms;
    } catch (err) {
      permGrid.appendChild(el('div', { class: 'empty-state' }, [
        el('div', { class: 'empty-icon' }, '🌫️'),
        el('h4', {}, 'Couldn’t load permissions'),
        el('p', {}, `${err.message} — is Luna’s backend running?`),
      ]));
      return;
    }

    for (const cat of Object.keys(PERMISSION_META)) {
      const meta = PERMISSION_META[cat];
      const input = el('input', { type: 'checkbox' });
      input.checked = !!perms[cat];
      input.addEventListener('change', async () => {
        try {
          await api.putPermissions({ [cat]: input.checked });
          state.permissions[cat] = input.checked;
          toast(`${cat} ${input.checked ? 'allowed' : 'revoked'}`, 'success');
        } catch (err) {
          input.checked = !input.checked;
          toast(`Couldn’t update: ${err.message}`, 'error');
        }
      });
      permGrid.appendChild(el('div', { class: 'perm-card' }, [
        el('span', { class: 'perm-icon', 'aria-hidden': 'true' }, meta.icon),
        el('div', { class: 'perm-body' }, [
          el('div', { class: 'perm-name' }, cat),
          el('div', { class: 'perm-desc' }, meta.desc),
        ]),
        el('label', { class: 'switch', 'aria-label': `Allow ${cat}` }, [
          input, el('span', { class: 'track' }), el('span', { class: 'thumb' }),
        ]),
      ]));
    }
  }

  /* ================= activity timeline ================= */
  async function loadActivity() {
    activityEl.innerHTML = '';
    try {
      const res = await api.getActivity(100);
      const items = Array.isArray(res) ? res : res?.activity || res?.items || [];
      if (!items.length) {
        activityEl.appendChild(el('div', { class: 'empty-state' }, [
          el('div', { class: 'empty-icon' }, '🕰️'),
          el('h4', {}, 'No activity yet'),
          el('p', {}, 'Every desktop action Luna performs is logged here, permanently visible to you.'),
        ]));
        return;
      }
      const timeline = el('div', { class: 'activity-timeline' });
      for (const a of items) {
        timeline.appendChild(el('div', {
          class: `activity-item${a.status && a.status !== 'ok' ? ' status-error' : ''}`,
        }, [
          el('div', { class: 'activity-desc' }, a.description || a.action_id || 'action'),
          el('div', { class: 'activity-meta' }, [
            a.action_id && el('span', { class: 'chip chip-neutral' }, a.action_id),
            a.status && el('span', { class: a.status === 'ok' ? '' : 'reminder-overdue' }, a.status),
            a.created_at && el('span', {}, formatRelativeTime(a.created_at)),
          ]),
        ]));
      }
      activityEl.appendChild(timeline);
    } catch (err) {
      activityEl.appendChild(el('div', { class: 'empty-state' }, [
        el('div', { class: 'empty-icon' }, '🌫️'),
        el('h4', {}, 'Couldn’t load activity'),
        el('p', {}, err.message),
      ]));
    }
  }

  /* ================= stored-data summary ================= */
  async function loadSummary() {
    summaryEl.innerHTML = '';
    const counts = [
      { label: 'Conversations', fetch: api.listConversations, key: 'conversations' },
      { label: 'Memories', fetch: api.listMemories, key: 'memories' },
      { label: 'Reminders', fetch: api.listReminders, key: 'reminders' },
      { label: 'To-dos', fetch: api.listTodos, key: 'todos' },
      { label: 'Notes', fetch: api.listNotes, key: 'notes' },
    ];
    const grid = el('div', { class: 'data-summary-grid' });
    summaryEl.appendChild(grid);

    await Promise.all(counts.map(async (c) => {
      let value = '—';
      try {
        const res = await c.fetch();
        const arr = Array.isArray(res) ? res : res?.[c.key] || [];
        value = String(arr.length);
      } catch (_err) { /* backend down → dash */ }
      grid.appendChild(el('div', { class: 'stat-card' }, [
        el('div', { class: 'stat-value' }, value),
        el('div', { class: 'stat-label' }, c.label),
      ]));
    }));

    const dataDir = state.health?.data_dir;
    if (dataDir) {
      summaryEl.appendChild(el('div', { class: 'data-path-row' }, [
        el('span', {}, '📂'),
        el('span', {}, dataDir),
      ]));
    }
  }

  /* ================= delete all data ================= */
  const deleteBtn = el('button', { class: 'btn btn-danger' }, 'Delete all my data');
  deleteBtn.addEventListener('click', async () => {
    const first = await confirmDialog({
      title: 'Delete everything?',
      message: 'Conversations, memories, reminders, to-dos, notes, uploads and settings will be wiped from this device. Luna returns to first-run.',
      confirmLabel: 'Continue', danger: true,
    });
    if (!first) return;
    const second = await confirmDialog({
      title: 'Last check — this is permanent',
      message: 'There is no cloud copy and no undo. Type DELETE to confirm.',
      confirmLabel: 'Erase everything', danger: true, requireText: 'DELETE',
    });
    if (!second) return;
    try {
      await api.deleteAllData();
      localStorage.clear();
      toast('All data deleted', 'success');
      state.settings = {};
      state.conversations = [];
      state.activeConversationId = null;
      setTimeout(() => { location.hash = '#/onboarding'; location.reload(); }, 400);
    } catch (err) {
      toast(`Couldn’t delete data: ${err.message}`, 'error');
    }
  });

  main.appendChild(el('div', { class: 'page' }, [
    el('div', { class: 'page-inner' }, [
      el('div', { class: 'page-header' }, [
        el('div', {}, [
          el('h2', {}, 'Privacy'),
          el('p', { class: 'page-sub' },
            'Luna is 100% offline — nothing ever leaves this laptop. Here’s exactly what she can do and what she’s stored.'),
        ]),
      ]),
      el('h3', { class: 'section-title' }, 'Permissions'),
      permGrid,
      el('h3', { class: 'section-title' }, 'Action history'),
      activityEl,
      el('h3', { class: 'section-title' }, 'What’s stored on this device'),
      summaryEl,
      el('div', { class: 'danger-zone' }, [
        el('h4', {}, 'Danger zone'),
        el('p', {}, 'Wipe the database, uploads and notes, and return Luna to her first-run state.'),
        deleteBtn,
      ]),
    ]),
  ]));

  await Promise.all([loadPermissions(), loadActivity(), loadSummary()]);
}
