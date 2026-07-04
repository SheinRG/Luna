// luna/ui/js/router.js
// Minimal hash router: #/screen or #/screen/param.

const registry = new Map();
let container = null;
let beforeRoute = null;
let currentCleanup = null;
let currentName = null;

export function defineRoute(name, module) {
  registry.set(name, module);
}

/**
 * @param {HTMLElement} rootEl - element screens render into
 * @param {(name: string, param: string|null) => string|null} [guard]
 *   May return a hash (e.g. "#/onboarding") to redirect, or null to allow.
 */
export function startRouter(rootEl, guard) {
  container = rootEl;
  beforeRoute = guard || null;
  // idempotent: boot() may re-run after backend-down retries
  window.removeEventListener('hashchange', handleRoute);
  window.addEventListener('hashchange', handleRoute);
  handleRoute();
}

export function currentRoute() {
  return currentName;
}

export function parseHash() {
  const raw = (location.hash || '').replace(/^#\/?/, '');
  const [name, ...rest] = raw.split('/');
  return { name: name || 'chat', param: rest.length ? decodeURIComponent(rest.join('/')) : null };
}

async function handleRoute() {
  const { name, param } = parseHash();

  if (beforeRoute) {
    const redirect = beforeRoute(name, param);
    if (redirect && redirect !== location.hash) {
      location.hash = redirect;
      return;
    }
  }

  const module = registry.get(name) || registry.get('chat');
  if (!module) return;

  if (typeof currentCleanup === 'function') {
    try {
      currentCleanup();
    } catch (err) {
      console.error('screen cleanup failed', err);
    }
    currentCleanup = null;
  }

  currentName = name;
  try {
    const cleanup = await module.render(container, param);
    if (typeof cleanup === 'function') currentCleanup = cleanup;
  } catch (err) {
    console.error(`render of "${name}" failed`, err);
    container.innerHTML = `
      <div class="fullscreen-state">
        <div class="fullscreen-icon">🌘</div>
        <h2>Something went sideways</h2>
        <p>This screen hit an unexpected error. Try going back to chat.</p>
        <div class="state-actions">
          <button class="btn btn-primary" onclick="location.hash='#/chat'">Back to chat</button>
        </div>
      </div>`;
  }
}
