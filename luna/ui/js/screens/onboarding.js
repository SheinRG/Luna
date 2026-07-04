// luna/ui/js/screens/onboarding.js
// First-run experience: 3 animated slides over a starfield. Skippable.
// Finishing (or skipping) routes to #/setup, where `onboarded` is persisted.

import { el } from '../util.js';
import { destroyShell } from '../components/shell.js';

const SLIDES = [
  {
    emoji: '🌙',
    title: 'Runs entirely on your device',
    text: 'Luna thinks locally. No cloud, no accounts, no data leaving this laptop — your conversations stay in a folder you can see and delete.',
  },
  {
    emoji: '🧠',
    title: 'Remembers what matters — you stay in control',
    text: 'Tell Luna your preferences once and she’ll remember. Every memory is visible, editable and deletable in the Memory screen. Nothing is hidden.',
  },
  {
    emoji: '⚡',
    title: 'Automates your desktop, with your permission',
    text: 'Open apps, find files, organize Downloads, set reminders. Every action asks first — and you can revoke any permission from the Privacy dashboard.',
  },
];

export function render(container) {
  destroyShell(container);
  container.innerHTML = '';

  let index = 0;

  // starfield
  const stars = [];
  for (let i = 0; i < 26; i++) {
    const size = Math.random() < 0.3 ? 2 : 1;
    stars.push(
      el('span', {
        class: 'star',
        style: `left:${Math.random() * 100}%;top:${Math.random() * 100}%;width:${size}px;height:${size}px;--tw:${(2 + Math.random() * 3).toFixed(1)}s;opacity:${(0.2 + Math.random() * 0.6).toFixed(2)};`,
      })
    );
  }

  const slideEls = SLIDES.map((slide, i) =>
    el('div', { class: `onboard-slide${i === 0 ? ' active' : ''}` }, [
      el('div', { class: 'onboard-illustration', 'aria-hidden': 'true' }, slide.emoji),
      el('h2', {}, slide.title),
      el('p', {}, slide.text),
    ])
  );

  const dots = SLIDES.map((_, i) =>
    el('button', {
      class: `onboard-dot${i === 0 ? ' active' : ''}`,
      'aria-label': `Go to slide ${i + 1}`,
      onClick: () => goTo(i),
    })
  );

  const nextBtn = el('button', { class: 'btn btn-primary btn-lg', onClick: () => goTo(index + 1) },
    'Next');
  const skipBtn = el('button', { class: 'btn btn-ghost', onClick: finish }, 'Skip');

  function goTo(i) {
    if (i >= SLIDES.length) {
      finish();
      return;
    }
    const prev = index;
    index = Math.max(0, Math.min(SLIDES.length - 1, i));
    slideEls.forEach((s, j) => {
      s.classList.toggle('active', j === index);
      s.classList.toggle('exit-left', j < index);
    });
    dots.forEach((d, j) => d.classList.toggle('active', j === index));
    nextBtn.textContent = index === SLIDES.length - 1 ? 'Get started' : 'Next';
    skipBtn.classList.toggle('hidden', index === SLIDES.length - 1);
    if (prev !== index) nextBtn.focus({ preventScroll: true });
  }

  function finish() {
    location.hash = '#/setup';
  }

  const screen = el('div', { class: 'onboarding' }, [
    ...stars,
    el('div', { class: 'onboarding-slides' }, slideEls),
    el('div', { class: 'onboarding-controls' }, [
      el('div', { class: 'onboard-dots' }, dots),
      el('div', { class: 'onboard-buttons' }, [skipBtn, nextBtn]),
    ]),
  ]);

  const onKey = (e) => {
    if (e.key === 'ArrowRight') goTo(index + 1);
    else if (e.key === 'ArrowLeft') goTo(index - 1);
  };
  document.addEventListener('keydown', onKey);

  container.appendChild(screen);
  nextBtn.focus({ preventScroll: true });

  return () => document.removeEventListener('keydown', onKey);
}
