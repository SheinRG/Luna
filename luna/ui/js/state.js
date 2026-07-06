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

/* ---------------- Theme, accent & font scale ---------------- */

const FONT_SIZES = { small: 0.92, medium: 1, large: 1.1, xl: 1.22 };

// Accent swatches offered in Settings > Appearance (REDESIGN).
export const ACCENTS = ['#ACA0F2', '#9FB2E8', '#8FBFC9', '#9FC9A4', '#C9B48F', '#C99FAE'];
export const DEFAULT_ACCENT = ACCENTS[0];

/** Normalize a stored theme value to the redesign's night/day.
 *  Tolerates the legacy dark/light values so old settings still work. */
export function normalizeTheme(theme) {
  if (theme === 'day' || theme === 'light') return 'day';
  return 'night';
}

export function applyTheme(theme) {
  const t = normalizeTheme(theme);
  document.documentElement.setAttribute('data-theme', t);
  localStorage.setItem(LS_PREFIX + 'theme', t);
  // Swap vendored highlight.js theme to match (dark hljs for night).
  const dark = document.getElementById('hljs-theme-dark');
  const light = document.getElementById('hljs-theme-light');
  if (dark && light) {
    dark.disabled = t !== 'night';
    light.disabled = t !== 'day';
  }
  emit('theme', t);
}

export function applyAccent(accent) {
  const hex = /^#[0-9a-fA-F]{6}$/.test(accent || '') ? accent : DEFAULT_ACCENT;
  document.documentElement.style.setProperty('--accent', hex);
  localStorage.setItem(LS_PREFIX + 'accent', hex);
  emit('accent', hex);
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
  applyTheme(localStorage.getItem(LS_PREFIX + 'theme') || 'night');
  applyAccent(localStorage.getItem(LS_PREFIX + 'accent') || DEFAULT_ACCENT);
  applyFontSize(localStorage.getItem(LS_PREFIX + 'font_size') || 'medium');
}

/** Called whenever fresh settings arrive from the backend. */
export function absorbSettings(settings) {
  state.settings = settings || {};
  if (settings?.theme) applyTheme(settings.theme);
  if (settings?.accent) applyAccent(settings.accent);
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
