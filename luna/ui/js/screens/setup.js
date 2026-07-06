// luna/ui/js/screens/setup.js
// First-run setup: your name, assistant name, theme pills, model picker (from
// /api/health). Persists via PUT /api/settings with onboarded=true.

import { el } from '../util.js';
import { api } from '../api.js';
import {
  state, applyTheme, getSetting, absorbSettings, normalizeTheme,
} from '../state.js';
import { toast } from '../components/toast.js';
import { destroyShell, moonSvg } from '../components/shell.js';

const RECOMMENDED_MODEL = 'llama3.2:3b';
// Models above ~3 GB will swap on an 8 GB machine.
const BIG_MODEL_BYTES = 3 * 1024 * 1024 * 1024;

export function render(container) {
  destroyShell(container);
  container.innerHTML = '';

  let chosenTheme = normalizeTheme(
    getSetting('theme') || document.documentElement.getAttribute('data-theme') || 'night');
  let chosenModel = getSetting('model') || state.health?.active_model || RECOMMENDED_MODEL;

  const nameInput = el('input', {
    class: 'text-input', type: 'text', placeholder: 'Your name',
    value: getSetting('user_name', ''), 'aria-label': 'Your name', maxlength: '40',
  });

  const assistantInput = el('input', {
    class: 'text-input', type: 'text', placeholder: 'Luna',
    value: getSetting('assistant_name', 'Luna'), 'aria-label': 'Assistant name', maxlength: '30',
  });

  /* ---- theme pills ---- */
  const themeButtons = {};
  const themeRow = el('div', { class: 'pill-row' },
    [['night', 'Night'], ['day', 'Day']].map(([val, label]) => {
      const btn = el('button', {
        type: 'button',
        class: `pill${val === chosenTheme ? ' selected' : ''}`,
        onClick: () => {
          chosenTheme = val;
          applyTheme(val); // live preview
          Object.entries(themeButtons).forEach(([k, b]) => b.classList.toggle('selected', k === val));
        },
      }, label);
      themeButtons[val] = btn;
      return btn;
    })
  );

  /* ---- model picker ---- */
  const modelList = el('div', { class: 'model-list' });
  renderModelOptions(modelList, chosenModel, (m) => { chosenModel = m; });

  const backBtn = el('button', { class: 'text-btn', onClick: () => { location.hash = '#/onboarding'; } },
    'Back');
  const finishBtn = el('button', { class: 'btn btn-primary btn-lg', onClick: finish },
    'Start talking to Luna');

  async function finish() {
    const userName = nameInput.value.trim();
    if (!userName) {
      nameInput.focus();
      nameInput.style.borderColor = 'var(--danger)';
      setTimeout(() => { nameInput.style.borderColor = ''; }, 1500);
      return;
    }
    finishBtn.disabled = true;
    finishBtn.textContent = 'Saving…';
    const patch = {
      user_name: userName,
      assistant_name: assistantInput.value.trim() || 'Luna',
      theme: chosenTheme,
      model: chosenModel,
      onboarded: true,
    };
    try {
      await api.putSettings(patch);
      absorbSettings({ ...state.settings, ...patch });
      location.hash = '#/chat';
    } catch (err) {
      // Backend unreachable (or debug preview) — keep the user moving; visuals
      // were already applied locally.
      absorbSettings({ ...state.settings, ...patch });
      toast(`Couldn’t save to backend: ${err.message}`, 'error', 4200);
      finishBtn.disabled = false;
      finishBtn.textContent = 'Start talking to Luna';
    }
  }

  const card = el('div', { class: 'setup-card' }, [
    el('span', { class: 'setup-moon', html: moonSvg(26) }),
    el('h2', { class: 'setup-title' }, 'Before we begin'),
    el('p', { class: 'setup-sub' }, 'Thirty seconds. All of it stays on this device.'),
    el('div', { class: 'setup-fields' }, [
      el('div', { class: 'field' }, [
        el('label', { class: 'field-label' }, 'What should Luna call you?'),
        nameInput,
      ]),
      el('div', { class: 'field' }, [
        el('label', { class: 'field-label' }, 'Assistant name'),
        assistantInput,
      ]),
      el('div', { class: 'field' }, [
        el('label', { class: 'field-label' }, 'Theme'),
        themeRow,
      ]),
      el('div', { class: 'field' }, [
        el('label', { class: 'field-label' }, 'Model'),
        modelList,
        el('span', { class: 'setup-caption' },
          'Running on CPU with 8 GB RAM — the 3B model is the sweet spot.'),
      ]),
    ]),
    el('div', { class: 'setup-controls' }, [backBtn, finishBtn]),
  ]);

  container.appendChild(el('div', { class: 'setup' }, [card]));
  nameInput.focus();
  nameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') assistantInput.focus();
  });
}

/** Shared with Settings: renders model-picker buttons from /api/health. */
export function renderModelOptions(listEl, selected, onSelect) {
  listEl.innerHTML = '';
  const models = state.health?.models || [];

  if (!models.length) {
    listEl.appendChild(el('div', { class: 'model-empty-note', html:
      `No local models detected. Install the recommended one with ` +
      `<code>ollama pull ${RECOMMENDED_MODEL}</code> — Luna will pick it up on refresh.` }));
    return;
  }

  const buttons = [];
  for (const m of models) {
    // health.models entries may be plain names or {name, size} objects.
    const name = typeof m === 'string' ? m : m?.name || m?.model || String(m);
    const size = typeof m === 'object' && m !== null ? m.size ?? m.size_bytes ?? null : null;
    const isRecommended = name === RECOMMENDED_MODEL || name.startsWith(RECOMMENDED_MODEL);
    const isBig = typeof size === 'number' && size > BIG_MODEL_BYTES;

    let tag = null;
    if (isRecommended) tag = el('span', { class: 'model-tag recommended' }, 'recommended');
    else if (isBig) tag = el('span', { class: 'model-tag heavy', title: 'Over 3 GB — slow on 8 GB RAM' }, 'slow on 8 GB');

    const btn = el('button', {
      type: 'button',
      class: `model-option${name === selected ? ' selected' : ''}`,
      onClick: () => {
        buttons.forEach((b) => b.classList.remove('selected'));
        btn.classList.add('selected');
        onSelect(name);
      },
    }, [
      el('span', { class: 'model-name' }, name),
      tag,
    ]);
    buttons.push(btn);
    listEl.appendChild(btn);
  }
}
