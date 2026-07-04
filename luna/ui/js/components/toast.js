// luna/ui/js/components/toast.js
// Lightweight toast notifications, stacked bottom-right.

const ICONS = {
  success:
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="m8.5 12.5 2.5 2.5 5-5.5"/></svg>',
  error:
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 8v5"/><path d="M12 16.5h.01"/></svg>',
  info:
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 11v5"/><path d="M12 7.5h.01"/></svg>',
};

export function toast(message, type = 'info', duration = 3200) {
  const root = document.getElementById('toast-root');
  if (!root) return;

  const node = document.createElement('div');
  node.className = `toast toast-${type}`;
  node.setAttribute('role', 'status');

  const icon = document.createElement('span');
  icon.className = 'toast-icon';
  icon.innerHTML = ICONS[type] || ICONS.info;

  const text = document.createElement('span');
  text.textContent = message;

  node.appendChild(icon);
  node.appendChild(text);
  root.appendChild(node);

  const dismiss = () => {
    node.classList.add('leaving');
    node.addEventListener('animationend', () => node.remove(), { once: true });
  };
  node.addEventListener('click', dismiss);
  setTimeout(dismiss, duration);
}
