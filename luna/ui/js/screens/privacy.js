// luna/ui/js/screens/privacy.js
// Privacy dashboard: permission switches, activity list, stored-data stats,
// data path, and the double-confirmed "Delete all my data".
// GET/PUT /api/permissions · GET /api/activity?limit=100 · POST /api/data/delete-all

import { el, formatRelativeTime } from '../util.js';
import { api } from '../api.js';
import { state, truthy } from '../state.js';
import { toast } from '../components/toast.js';
import { confirmDialog } from '../components/modal.js';
import { renderShell } from '../components/shell.js';

// Descriptions match SPEC §3 permission categories (REDESIGN copy).
const PERMISSION_META = {
  apps: 'Launch installed applications',
  files: 'Search and organize your files',
  notifications: 'Send reminder toasts',
  voice: 'Show the mic button (on-device Whisper)',
};

function cap(s) {
  return String(s || '').charAt(0).toUpperCase() + String(s || '').slice(1);
}

export async function render(container) {
  const main = renderShell(container, 'privacy');

  const permsEl = el('div', { class: 'hair-list' });
  const activityEl = el('div', {});
  const summaryEl = el('div', {});

  /* ================= permissions ================= */
  async function loadPermissions() {
    permsEl.innerHTML = '';
    let perms = {};
    try {
      const res = await api.getPermissions();
      if (Array.isArray(res)) {
        for (const p of res) perms[p.category] = truthy(p.granted);
      } else if (res && typeof res === 'object') {
        for (const [k, v] of Object.entries(res)) perms[k] = truthy(v);
      }
      state.permissions = perms;
    } catch (err) {
      permsEl.appendChild(el('div', { class: 'empty-state' }, [
        el('div', { class: 'empty-icon' }, '🌫️'),
        el('h4', {}, 'Couldn’t load permissions'),
        el('p', {}, `${err.message} — is Luna’s backend running?`),
      ]));
      return;
    }

    for (const cat of Object.keys(PERMISSION_META)) {
      const input = el('input', { type: 'checkbox' });
      input.checked = !!perms[cat];
      input.addEventListener('change', async () => {
        try {
          await api.putPermissions({ [cat]: input.checked });
          state.permissions[cat] = input.checked;
          toast(`${cap(cat)} ${input.checked ? 'allowed' : 'revoked'}`, 'success');
        } catch (err) {
          input.checked = !input.checked;
          toast(`Couldn’t update: ${err.message}`, 'error');
        }
      });
      permsEl.appendChild(el('div', { class: 'hair-row' }, [
        el('div', { class: 'hair-body' }, [
          el('div', { class: 'hair-title' }, cap(cat)),
          el('div', { class: 'hair-meta' }, PERMISSION_META[cat]),
        ]),
        el('label', { class: 'switch', 'aria-label': `Allow ${cat}` }, [
          input, el('span', { class: 'track' }), el('span', { class: 'thumb' }),
        ]),
      ]));
    }
  }

  /* ================= activity ================= */
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
      const list = el('div', { class: 'hair-list' });
      for (const a of items) {
        const isError = a.status && a.status !== 'ok';
        list.appendChild(el('div', { class: 'activity-row' }, [
          el('span', { class: `status-dot${isError ? ' error' : ''}` }),
          el('span', { class: 'activity-desc' }, a.description || a.action_id || 'action'),
          a.created_at && el('span', { class: 'activity-time' }, formatRelativeTime(a.created_at)),
        ]));
      }
      activityEl.appendChild(list);
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
      { label: 'conversations', fetch: api.listConversations, key: 'conversations' },
      { label: 'memories', fetch: api.listMemories, key: 'memories' },
      { label: 'reminders', fetch: api.listReminders, key: 'reminders' },
      { label: 'to-dos', fetch: api.listTodos, key: 'todos' },
      { label: 'notes', fetch: api.listNotes, key: 'notes' },
    ];
    const row = el('div', { class: 'stat-row' });
    summaryEl.appendChild(row);

    await Promise.all(counts.map(async (c) => {
      let value = '—';
      try {
        const res = await c.fetch();
        const arr = Array.isArray(res) ? res : res?.[c.key] || [];
        value = String(arr.length);
      } catch (_err) { /* backend down → dash */ }
      row.appendChild(el('div', { class: 'stat' }, [
        el('div', { class: 'stat-num' }, value),
        el('div', { class: 'stat-label' }, c.label),
      ]));
    }));

    const dataDir = state.health?.data_dir;
    if (dataDir) {
      summaryEl.appendChild(el('div', { class: 'data-path' }, dataDir));
    }
  }

  /* ================= delete all data ================= */
  const deleteBtn = el('button', { class: 'btn btn-danger privacy-delete' }, 'Delete all my data…');
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
        el('h2', { class: 'page-title' }, 'Privacy'),
        el('p', { class: 'page-sub' },
          'Fully offline. Nothing leaves this laptop — here’s exactly what Luna can do and what she’s stored.'),
      ]),
      el('h3', { class: 'section-title' }, 'Permissions'),
      permsEl,
      el('h3', { class: 'section-title' }, 'Action history'),
      activityEl,
      el('h3', { class: 'section-title' }, 'Stored on this device'),
      summaryEl,
      deleteBtn,
    ]),
  ]));

  await Promise.all([loadPermissions(), loadActivity(), loadSummary()]);
}
