// luna/ui/js/screens/chat.js
// The main chat experience: hero empty-state, streaming markdown messages,
// action proposal/result cards, attachments (picker + drag-drop), voice
// in/out, stop generation, thinking indicator.
//
// SSE events consumed (names exactly per SPEC §6):
//   meta, token, action_proposal, action_result, memory_saved, done, error

import { el, timeOfDayGreeting, formatClockTime, uid } from '../util.js';
import { api } from '../api.js';
import {
  state, userName, assistantName, truthy, getSetting, voiceAvailable,
} from '../state.js';
import { renderMarkdownInto } from '../markdown.js';
import { toast } from '../components/toast.js';
import { renderShell, refreshConversations, highlightActiveConversation } from '../components/shell.js';

const EXAMPLE_PROMPTS = [
  { emoji: '🗂️', text: 'Organize my Downloads folder' },
  { emoji: '🔎', text: 'Find my resume' },
  { emoji: '⏰', text: 'Remind me tomorrow at 9 to stretch' },
  { emoji: '📄', text: 'Summarize a PDF for me' },
];

const ICONS = {
  send: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m22 2-7 20-4-9-9-4z"/><path d="M22 2 11 13"/></svg>',
  stop: '<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>',
  paperclip: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>',
  mic: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><path d="M12 19v3"/></svg>',
  speaker: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H2v6h4l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.4 5.6a9 9 0 0 1 0 12.8"/></svg>',
  copy: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
  file: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5z"/><path d="M14 2v6h6"/></svg>',
  arrowDown: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14"/><path d="m19 12-7 7-7-7"/></svg>',
};

const ACTION_ICONS = {
  open_app: '🚀', search_files: '🔎', summarize_document: '📄', create_note: '📝',
  draft_email: '✉️', set_reminder: '⏰', create_todo: '☑️', organize_downloads: '🗂️',
  remember: '🧠', default: '✨',
};

export async function render(container, param) {
  const main = renderShell(container, 'chat');
  state.activeConversationId = param || null;
  highlightActiveConversation();

  /* ================= local screen state ================= */
  let streaming = false;
  let abortController = null;
  let currentAssistant = null; // {root, cardsEl, bubble, contentEl, buffer, gotToken, footer}
  let renderQueued = false;
  let doneReceived = false;
  let composerAtts = []; // {localId, name, kind, attachmentId, status, objectUrl}
  let recording = false;
  let speakingUtterance = null;

  /* ================= DOM ================= */
  const chatTitle = el('div', { class: 'chat-title' }, 'New chat');
  const modelChip = el('span', { class: 'chip chip-neutral model-chip' },
    state.health?.active_model || 'local model');

  const autoSpeakInput = el('input', { type: 'checkbox' });
  autoSpeakInput.checked = truthy(getSetting('auto_speak'));
  autoSpeakInput.addEventListener('change', async () => {
    try {
      await api.putSettings({ auto_speak: autoSpeakInput.checked });
      state.settings.auto_speak = autoSpeakInput.checked;
    } catch (_err) {
      state.settings.auto_speak = autoSpeakInput.checked; // still honor locally
    }
  });

  const header = el('div', { class: 'chat-header' }, [
    chatTitle,
    modelChip,
    el('label', { class: 'autospeak-label', title: 'Read every reply aloud automatically' }, [
      el('span', {}, '🔊 Auto-speak'),
      el('span', { class: 'switch' }, [
        autoSpeakInput,
        el('span', { class: 'track' }),
        el('span', { class: 'thumb' }),
      ]),
    ]),
  ]);

  /* ---- hero (empty chat) ---- */
  const hero = el('div', { class: 'chat-hero' }, [
    el('div', { class: 'hero-moon', html:
      `<svg width="64" height="64" viewBox="0 0 64 64" fill="none">
        <defs><linearGradient id="herograd" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#b7a8ff"/><stop offset="1" stop-color="#7c6cf0"/>
        </linearGradient></defs>
        <path fill="url(#herograd)" d="M42.8 8.2A26 26 0 1 0 55.8 41 21 21 0 0 1 42.8 8.2z"/>
      </svg>` }),
    el('h1', { class: 'hero-greeting' },
      `${timeOfDayGreeting()}${userName() ? `, ${userName()}` : ''} 🌙`),
    el('p', { class: 'hero-sub' }, 'What can I do for you?'),
    el('div', { class: 'hero-chips' }, EXAMPLE_PROMPTS.map((p) =>
      el('button', { class: 'hero-chip', onClick: () => {
        input.value = p.text;
        input.focus();
        autoGrow();
        sendMessage();
      } }, [
        el('span', { class: 'chip-emoji', 'aria-hidden': 'true' }, p.emoji),
        el('span', {}, p.text),
      ])
    )),
  ]);

  const messagesEl = el('div', { class: 'chat-messages' });
  const scroller = el('div', { class: 'chat-scroll hidden' }, [messagesEl]);

  const scrollBtn = el('button', { class: 'scroll-bottom-btn hidden', onClick: () => scrollToBottom(true) }, [
    el('span', { html: ICONS.arrowDown }), 'Jump to latest',
  ]);

  /* ---- composer ---- */
  const attachmentsBar = el('div', { class: 'composer-attachments' });
  const input = el('textarea', {
    class: 'composer-input',
    placeholder: `Message ${assistantName()}…`,
    rows: '1',
    'aria-label': 'Message input',
  });

  const fileInput = el('input', {
    type: 'file', class: 'hidden', multiple: true,
    accept: '.txt,.md,.pdf,image/*',
  });
  fileInput.addEventListener('change', () => {
    addFiles(Array.from(fileInput.files || []));
    fileInput.value = '';
  });

  const attachBtn = el('button', {
    class: 'icon-btn', title: 'Attach a file (txt, md, pdf, image)',
    'aria-label': 'Attach file', html: ICONS.paperclip,
    onClick: () => fileInput.click(),
  });

  const micBtn = el('button', {
    class: 'icon-btn', title: 'Voice input — click to start, click again to stop',
    'aria-label': 'Voice input', html: ICONS.mic,
    onClick: toggleRecording,
  });
  if (!voiceAvailable()) micBtn.classList.add('hidden');

  const sendBtn = el('button', {
    class: 'composer-send', title: 'Send (Enter)', 'aria-label': 'Send message',
    html: ICONS.send,
    onClick: () => (streaming ? stopGeneration() : sendMessage()),
  });

  const statusLine = el('div', { class: 'composer-status' }, [
    el('span', { class: 'composer-hint' }, 'Enter to send · Shift+Enter for a new line · Esc to stop'),
  ]);

  const composer = el('div', { class: 'composer' }, [
    attachmentsBar,
    el('div', { class: 'composer-row' }, [attachBtn, fileInput, input, micBtn, sendBtn]),
  ]);

  const composerWrap = el('div', { class: 'composer-wrap' }, [composer, statusLine]);

  const screen = el('div', { class: 'chat-screen' }, [
    header, hero, scroller, scrollBtn, composerWrap,
  ]);
  main.appendChild(screen);

  /* ================= composer behavior ================= */
  function autoGrow() {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 200) + 'px';
  }
  input.addEventListener('input', autoGrow);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (!streaming) sendMessage();
    }
  });

  const onGlobalKey = (e) => {
    if (e.key === 'Escape' && streaming) {
      e.preventDefault();
      stopGeneration();
    }
  };
  document.addEventListener('keydown', onGlobalKey);

  /* ---- drag & drop ---- */
  let dragDepth = 0;
  const onDragEnter = (e) => { e.preventDefault(); dragDepth++; composer.classList.add('drag-over'); };
  const onDragOver = (e) => { e.preventDefault(); };
  const onDragLeave = (e) => {
    e.preventDefault();
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) composer.classList.remove('drag-over');
  };
  const onDrop = (e) => {
    e.preventDefault();
    dragDepth = 0;
    composer.classList.remove('drag-over');
    if (e.dataTransfer?.files?.length) addFiles(Array.from(e.dataTransfer.files));
  };
  screen.addEventListener('dragenter', onDragEnter);
  screen.addEventListener('dragover', onDragOver);
  screen.addEventListener('dragleave', onDragLeave);
  screen.addEventListener('drop', onDrop);

  /* ================= attachments ================= */
  function addFiles(files) {
    for (const file of files) {
      const localId = uid('att');
      const isImage = (file.type || '').startsWith('image/');
      const att = {
        localId,
        name: file.name,
        kind: isImage ? 'image' : 'file',
        attachmentId: null,
        status: 'uploading',
        objectUrl: isImage ? URL.createObjectURL(file) : null,
      };
      composerAtts.push(att);
      renderComposerAtts();

      api.upload(file).then((res) => {
        att.attachmentId = res?.attachment_id ?? null;
        att.kind = res?.kind || att.kind;
        att.name = res?.name || att.name;
        att.status = att.attachmentId != null ? 'ok' : 'error';
        if (att.status === 'error') toast(`Upload of ${att.name} returned no id`, 'error');
        renderComposerAtts();
      }).catch((err) => {
        composerAtts = composerAtts.filter((a) => a.localId !== localId);
        renderComposerAtts();
        toast(`Couldn’t upload ${file.name}: ${err.message}`, 'error');
      });
    }
  }

  function renderComposerAtts() {
    attachmentsBar.innerHTML = '';
    for (const att of composerAtts) {
      attachmentsBar.appendChild(
        el('span', { class: `composer-att${att.status === 'uploading' ? ' uploading' : ''}` }, [
          att.objectUrl
            ? el('img', { src: att.objectUrl, alt: '' })
            : el('span', { html: ICONS.file }),
          el('span', { class: 'att-name', title: att.name }, att.name),
          att.status === 'uploading' && el('span', { class: 'spinner' }),
          el('button', {
            class: 'icon-btn att-remove', 'aria-label': `Remove ${att.name}`,
            onClick: () => {
              if (att.objectUrl) URL.revokeObjectURL(att.objectUrl);
              composerAtts = composerAtts.filter((a) => a.localId !== att.localId);
              renderComposerAtts();
            },
          }, '✕'),
        ])
      );
    }
  }

  /* ================= voice in (mic) ================= */
  async function toggleRecording() {
    if (streaming) return;
    if (!recording) {
      try {
        await api.voiceRecord('start');
        recording = true;
        micBtn.classList.add('recording');
        micBtn.title = 'Recording… click to stop';
        setStatus('recording', '🎙️ Listening… click the mic again to stop');
      } catch (err) {
        toast(`Voice input unavailable: ${err.message}`, 'error');
        micBtn.classList.add('hidden'); // §7.3: degrade, never crash
      }
    } else {
      recording = false;
      micBtn.classList.remove('recording');
      micBtn.title = 'Voice input — click to start, click again to stop';
      setStatus('transcribing', 'Transcribing…');
      try {
        const res = await api.voiceRecord('stop');
        const text = res?.text || '';
        if (text) {
          input.value = input.value ? `${input.value.replace(/\s+$/, '')} ${text}` : text;
          autoGrow();
          input.focus();
        } else {
          toast('Didn’t catch that — try again a bit closer to the mic', 'info');
        }
      } catch (err) {
        toast(`Transcription failed: ${err.message}`, 'error');
      } finally {
        clearStatus();
      }
    }
  }

  /* ================= voice out (read aloud) ================= */
  function speakText(text, button = null) {
    if (!('speechSynthesis' in window)) {
      api.voiceSpeak(text).catch(() => toast('Text-to-speech unavailable', 'error'));
      return;
    }
    if (speakingUtterance) {
      window.speechSynthesis.cancel();
      const wasSame = speakingUtterance.__btn === button;
      speakingUtterance = null;
      document.querySelectorAll('.msg-footer .icon-btn.active').forEach((b) => b.classList.remove('active'));
      if (wasSame) return; // toggled off
    }
    const utter = new SpeechSynthesisUtterance(text);
    utter.rate = 1.02;
    utter.__btn = button;
    utter.onend = utter.onerror = () => {
      speakingUtterance = null;
      button?.classList.remove('active');
    };
    speakingUtterance = utter;
    button?.classList.add('active');
    window.speechSynthesis.speak(utter);
  }

  /* ================= status line ================= */
  function setStatus(phase, label) {
    statusLine.innerHTML = '';
    statusLine.appendChild(el('span', { class: 'status-dot' }));
    statusLine.appendChild(el('span', {}, label));
    statusLine.appendChild(el('span', { class: 'composer-hint' },
      phase === 'writing' || phase === 'thinking' ? 'Esc to stop' : ''));
  }
  function clearStatus() {
    statusLine.innerHTML = '';
    statusLine.appendChild(el('span', { class: 'composer-hint' },
      'Enter to send · Shift+Enter for a new line · Esc to stop'));
  }

  /* ================= scrolling ================= */
  function isNearBottom() {
    return scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 90;
  }
  function scrollToBottom(force = false) {
    if (force || isNearBottom()) scroller.scrollTop = scroller.scrollHeight;
  }
  scroller.addEventListener('scroll', () => {
    scrollBtn.classList.toggle('hidden', !streaming || isNearBottom());
  });

  /* ================= message rendering ================= */
  function showConversationUI() {
    hero.classList.add('hidden');
    scroller.classList.remove('hidden');
  }

  function appendUserMessage(text, atts = []) {
    showConversationUI();
    const attEls = atts.length
      ? el('div', { class: 'msg-attachments' }, atts.map((a) =>
          a.objectUrl && a.kind === 'image'
            ? el('img', { class: 'attachment-thumb', src: a.objectUrl, alt: a.name, title: a.name })
            : el('span', { class: 'attachment-chip' }, [
                el('span', { html: ICONS.file }),
                el('span', { class: 'att-name', title: a.name }, a.name),
              ])
        ))
      : null;

    const initial = (userName() || 'You').trim().charAt(0).toUpperCase() || 'Y';
    messagesEl.appendChild(
      el('div', { class: 'msg msg-user' }, [
        el('div', { class: 'msg-avatar' }, initial),
        el('div', { class: 'msg-body' }, [
          attEls,
          el('div', { class: 'msg-bubble' }, text),
          el('div', { class: 'msg-footer' }, [
            el('span', { class: 'msg-time' }, formatClockTime(new Date())),
          ]),
        ]),
      ])
    );
    scrollToBottom(true);
  }

  function newAssistantMessage() {
    showConversationUI();
    const cardsEl = el('div', { class: 'assistant-cards', style: 'display:flex;flex-direction:column;gap:10px;' });
    const contentEl = el('div', { class: 'md-content' });
    const bubble = el('div', { class: 'msg-bubble streaming' }, [
      el('div', { class: 'thinking-dots', 'aria-label': `${assistantName()} is thinking` }, [
        el('span'), el('span'), el('span'),
        el('span', { class: 'thinking-label' }, `${assistantName()} is thinking…`),
      ]),
      contentEl,
    ]);
    const footer = el('div', { class: 'msg-footer' });
    const body = el('div', { class: 'msg-body' }, [cardsEl, bubble, footer]);
    const root = el('div', { class: 'msg msg-assistant' }, [
      el('div', { class: 'msg-avatar' }, '🌙'),
      body,
    ]);
    messagesEl.appendChild(root);
    scrollToBottom(true);
    return {
      root, cardsEl, bubble, contentEl, footer, body,
      buffer: '', gotToken: false, actionCards: new Map(), memoryPills: [],
    };
  }

  function scheduleRender() {
    if (renderQueued) return;
    renderQueued = true;
    requestAnimationFrame(() => {
      renderQueued = false;
      if (!currentAssistant) return;
      const wasNear = isNearBottom();
      renderMarkdownInto(currentAssistant.contentEl, currentAssistant.buffer);
      if (wasNear) scrollToBottom(true);
    });
  }

  function finalizeAssistant({ error = null, interrupted = false } = {}) {
    if (!currentAssistant) return;
    const a = currentAssistant;
    a.bubble.classList.remove('streaming');
    a.bubble.querySelector('.thinking-dots')?.remove();

    if (error) {
      a.bubble.classList.add('error-bubble');
      a.contentEl.textContent = error;
    } else {
      renderMarkdownInto(a.contentEl, a.buffer); // final, fully-highlighted pass
      if (interrupted && a.buffer) {
        a.footer.appendChild(el('span', { class: 'msg-time' }, '· stopped'));
      }
      if (!a.buffer && !a.actionCards.size && !error) {
        // stream ended with no content at all
        a.contentEl.textContent = interrupted
          ? '(stopped before replying)'
          : '(no response — connection closed early)';
        a.contentEl.style.color = 'var(--text-tertiary)';
      }
    }

    // footer: time + copy + read-aloud
    const plain = a.contentEl.textContent || '';
    a.footer.prepend(
      el('span', { class: 'msg-time' }, formatClockTime(new Date())),
      el('button', {
        class: 'icon-btn', title: 'Copy reply', 'aria-label': 'Copy reply', html: ICONS.copy,
        onClick: async () => {
          const { copyText } = await import('../markdown.js');
          (await copyText(plain)) ? toast('Copied to clipboard', 'success') : toast('Copy failed', 'error');
        },
      }),
      (() => {
        const b = el('button', {
          class: 'icon-btn', title: 'Read aloud', 'aria-label': 'Read aloud', html: ICONS.speaker,
        });
        b.addEventListener('click', () => speakText(plain, b));
        return b;
      })()
    );

    if (!error && !interrupted && plain && truthy(state.settings.auto_speak)) {
      speakText(plain);
    }
    currentAssistant = null;
  }

  /* ================= action cards ================= */
  function createActionCard(data) {
    const {
      action_id, intent, label, params, preview, needs_permission, permission_category,
    } = data || {};
    const icon = ACTION_ICONS[intent] || ACTION_ICONS.default;

    const statusChip = el('span', { class: 'chip chip-info action-card-status' }, 'Awaiting approval');
    const resultEl = el('div', { class: 'action-card-result hidden' });

    let previewText = '';
    if (typeof preview === 'string') previewText = preview;
    else if (preview != null) previewText = JSON.stringify(preview, null, 2);
    else if (params && Object.keys(params).length) previewText = JSON.stringify(params, null, 2);

    const approveBtn = el('button', { class: 'btn btn-primary btn-sm' }, 'Approve');
    const alwaysBtn = needs_permission && permission_category
      ? el('button', { class: 'btn btn-outline btn-sm', title: `Always allow "${permission_category}" actions` }, 'Always allow')
      : null;
    const denyBtn = el('button', { class: 'btn btn-ghost btn-sm' }, 'Deny');
    const actionsRow = el('div', { class: 'action-card-actions' },
      [approveBtn, alwaysBtn, denyBtn].filter(Boolean));

    const card = el('div', { class: 'action-card', dataset: { actionId: String(action_id) } }, [
      el('div', { class: 'action-card-head' }, [
        el('span', { class: 'action-card-icon', 'aria-hidden': 'true' }, icon),
        el('div', { class: 'action-card-titles' }, [
          el('div', { class: 'action-card-label' }, label || intent || 'Proposed action'),
          intent && el('div', { class: 'action-card-intent' }, intent),
        ]),
        statusChip,
      ]),
      previewText && el('div', { class: 'action-card-preview' }, previewText),
      needs_permission && el('div', { class: 'action-card-permission-note' },
        `⚠ Needs the “${permission_category || 'general'}” permission`),
      actionsRow,
      resultEl,
    ]);

    const setState = (name, detail = '') => {
      card.classList.remove('state-executing', 'state-ok', 'state-error', 'state-denied');
      if (name === 'executing') {
        card.classList.add('state-executing');
        statusChip.className = 'chip action-card-status';
        statusChip.textContent = 'Running…';
        actionsRow.classList.add('hidden');
      } else if (name === 'ok') {
        card.classList.add('state-ok');
        statusChip.className = 'chip chip-success action-card-status';
        statusChip.textContent = 'Done';
        actionsRow.classList.add('hidden');
      } else if (name === 'error') {
        card.classList.add('state-error');
        statusChip.className = 'chip chip-danger action-card-status';
        statusChip.textContent = 'Failed';
        actionsRow.classList.add('hidden');
      } else if (name === 'denied') {
        card.classList.add('state-denied');
        statusChip.className = 'chip chip-neutral action-card-status';
        statusChip.textContent = 'Denied';
        actionsRow.classList.add('hidden');
      }
      if (detail) {
        resultEl.textContent = detail;
        resultEl.classList.remove('hidden');
      }
    };

    async function decide(approved, remember) {
      approveBtn.disabled = denyBtn.disabled = true;
      if (alwaysBtn) alwaysBtn.disabled = true;
      try {
        if (approved) setState('executing');
        else setState('denied', 'You declined this action. Nothing was executed.');
        await api.confirmAction(action_id, approved, remember);
        // On approve, the pending SSE stream continues → action_result arrives there.
      } catch (err) {
        setState('error', `Couldn’t send your decision: ${err.message}`);
      }
    }

    approveBtn.addEventListener('click', () => decide(true, undefined));
    alwaysBtn?.addEventListener('click', () => decide(true, true));
    denyBtn.addEventListener('click', () => decide(false, undefined));

    return { card, setState };
  }

  /* ================= SSE event handling ================= */
  function handleEvent(eventName, data) {
    switch (eventName) {
      case 'meta': {
        if (data?.conversation_id != null) {
          const isNew = state.activeConversationId == null;
          state.activeConversationId = data.conversation_id;
          if (isNew) {
            history.replaceState(null, '', `#/chat/${data.conversation_id}`);
            refreshConversations();
          }
          highlightActiveConversation();
        }
        break;
      }
      case 'token': {
        if (!currentAssistant) currentAssistant = newAssistantMessage();
        if (!currentAssistant.gotToken) {
          currentAssistant.gotToken = true;
          currentAssistant.bubble.querySelector('.thinking-dots')?.remove();
          setStatus('writing', `${assistantName()} is writing…`);
        }
        currentAssistant.buffer += data?.text ?? '';
        scheduleRender();
        break;
      }
      case 'action_proposal': {
        if (!currentAssistant) currentAssistant = newAssistantMessage();
        currentAssistant.bubble.querySelector('.thinking-dots')?.remove();
        const { card, setState } = createActionCard(data);
        currentAssistant.actionCards.set(String(data?.action_id), { card, setState });
        currentAssistant.cardsEl.appendChild(card);
        setStatus('waiting', 'Waiting for your decision…');
        scrollToBottom();
        break;
      }
      case 'action_result': {
        if (!currentAssistant) currentAssistant = newAssistantMessage();
        const key = String(data?.action_id);
        const entry = currentAssistant.actionCards.get(key);
        const ok = data?.status === 'ok';
        const detail = data?.detail || (ok ? 'Completed.' : 'Something went wrong.');
        if (entry) {
          entry.setState(ok ? 'ok' : 'error', detail);
        } else {
          // §4 fast-path: pre-granted read-only actions execute with no proposal
          // card — render a compact, already-resolved card.
          const { card, setState } = createActionCard({
            action_id: data?.action_id, intent: '', label: 'Action', needs_permission: false,
          });
          card.querySelector('.action-card-actions')?.classList.add('hidden');
          currentAssistant.actionCards.set(key, { card, setState });
          currentAssistant.cardsEl.appendChild(card);
          setState(ok ? 'ok' : 'error', detail);
        }
        currentAssistant.bubble.querySelector('.thinking-dots')?.remove();
        setStatus('thinking', `${assistantName()} is thinking…`);
        scrollToBottom();
        break;
      }
      case 'memory_saved': {
        const target = currentAssistant?.body || messagesEl;
        const pill = el('span', { class: 'memory-pill', title: data?.text || '' },
          `🧠 Remembered: ${data?.text || ''}`);
        if (currentAssistant) currentAssistant.body.appendChild(pill);
        else target.appendChild(pill);
        scrollToBottom();
        break;
      }
      case 'done': {
        doneReceived = true;
        break;
      }
      case 'error': {
        const message = data?.message || 'Something went wrong on Luna’s side.';
        if (currentAssistant && currentAssistant.buffer) {
          // keep partial text, add an error note under it
          currentAssistant.body.appendChild(
            el('div', { class: 'msg-bubble error-bubble' }, message));
          doneReceived = true; // treat as terminal
        } else {
          if (!currentAssistant) currentAssistant = newAssistantMessage();
          finalizeAssistant({ error: message });
          doneReceived = true;
        }
        break;
      }
      case '__parse_error__': {
        console.warn('SSE frame with unparseable JSON:', data);
        break;
      }
      default:
        console.warn('Unknown SSE event ignored:', eventName, data);
    }
  }

  /* ================= send / stop ================= */
  async function sendMessage() {
    const text = input.value.trim();
    if (!text || streaming) return;
    if (composerAtts.some((a) => a.status === 'uploading')) {
      toast('Hold on — still uploading your attachment…', 'info');
      return;
    }

    const atts = composerAtts.slice();
    const attachmentIds = atts.filter((a) => a.attachmentId != null).map((a) => a.attachmentId);

    input.value = '';
    autoGrow();
    composerAtts = [];
    renderComposerAtts();

    appendUserMessage(text, atts);

    streaming = true;
    doneReceived = false;
    sendBtn.classList.add('stop-mode');
    sendBtn.innerHTML = ICONS.stop;
    sendBtn.title = 'Stop generating (Esc)';
    micBtn.disabled = true;
    setStatus('thinking', `${assistantName()} is thinking…`);

    currentAssistant = newAssistantMessage();
    abortController = new AbortController();
    const wasAborted = () => abortController?.signal.aborted;

    try {
      await api.chatStream(
        { conversationId: state.activeConversationId, message: text, attachmentIds },
        handleEvent,
        { signal: abortController.signal }
      );
      // Stream ended.
      finalizeAssistant({ interrupted: wasAborted() || !doneReceived });
      if (!doneReceived && !wasAborted()) {
        toast('Connection to Luna closed early — reply may be incomplete', 'info');
      }
    } catch (err) {
      if (wasAborted()) {
        finalizeAssistant({ interrupted: true });
      } else {
        finalizeAssistant({
          error: `Luna couldn’t reply: ${err.message}. Check that the backend is running, then try again.`,
        });
      }
    } finally {
      streaming = false;
      abortController = null;
      sendBtn.classList.remove('stop-mode');
      sendBtn.innerHTML = ICONS.send;
      sendBtn.title = 'Send (Enter)';
      micBtn.disabled = false;
      scrollBtn.classList.add('hidden');
      clearStatus();
      refreshConversations(); // titles are auto-generated server-side
      updateHeaderTitle();
      input.focus();
    }
  }

  function stopGeneration() {
    if (!streaming) return;
    if (state.activeConversationId != null) {
      api.chatStop(state.activeConversationId).catch(() => { /* stream abort is the fallback */ });
    }
    abortController?.abort();
  }

  /* ================= history loading ================= */
  function updateHeaderTitle() {
    const convo = state.conversations.find(
      (c) => String(c.id) === String(state.activeConversationId));
    chatTitle.textContent = convo?.title || (state.activeConversationId ? 'Conversation' : 'New chat');
  }

  async function loadHistory(conversationId) {
    showConversationUI();
    messagesEl.innerHTML = '';
    const loading = el('div', { class: 'empty-state' }, [el('span', { class: 'spinner spinner-lg' })]);
    messagesEl.appendChild(loading);
    try {
      const res = await api.getMessages(conversationId);
      const messages = Array.isArray(res) ? res : res?.messages || [];
      loading.remove();
      if (!messages.length) {
        messagesEl.appendChild(el('div', { class: 'empty-state' }, [
          el('div', { class: 'empty-icon' }, '💬'),
          el('h4', {}, 'Nothing here yet'),
          el('p', {}, 'Send a message below to get this conversation going.'),
        ]));
        return;
      }
      for (const m of messages) {
        let atts = [];
        try {
          const rawAtts = m.attachments ?? (m.attachments_json ? JSON.parse(m.attachments_json) : []);
          if (Array.isArray(rawAtts)) {
            atts = rawAtts.map((a) => ({
              name: a?.name || 'attachment', kind: a?.kind || 'file', objectUrl: null,
            }));
          }
        } catch (_err) { /* tolerate malformed attachment json */ }

        if (m.role === 'user') {
          appendUserMessage(m.content || '', atts);
        } else {
          const a = newAssistantMessage();
          a.bubble.classList.remove('streaming');
          a.bubble.querySelector('.thinking-dots')?.remove();
          renderMarkdownInto(a.contentEl, m.content || '');
          const plain = a.contentEl.textContent || '';
          a.footer.appendChild(el('span', { class: 'msg-time' },
            m.created_at ? formatClockTime(m.created_at) : ''));
          const speakBtn = el('button', {
            class: 'icon-btn', title: 'Read aloud', 'aria-label': 'Read aloud', html: ICONS.speaker,
          });
          speakBtn.addEventListener('click', () => speakText(plain, speakBtn));
          a.footer.appendChild(speakBtn);
        }
      }
      currentAssistant = null;
      scrollToBottom(true);
    } catch (err) {
      loading.remove();
      messagesEl.appendChild(el('div', { class: 'empty-state' }, [
        el('div', { class: 'empty-icon' }, '🌫️'),
        el('h4', {}, 'Couldn’t load this conversation'),
        el('p', {}, err.message),
      ]));
    }
  }

  /* ================= init ================= */
  updateHeaderTitle();
  if (state.activeConversationId != null) {
    loadHistory(state.activeConversationId).then(updateHeaderTitle);
  }
  input.focus();

  /* ================= cleanup ================= */
  return () => {
    document.removeEventListener('keydown', onGlobalKey);
    screen.removeEventListener('dragenter', onDragEnter);
    screen.removeEventListener('dragover', onDragOver);
    screen.removeEventListener('dragleave', onDragLeave);
    screen.removeEventListener('drop', onDrop);
    if (streaming) stopGeneration();
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    composerAtts.forEach((a) => a.objectUrl && URL.revokeObjectURL(a.objectUrl));
  };
}
