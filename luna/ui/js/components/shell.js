// luna/ui/js/components/shell.js
// The persistent app shell: glass sidebar (logo, new chat, history, nav)
// + main pane. Reused across screens to avoid re-mount flicker.

import { el, escapeHtml } from '../util.js';
import { state, assistantName } from '../state.js';
import { api } from '../api.js';
import { toast } from './toast.js';
import { confirmDialog } from './modal.js';

const ICONS = {
  chat: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
  memory: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3a4 4 0 0 0-4 4c-2.2.5-4 2.3-4 4.6C4 14.4 6 16 8 16v3a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2v-3c2 0 4-1.6 4-4.4 0-2.3-1.8-4.1-4-4.6a4 4 0 0 0-4-4z"/></svg>',
  tasks: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6h11"/><path d="M9 12h11"/><path d="M9 18h11"/><path d="m3.5 5.5 1 1L6.5 4.5"/><path d="m3.5 11.5 1 1 2-2"/><path d="m3.5 17.5 1 1 2-2"/></svg>',
  privacy: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-3.5 8-10V5l-8-3-8 3v7c0 6.5 8 10 8 10z"/><path d="m9 11.5 2 2 4-4.5"/></svg>',
  settings: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>',
  plus: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  trash: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>',
};

export const LOGO_SVG = `<svg width="26" height="26" viewBox="0 0 64 64" fill="none" aria-hidden="true">
  <defs><linearGradient id="lunalogo-grad" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#b7a8ff"/><stop offset="1" stop-color="#7c6cf0"/>
  </linearGradient></defs>
  <path fill="url(#lunalogo-grad)" d="M42.8 8.2A26 26 0 1 0 55.8 41 21 21 0 0 1 42.8 8.2z"/>
  <circle fill="#b7a8ff" opacity=".9" cx="46" cy="14" r="2.2"/>
  <circle fill="#b7a8ff" opacity=".6" cx="54" cy="22" r="1.4"/>
</svg>`;

const NAV_ITEMS = [
  { id: 'chat', label: 'Chat', hash: '#/chat' },
  { id: 'memory', label: 'Memory', hash: '#/memory' },
  { id: 'tasks', label: 'Tasks', hash: '#/tasks' },
  { id: 'privacy', label: 'Privacy', hash: '#/privacy' },
  { id: 'settings', label: 'Settings', hash: '#/settings' },
];

/**
 * Ensures the app shell exists inside `container`, marks `activeNav`,
 * and returns the (emptied) main pane element to render the screen into.
 */
export function renderShell(container, activeNav) {
  let shell = container.querySelector(':scope > .app-shell');
  if (!shell) {
    container.innerHTML = '';
    shell = buildShell();
    container.appendChild(shell);
    refreshConversations();
  }

  shell.querySelectorAll('.nav-item').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.nav === activeNav);
  });
  highlightActiveConversation();

  const main = shell.querySelector('.main-pane');
  main.innerHTML = '';
  return main;
}

/** Drops the cached shell (used when leaving the shell-based screens). */
export function destroyShell(container) {
  const shell = container.querySelector(':scope > .app-shell');
  if (shell) shell.remove();
}

function buildShell() {
  const sidebar = el('aside', { class: 'sidebar glass' }, [
    el('div', { class: 'sidebar-header' }, [
      el('span', { class: 'sidebar-logo', html: LOGO_SVG }),
      el('span', { class: 'sidebar-title' }, assistantName()),
    ]),
    el('button', {
      class: 'btn btn-primary sidebar-new-chat',
      onClick: () => {
        state.activeConversationId = null;
        if (location.hash === '#/chat' || location.hash === '#/chat/') {
          window.dispatchEvent(new HashChangeEvent('hashchange'));
        } else {
          location.hash = '#/chat';
        }
      },
    }, [el('span', { html: ICONS.plus }), 'New chat']),
    el('div', { class: 'sidebar-section-label' }, 'Recent'),
    el('div', { class: 'sidebar-history', id: 'sidebar-history' }, [
      el('div', { class: 'sidebar-history-empty' }, 'Loading…'),
    ]),
    el('nav', { class: 'sidebar-nav', 'aria-label': 'Main navigation' },
      NAV_ITEMS.map((item) =>
        el('button', {
          class: 'nav-item',
          dataset: { nav: item.id },
          onClick: () => { location.hash = item.hash; },
        }, [el('span', { html: ICONS[item.id] }), item.label])
      )
    ),
  ]);

  const main = el('main', { class: 'main-pane' });
  return el('div', { class: 'app-shell' }, [sidebar, main]);
}

/* ---------------- Conversation history ---------------- */

export async function refreshConversations() {
  const listEl = document.getElementById('sidebar-history');
  if (!listEl) return;
  try {
    const conversations = await api.listConversations();
    state.conversations = Array.isArray(conversations)
      ? conversations
      : conversations?.conversations || [];
  } catch (_err) {
    state.conversations = state.conversations || [];
    listEl.innerHTML = '';
    listEl.appendChild(
      el('div', { class: 'sidebar-history-empty' }, 'History unavailable — Luna’s backend is offline.')
    );
    return;
  }
  renderHistoryList(listEl);
}

function renderHistoryList(listEl) {
  listEl.innerHTML = '';
  if (!state.conversations.length) {
    listEl.appendChild(
      el('div', { class: 'sidebar-history-empty' },
        'No conversations yet.\nStart one below 🌙')
    );
    return;
  }
  for (const convo of state.conversations) {
    const id = convo.id;
    const item = el('div', {
      class: 'history-item',
      role: 'button',
      tabindex: '0',
      dataset: { convoId: String(id) },
      onClick: () => { location.hash = `#/chat/${id}`; },
      onKeydown: (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          location.hash = `#/chat/${id}`;
        }
      },
    }, [
      el('span', { class: 'history-title', title: convo.title || 'Untitled' },
        convo.title || 'Untitled chat'),
      el('button', {
        class: 'icon-btn history-delete',
        'aria-label': `Delete conversation ${escapeHtml(convo.title || '')}`,
        html: ICONS.trash,
        onClick: async (e) => {
          e.stopPropagation();
          const ok = await confirmDialog({
            title: 'Delete conversation?',
            message: `"${convo.title || 'Untitled chat'}" and its messages will be removed. This can’t be undone.`,
            confirmLabel: 'Delete',
            danger: true,
          });
          if (!ok) return;
          try {
            await api.deleteConversation(id);
            if (String(state.activeConversationId) === String(id)) {
              state.activeConversationId = null;
              location.hash = '#/chat';
            }
            await refreshConversations();
            toast('Conversation deleted', 'success');
          } catch (err) {
            toast(`Couldn’t delete: ${err.message}`, 'error');
          }
        },
      }),
    ]);
    listEl.appendChild(item);
  }
  highlightActiveConversation();
}

export function highlightActiveConversation() {
  document.querySelectorAll('.history-item').forEach((item) => {
    item.classList.toggle(
      'active',
      state.activeConversationId != null &&
        item.dataset.convoId === String(state.activeConversationId)
    );
  });
}
