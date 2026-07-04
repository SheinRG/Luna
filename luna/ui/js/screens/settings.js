// luna/ui/js/screens/settings.js
// Settings: names, theme, font size, personality, response length, model,
// voice toggles, memory on/off. GET/PUT /api/settings (flat JSON).

import { el, debounce } from '../util.js';
import { api } from '../api.js';
import {
  state, getSetting, truthy, applyTheme, applyFontSize,
} from '../state.js';
import { toast } from '../components/toast.js';
import { renderShell } from '../components/shell.js';
import { renderModelOptions } from './setup.js';

export async function render(container) {
  const main = renderShell(container, 'settings');

  async function save(patch, { silent = false } = {}) {
    Object.assign(state.settings, patch);
    try {
      await api.putSettings(patch);
      if (!silent) toast('Saved', 'success', 1400);
    } catch (err) {
      toast(`Couldn’t save (${err.message}) — change applied for this session only`, 'error', 4000);
    }
  }
  const saveDebounced = debounce(save, 500);

  /* ---------- builders ---------- */
  function rowText(label, desc, key, placeholder) {
    const input = el('input', {
      class: 'text-input', type: 'text', placeholder, value: getSetting(key, ''),
      'aria-label': label,
    });
    input.addEventListener('input', () => saveDebounced({ [key]: input.value.trim() }));
    return settingsRow(label, desc, input);
  }

  function rowSwitch(label, desc, key, defaultOn = false) {
    const input = el('input', { type: 'checkbox' });
    const current = getSetting(key);
    input.checked = current === undefined ? defaultOn : truthy(current);
    input.addEventListener('change', () => save({ [key]: input.checked }));
    return settingsRow(label, desc,
      el('label', { class: 'switch', 'aria-label': label }, [
        input, el('span', { class: 'track' }), el('span', { class: 'thumb' }),
      ]));
  }

  function rowSegmented(label, desc, key, options, current, onPick) {
    const seg = el('div', { class: 'segmented', role: 'group', 'aria-label': label });
    const buttons = options.map((opt) => {
      const value = typeof opt === 'string' ? opt : opt.value;
      const text = typeof opt === 'string' ? opt : opt.label;
      const btn = el('button', {
        type: 'button',
        class: value === current ? 'active' : '',
        onClick: () => {
          buttons.forEach((b) => b.classList.remove('active'));
          btn.classList.add('active');
          onPick ? onPick(value) : save({ [key]: value });
        },
      }, text);
      return btn;
    });
    buttons.forEach((b) => seg.appendChild(b));
    return settingsRow(label, desc, seg);
  }

  function settingsRow(label, desc, control) {
    return el('div', { class: 'settings-row' }, [
      el('div', { class: 'settings-info' }, [
        el('div', { class: 'settings-label' }, label),
        desc && el('div', { class: 'settings-desc' }, desc),
      ]),
      el('div', { class: 'settings-control' }, [control]),
    ]);
  }

  /* ---------- model picker ---------- */
  const modelList = el('div', { class: 'model-list', style: 'max-width:340px' });
  renderModelOptions(modelList, getSetting('model', state.health?.active_model || ''), (m) => {
    save({ model: m });
  });

  /* ---------- assemble ---------- */
  main.appendChild(el('div', { class: 'page' }, [
    el('div', { class: 'page-inner' }, [
      el('div', { class: 'page-header' }, [
        el('div', {}, [
          el('h2', {}, 'Settings'),
          el('p', { class: 'page-sub' }, 'Changes save automatically and stay on this device.'),
        ]),
      ]),

      el('h3', { class: 'section-title' }, '👤 Profile'),
      el('div', { class: 'settings-group' }, [
        rowText('Your name', 'Used in greetings and to personalize replies', 'user_name', 'e.g. Raghav'),
        rowText('Assistant name', 'What your assistant answers to', 'assistant_name', 'Luna'),
      ]),

      el('h3', { class: 'section-title' }, '🎨 Appearance'),
      el('div', { class: 'settings-group' }, [
        rowSegmented('Theme', 'Night is Luna’s natural habitat', 'theme',
          [{ value: 'dark', label: '🌙 Night' }, { value: 'light', label: '☀️ Day' }],
          document.documentElement.getAttribute('data-theme') || 'dark',
          (v) => { applyTheme(v); save({ theme: v }); }),
        rowSegmented('Font size', 'Scales the whole interface', 'font_size',
          [{ value: 'small', label: 'A' }, { value: 'medium', label: 'A+' },
           { value: 'large', label: 'A++' }, { value: 'xl', label: 'A+++' }],
          getSetting('font_size', 'medium'),
          (v) => { applyFontSize(v); save({ font_size: v }); }),
      ]),

      el('h3', { class: 'section-title' }, '✨ Assistant'),
      el('div', { class: 'settings-group' }, [
        rowSegmented('Personality', 'Sets the tone of every reply', 'personality',
          ['Friendly', 'Professional', 'Concise', 'Playful'],
          getSetting('personality', 'Friendly')),
        rowSegmented('Response length', 'Short answers are faster on this hardware', 'response_length',
          [{ value: 'short', label: 'Short' }, { value: 'medium', label: 'Medium' },
           { value: 'long', label: 'Long' }],
          getSetting('response_length', 'medium')),
        settingsRow('Model',
          'Which local Ollama model Luna thinks with',
          modelList),
        rowSwitch('Memory', 'Let Luna remember preferences and facts across chats', 'memory_enabled', true),
      ]),

      el('h3', { class: 'section-title' }, '🎙️ Voice'),
      el('div', { class: 'settings-group' }, [
        rowSwitch('Voice input', 'Show the mic button (uses the on-device Whisper model)', 'voice_enabled', true),
        rowSwitch('Auto-speak replies', 'Read every reply aloud when it finishes', 'auto_speak', false),
      ]),

      el('div', { style: 'height:24px' }),
    ]),
  ]));
}
