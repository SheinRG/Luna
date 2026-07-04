// luna/ui/js/app.js
// Boot sequence:
//   1. Apply cached theme/font (no flash) and read the dev-only ?screen= param.
//   2. Probe GET /api/health + GET /api/settings.
//      · fetch fails            → full-screen "Luna can't reach her brain" + auto-retry
//      · ollama down/missing    → full-screen guide with the exact commands + Retry
//   3. Start the hash router; un-onboarded users are steered to #/onboarding.

import { el } from './util.js';
import { api } from './api.js';
import {
  state, applyCachedVisuals, absorbSettings, isOnboarded,
} from './state.js';
import { copyText } from './markdown.js';
import { toast } from './components/toast.js';
import { defineRoute, startRouter } from './router.js';

import * as onboarding from './screens/onboarding.js';
import * as setup from './screens/setup.js';
import * as chat from './screens/chat.js';
import * as memory from './screens/memory.js';
import * as tasks from './screens/tasks.js';
import * as privacy from './screens/privacy.js';
import * as settings from './screens/settings.js';

const appEl = document.getElementById('app');

defineRoute('onboarding', onboarding);
defineRoute('setup', setup);
defineRoute('chat', chat);
defineRoute('memory', memory);
defineRoute('tasks', tasks);
defineRoute('privacy', privacy);
defineRoute('settings', settings);

/* ======================================================================
 * DEV AFFORDANCE (and nothing more): `?screen=<name>` forces a screen to
 * render without waiting for the backend, so every state can be eyeballed
 * with a plain static file server. Screens already degrade gracefully when
 * their fetches fail, which is exactly what this exercises.
 * Valid values: onboarding setup chat memory tasks privacy settings
 *               backend-down ollama-down model-missing
 * ==================================================================== */
const DEBUG_SCREENS = new Set([
  'onboarding', 'setup', 'chat', 'memory', 'tasks', 'privacy', 'settings',
  'backend-down', 'ollama-down', 'model-missing',
]);

function debugScreenParam() {
  const value = new URLSearchParams(location.search).get('screen');
  return value && DEBUG_SCREENS.has(value) ? value : null;
}

/* ---------------------------------------------------------------------- */

function routeGuard(name) {
  if (state.debugScreen) return null; // debug preview: no redirects
  if (name === 'onboarding' || name === 'setup') return null;
  if (!isOnboarded()) return '#/onboarding';
  return null;
}

function beginRouting(initialHash) {
  if (initialHash && location.hash !== initialHash) {
    location.hash = initialHash;
  }
  startRouter(appEl, routeGuard);
}

/* ================= full-screen degraded states ================= */

let retryTimer = null;

function cmdBlock(command) {
  return el('div', { class: 'cmd-block' }, [
    el('code', {}, command),
    el('button', {
      class: 'icon-btn', title: 'Copy command', 'aria-label': `Copy: ${command}`,
      html: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
      onClick: async () => {
        (await copyText(command)) ? toast('Command copied', 'success') : toast('Copy failed', 'error');
      },
    }),
  ]);
}

function renderBackendDown() {
  clearInterval(retryTimer);
  appEl.innerHTML = '';

  const retryBtn = el('button', { class: 'btn btn-primary btn-lg', onClick: () => boot(true) },
    'Retry now');
  const status = el('span', { class: 'retry-status' }, [
    el('span', { class: 'spinner' }), 'Retrying automatically every 5 seconds…',
  ]);

  appEl.appendChild(el('div', { class: 'fullscreen-state' }, [
    el('div', { class: 'fullscreen-icon' }, '🌙'),
    el('h2', {}, 'Luna can’t reach her brain'),
    el('p', {},
      'The local backend isn’t answering. If you launched Luna.exe, give it a few seconds — otherwise start it from the project folder:'),
    cmdBlock('uv run python -m luna.main'),
    el('div', { class: 'state-actions' }, [retryBtn]),
    status,
    el('p', { class: 'fullscreen-note' },
      'Everything runs on this device — there’s no server to be down but your own. 🌌'),
  ]));

  if (!state.debugScreen) {
    retryTimer = setInterval(() => boot(true), 5000);
  }
}

function renderOllamaGuide(kind) {
  clearInterval(retryTimer);
  appEl.innerHTML = '';

  const model = state.health?.active_model || 'llama3.2:3b';
  const isMissing = kind === 'model_missing';

  const children = [
    el('div', { class: 'fullscreen-icon' }, isMissing ? '📦' : '🦙'),
    el('h2', {}, isMissing ? 'One model download to go' : 'Ollama isn’t running'),
    el('p', {}, isMissing
      ? `Luna thinks with a small local model, and “${model}” isn’t installed yet. Pull it once (about 2 GB) and you’re set forever — no cloud, no keys:`
      : 'Luna talks to Ollama for all of her thinking, and it isn’t answering on 127.0.0.1:11434. Start it, then come back:'),
    isMissing ? cmdBlock(`ollama pull ${model}`) : cmdBlock('ollama serve'),
  ];
  if (!isMissing) {
    children.push(el('p', { class: 'fullscreen-note' },
      'Tip: on Windows, launching the Ollama app from the Start Menu also works.'));
  }
  children.push(
    el('div', { class: 'state-actions' }, [
      el('button', { class: 'btn btn-primary btn-lg', onClick: () => boot(true) }, 'I did it — retry'),
    ]),
    el('p', { class: 'fullscreen-note' },
      'Luna will connect the moment Ollama is ready.')
  );

  appEl.appendChild(el('div', { class: 'fullscreen-state' }, children));
}

/* ================= boot ================= */

async function boot(isRetry = false) {
  if (!isRetry) {
    applyCachedVisuals();
    state.debugScreen = debugScreenParam();
  }

  // ---- DEV PREVIEW branch (see banner comment above) ----
  if (state.debugScreen) {
    clearInterval(retryTimer);
    // Best-effort background probes so previews look real when the backend
    // happens to be up; never block or gate on them.
    api.health().then((h) => { state.health = h; state.backendUp = true; }).catch(() => {});
    api.getSettings().then(absorbSettings).catch(() => {});
    const forced = state.debugScreen;
    if (forced === 'backend-down') return renderBackendDown();
    if (forced === 'ollama-down') return renderOllamaGuide('down');
    if (forced === 'model-missing') {
      state.health = state.health || { ollama: 'model_missing', models: [], active_model: 'llama3.2:3b' };
      return renderOllamaGuide('model_missing');
    }
    return beginRouting(`#/${forced}`);
  }

  // ---- normal boot ----
  let health;
  try {
    health = await api.health();
  } catch (_err) {
    state.backendUp = false;
    renderBackendDown();
    return;
  }

  clearInterval(retryTimer);
  state.backendUp = true;
  state.health = health;

  try {
    absorbSettings(await api.getSettings());
  } catch (_err) {
    // Settings route failing while health works is odd but shouldn't block;
    // defaults + localStorage cache carry us.
  }

  if (health?.ollama === 'down') return renderOllamaGuide('down');
  if (health?.ollama === 'model_missing') return renderOllamaGuide('model_missing');

  const initial = isOnboarded()
    ? (location.hash && location.hash !== '#/' ? null : '#/chat')
    : '#/onboarding';
  beginRouting(initial);
}

boot();
