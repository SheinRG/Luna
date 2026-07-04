// luna/ui/js/api.js
// Thin client over the §6 REST + SSE contract. All URLs are same-origin
// relative (`/api/...`) — FastAPI serves this UI at `/`.

import { readSSEStream } from './sse.js';

class ApiError extends Error {
  constructor(message, status, body) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

export { ApiError };

async function request(method, url, body, opts = {}) {
  const init = { method, headers: {}, ...opts };
  if (body !== undefined) {
    if (body instanceof FormData) {
      init.body = body; // browser sets multipart boundary
    } else {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body);
    }
  }
  const res = await fetch(url, init);
  if (!res.ok) {
    let detail = '';
    try {
      const data = await res.json();
      detail = data?.detail || data?.message || JSON.stringify(data);
    } catch (_err) {
      /* non-JSON error body */
    }
    throw new ApiError(detail || `${method} ${url} → HTTP ${res.status}`, res.status, detail);
  }
  if (res.status === 204) return null;
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (_err) {
    return text;
  }
}

const get = (url) => request('GET', url);
const post = (url, body) => request('POST', url, body);
const put = (url, body) => request('PUT', url, body);
const del = (url) => request('DELETE', url);

export const api = {
  /* ---- health ---- */
  health: () => get('/api/health'),

  /* ---- chat (SSE) ----
   * POST /api/chat {conversation_id?, message, attachment_ids: []}
   * Returns a promise that resolves when the SSE stream ends.
   * `onEvent(name, data)` receives: meta, token, action_proposal,
   * action_result, memory_saved, done, error (exact names per §6).
   */
  async chatStream({ conversationId, message, attachmentIds = [] }, onEvent, { signal } = {}) {
    const payload = { message, attachment_ids: attachmentIds };
    if (conversationId !== null && conversationId !== undefined) {
      payload.conversation_id = conversationId;
    }
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
      },
      body: JSON.stringify(payload),
      signal,
    });
    if (!res.ok) {
      let detail = '';
      try {
        detail = (await res.json())?.detail || '';
      } catch (_err) {
        /* ignore */
      }
      throw new ApiError(detail || `Chat request failed (HTTP ${res.status})`, res.status);
    }
    await readSSEStream(res, onEvent, { signal });
  },

  chatStop: (conversationId) => post('/api/chat/stop', { conversation_id: conversationId }),

  /* ---- action confirmation (§6: continues the pending SSE stream) ---- */
  confirmAction: (actionId, approved, rememberPermission = undefined) => {
    const body = { action_id: actionId, approved };
    if (rememberPermission !== undefined) body.remember_permission = rememberPermission;
    return post('/api/actions/confirm', body);
  },

  /* ---- conversations ---- */
  listConversations: () => get('/api/conversations'),
  createConversation: (title = undefined) =>
    post('/api/conversations', title ? { title } : {}),
  deleteConversation: (id) => del(`/api/conversations/${encodeURIComponent(id)}`),
  getMessages: (conversationId) =>
    get(`/api/conversations/${encodeURIComponent(conversationId)}/messages`),

  /* ---- memories ---- */
  listMemories: () => get('/api/memories'),
  createMemory: (text, category = 'other') => post('/api/memories', { text, category }),
  updateMemory: (id, patch) => put(`/api/memories/${encodeURIComponent(id)}`, patch),
  deleteMemory: (id) => del(`/api/memories/${encodeURIComponent(id)}`),
  // "Delete all": §6 lists collection-level DELETE /api/memories.
  deleteAllMemories: () => del('/api/memories'),

  /* ---- reminders / todos / notes ---- */
  listReminders: () => get('/api/reminders'),
  createReminder: (text, dueAt) => post('/api/reminders', { text, due_at: dueAt }),
  updateReminder: (id, patch) => put(`/api/reminders/${encodeURIComponent(id)}`, patch),
  deleteReminder: (id) => del(`/api/reminders/${encodeURIComponent(id)}`),

  listTodos: () => get('/api/todos'),
  createTodo: (item, listName = 'default') => post('/api/todos', { item, list_name: listName }),
  updateTodo: (id, patch) => put(`/api/todos/${encodeURIComponent(id)}`, patch),
  deleteTodo: (id) => del(`/api/todos/${encodeURIComponent(id)}`),

  listNotes: () => get('/api/notes'),
  createNote: (title, content = '') => post('/api/notes', { title, content }),
  deleteNote: (id) => del(`/api/notes/${encodeURIComponent(id)}`),

  /* ---- settings & permissions ---- */
  getSettings: () => get('/api/settings'),
  putSettings: (patch) => put('/api/settings', patch),
  getPermissions: () => get('/api/permissions'),
  putPermissions: (patch) => put('/api/permissions', patch),

  /* ---- activity / upload / voice / data ---- */
  getActivity: (limit = 100) => get(`/api/activity?limit=${limit}`),

  async upload(file) {
    const form = new FormData();
    form.append('file', file, file.name);
    return post('/api/upload', form);
  },

  voiceRecord: (action) => post('/api/voice/record', { action }), // "start" | "stop"
  voiceSpeak: (text) => post('/api/voice/speak', { text }),

  deleteAllData: () => post('/api/data/delete-all'),
};
