// luna/ui/js/screens/setup.js
// One-card setup: your name, assistant name, theme, model picker (from
// /api/health). Persists via PUT /api/settings with onboarded=true.

import { el } from '../util.js';
import { api } from '../api.js';
import { state, applyTheme, getSetting, absorbSettings } from '../state.js';
import { toast } from '../components/toast.js';
import { destroyShell, LOGO_SVG } from '../components/shell.js';

const RECOMMENDED_MODEL = 'llama3.2:3b';
// Models above ~3 GB will swap on an 8 GB machine.
const BIG_MODEL_BYTES = 3 * 1024 * 1024 * 1024;

export function render(container) {
  destroyShell(container);
  container.innerHTML = '';

  let chosenTheme = document.documentElement.getAttribute('data-theme') || 'dark';
  let chosenModel =
    getSetting('model') || state.health?.active_model || RECOMMENDED_MODEL;

  const nameInput = el('input', {
    class: 'text-input',
    type: 'text',
    placeholder: 'e.g. Raghav',
    value: getSetting('user_name', ''),
    'aria-label': 'Your name',
    maxlength: '40',
  });

  const assistantInput = el('input', {
    class: 'text-input',
    type: 'text',
    placeholder: 'Luna',
    value: getSetting('assistant_name', 'Luna'),
    'aria-label': 'Assistant name',
    maxlength: '30',
  });

  /* ---- theme picker ---- */
  const themeButtons = {};
  const themePicker = el('div', { class: 'theme-picker' },
    ['dark', 'light'].map((t) => {
      const btn = el('button', {
        type: 'button',
        class: `theme-option${t === chosenTheme ? ' selected' : ''}`,
        onClick: () => {
          chosenTheme = t;
          applyTheme(t); // live preview
          Object.entries(themeButtons).forEach(([key, b]) =>
            b.classList.toggle('selected', key === t));
        },
      }, [
        el('div', { class: `theme-swatch ${t}-swatch` }),
        el('span', { class: 'theme-name' }, t === 'dark' ? 'Night (default)' : 'Day'),
      ]);
      themeButtons[t] = btn;
      return btn;
    })
  );

  /* ---- model picker ---- */
  const modelList = el('div', { class: 'model-list' });
  renderModelOptions(modelList, chosenModel, (m) => { chosenModel = m; });

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
      // Backend not reachable (or debug preview) — keep the user informed
      // but don't dead-end them; visuals were already applied locally.
      absorbSettings({ ...state.settings, ...patch });
      toast(`Couldn’t save to backend: ${err.message}`, 'error', 4200);
      finishBtn.disabled = false;
      finishBtn.textContent = 'Start talking to Luna';
    }
  }

  const card = el('div', { class: 'setup-card glass' }, [
    el('span', { class: 'sidebar-logo', html: LOGO_SVG }),
    el('h2', {}, 'Let’s set things up'),
    el('p', { class: 'setup-sub' }, 'Thirty seconds, all stored locally. You can change any of this later in Settings.'),
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
      themePicker,
    ]),
    el('div', { class: 'field' }, [
      el('label', { class: 'field-label' }, 'Model'),
      modelList,
      el('span', { class: 'field-hint' },
        'Running on CPU with 8 GB RAM — the recommended 3B model is the sweet spot.'),
    ]),
    finishBtn,
  ]);

  container.appendChild(el('div', { class: 'setup-screen' }, [card]));
  nameInput.focus();
  nameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') assistantInput.focus();
  });
}

/** Shared with Settings: renders model radio-style options from /api/health. */
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
      isRecommended && el('span', { class: 'chip chip-success' }, '✓ Recommended for this PC'),
      isBig && el('span', { class: 'chip chip-warning', title: 'Over 3 GB — may be slow on 8 GB RAM' },
        'may be slow on 8 GB RAM'),
    ]);
    buttons.push(btn);
    listEl.appendChild(btn);
  }
}
