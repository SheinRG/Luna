// luna/ui/js/state.js
// Central app state + tiny pub/sub. Settings live in the backend
// (GET/PUT /api/settings); we mirror them here and cache the visual ones
// (theme / font size) in localStorage so reloads don't flash.

const LS_PREFIX = 'luna.';

export const state = {
  backendUp: false,
  health: null, // {ollama, models, active_model, data_dir, ...}
  settings: {}, // flat key/value from /api/settings
  permissions: {}, // {apps, files, notifications, voice}
  conversations: [],
  activeConversationId: null,
  // DEV AFFORDANCE — set from ?screen=... query param; forces a screen to
  // render without any backend, so designers/judges can eyeball each state.
  debugScreen: null,
};

const listeners = new Map();

export function on(event, fn) {
  if (!listeners.has(event)) listeners.set(event, new Set());
  listeners.get(event).add(fn);
  return () => listeners.get(event)?.delete(fn);
}

export function emit(event, payload) {
  listeners.get(event)?.forEach((fn) => {
    try {
      fn(payload);
    } catch (err) {
      console.error(`listener for "${event}" failed`, err);
    }
  });
}

/* ---------------- Settings helpers ---------------- */

/** Backend stores settings as strings; normalize truthy values. */
export function truthy(value) {
  return value === true || value === 1 || value === '1' || value === 'true' || value === 'on';
}

export function getSetting(key, fallback = undefined) {
  const v = state.settings?.[key];
  return v === undefined || v === null || v === '' ? fallback : v;
}

export function userName() {
  return getSetting('user_name', '');
}

export function assistantName() {
  return getSetting('assistant_name', 'Luna');
}

export function isOnboarded() {
  return truthy(getSetting('onboarded', localStorage.getItem(LS_PREFIX + 'onboarded') || ''));
}

/* ---------------- Theme & font scale ---------------- */

const FONT_SIZES = { small: 0.9, medium: 1, large: 1.12, xl: 1.25 };

export function applyTheme(theme) {
  const t = theme === 'light' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', t);
  localStorage.setItem(LS_PREFIX + 'theme', t);
  // Swap vendored highlight.js theme to match
  const dark = document.getElementById('hljs-theme-dark');
  const light = document.getElementById('hljs-theme-light');
  if (dark && light) {
    dark.disabled = t !== 'dark';
    light.disabled = t !== 'light';
  }
  emit('theme', t);
}

export function applyFontSize(sizeNameOrScale) {
  let scale = FONT_SIZES[sizeNameOrScale];
  if (scale === undefined) {
    const n = parseFloat(sizeNameOrScale);
    scale = Number.isFinite(n) && n > 0.5 && n < 2 ? n : 1;
  }
  document.documentElement.style.setProperty('--font-scale', String(scale));
  localStorage.setItem(LS_PREFIX + 'font_size', String(sizeNameOrScale ?? 'medium'));
}

/** Apply cached visuals before the backend answers (no flash of defaults). */
export function applyCachedVisuals() {
  applyTheme(localStorage.getItem(LS_PREFIX + 'theme') || 'dark');
  applyFontSize(localStorage.getItem(LS_PREFIX + 'font_size') || 'medium');
}

/** Called whenever fresh settings arrive from the backend. */
export function absorbSettings(settings) {
  state.settings = settings || {};
  if (settings?.theme) applyTheme(settings.theme);
  if (settings?.font_size) applyFontSize(settings.font_size);
  if (settings?.onboarded !== undefined) {
    localStorage.setItem(LS_PREFIX + 'onboarded', truthy(settings.onboarded) ? '1' : '');
  }
  emit('settings', state.settings);
}

/* ---------------- Voice availability ---------------- */
// §6's /api/health contract only guarantees {ollama, models, active_model, data_dir}.
// If the backend adds a voice flag (health.voice === false | "down" | "unavailable"),
// we hide the mic; absent any flag we show it and degrade gracefully on failure.
export function voiceAvailable() {
  const h = state.health;
  if (!h) return true;
  if (h.voice === false || h.voice === 'down' || h.voice === 'unavailable') return false;
  if (h.voice_available === false) return false;
  return truthy(getSetting('voice_enabled', '1')) || getSetting('voice_enabled') === undefined;
}
