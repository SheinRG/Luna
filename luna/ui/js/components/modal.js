// luna/ui/js/components/modal.js
// Promise-based confirm dialog. Supports an optional "type to confirm"
// input for extra-destructive operations (e.g. Delete all my data).

import { el } from '../util.js';

/**
 * @param {object} opts
 * @param {string} opts.title
 * @param {string} opts.message
 * @param {string} [opts.confirmLabel="Confirm"]
 * @param {string} [opts.cancelLabel="Cancel"]
 * @param {boolean} [opts.danger=false]
 * @param {string} [opts.requireText] - user must type this exact string to enable confirm
 * @returns {Promise<boolean>}
 */
export function confirmDialog({
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  danger = false,
  requireText = null,
} = {}) {
  return new Promise((resolve) => {
    const root = document.getElementById('modal-root');
    if (!root) {
      resolve(window.confirm(`${title}\n\n${message}`));
      return;
    }

    let settle;

    const confirmBtn = el('button', {
      class: `btn ${danger ? 'btn-danger' : 'btn-primary'}`,
      onClick: () => settle(true),
    }, confirmLabel);

    let input = null;
    if (requireText) {
      confirmBtn.disabled = true;
      input = el('input', {
        class: 'text-input',
        type: 'text',
        placeholder: `Type "${requireText}" to confirm`,
        'aria-label': `Type ${requireText} to confirm`,
        onInput: (e) => {
          confirmBtn.disabled = e.target.value.trim() !== requireText;
        },
      });
    }

    const cancelBtn = el('button', { class: 'btn btn-ghost', onClick: () => settle(false) },
      cancelLabel);

    const modal = el('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true' }, [
      el('h3', {}, title || 'Are you sure?'),
      el('p', {}, message || ''),
      input,
      el('div', { class: 'modal-actions' }, [cancelBtn, confirmBtn]),
    ]);

    const overlay = el('div', { class: 'modal-overlay' }, [modal]);
    overlay.addEventListener('mousedown', (e) => {
      if (e.target === overlay) settle(false);
    });

    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        settle(false);
      }
    };

    settle = (result) => {
      document.removeEventListener('keydown', onKey, true);
      overlay.remove();
      resolve(result);
    };

    document.addEventListener('keydown', onKey, true);
    root.appendChild(overlay);
    (input || confirmBtn.disabled ? input : confirmBtn)?.focus?.();
    if (!requireText) confirmBtn.focus();
  });
}
