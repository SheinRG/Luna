// luna/ui/js/screens/onboarding.js
// First-run experience: 3 slides with an animated dot indicator. Skippable.
// Finishing (or skipping) routes to #/setup, where `onboarded` is persisted.

import { el } from '../util.js';
import { destroyShell, moonSvg } from '../components/shell.js';

const SLIDES = [
  {
    title: 'Runs entirely on your device.',
    text: 'No cloud, no accounts, no data leaving this laptop. Your conversations live in a folder you can see — and delete.',
  },
  {
    title: 'Remembers what matters. You stay in control.',
    text: 'Tell Luna your preferences once and she’ll remember. Every memory is visible, editable and deletable. Nothing is hidden.',
  },
  {
    title: 'Automates your desktop, with your permission.',
    text: 'Open apps, find files, organize Downloads, set reminders. Every action asks first — and every permission can be revoked.',
  },
];

export function render(container) {
  destroyShell(container);
  container.innerHTML = '';

  let index = 0;

  const slideEls = SLIDES.map((slide, i) =>
    el('div', { class: `onboard-slide${i === 0 ? ' active' : ''}` }, [
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

  const continueBtn = el('button', { class: 'btn btn-primary btn-lg', onClick: () => goTo(index + 1) },
    'Continue');
  const skipBtn = el('button', { class: 'text-btn', onClick: finish }, 'Skip');

  function goTo(i) {
    if (i >= SLIDES.length) {
      finish();
      return;
    }
    const prev = index;
    index = Math.max(0, Math.min(SLIDES.length - 1, i));
    slideEls.forEach((s, j) => s.classList.toggle('active', j === index));
    dots.forEach((d, j) => d.classList.toggle('active', j === index));
    continueBtn.textContent = index === SLIDES.length - 1 ? 'Get started' : 'Continue';
    skipBtn.classList.toggle('hidden', index === SLIDES.length - 1);
    if (prev !== index) continueBtn.focus({ preventScroll: true });
  }

  function finish() {
    location.hash = '#/setup';
  }

  const screen = el('div', { class: 'onboarding' }, [
    el('div', { class: 'onboard-moon', html: moonSvg(36) }),
    el('div', { class: 'onboard-slides' }, slideEls),
    el('div', { class: 'onboard-dots' }, dots),
    el('div', { class: 'onboard-controls' }, [skipBtn, continueBtn]),
  ]);

  const onKey = (e) => {
    if (e.key === 'ArrowRight') goTo(index + 1);
    else if (e.key === 'ArrowLeft') goTo(index - 1);
  };
  document.addEventListener('keydown', onKey);

  container.appendChild(screen);
  continueBtn.focus({ preventScroll: true });

  return () => document.removeEventListener('keydown', onKey);
}
