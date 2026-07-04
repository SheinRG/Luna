// luna/ui/js/util.js
// Small dependency-free helpers shared across the app.

export function qs(sel, root = document) {
  return root.querySelector(sel);
}

export function qsa(sel, root = document) {
  return Array.from(root.querySelectorAll(sel));
}

export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (key === 'html') node.innerHTML = value;
    else if (value === true) node.setAttribute(key, '');
    else node.setAttribute(key, value);
  }
  for (const child of [].concat(children)) {
    if (child === null || child === undefined || child === false) continue;
    node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}

export function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[c]));
}

export function uid(prefix = 'id') {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function debounce(fn, wait = 250) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
}

export function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

export function classNames(...parts) {
  return parts.filter(Boolean).join(' ');
}

/** Human relative-ish time for lists ("2m ago", "Yesterday", "Jul 3"). */
export function formatRelativeTime(isoOrDate) {
  if (!isoOrDate) return '';
  const d = isoOrDate instanceof Date ? isoOrDate : new Date(isoOrDate);
  if (Number.isNaN(d.getTime())) return '';
  const now = new Date();
  const diffMs = now - d;
  const diffMin = Math.round(diffMs / 60000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const isSameYear = d.getFullYear() === now.getFullYear();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfDate = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dayDiff = Math.round((startOfToday - startOfDate) / 86400000);
  if (dayDiff === 0) return 'Today';
  if (dayDiff === 1) return 'Yesterday';
  if (dayDiff < 7) return d.toLocaleDateString(undefined, { weekday: 'long' });
  return d.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: isSameYear ? undefined : 'numeric',
  });
}

export function formatClockTime(isoOrDate) {
  const d = isoOrDate instanceof Date ? isoOrDate : new Date(isoOrDate);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

export function formatDateTimeLocalValue(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}`;
}

export function timeOfDayGreeting() {
  const h = new Date().getHours();
  if (h < 5) return 'Good night';
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  if (h < 21) return 'Good evening';
  return 'Good evening';
}

/** Very small best-effort natural-language due-time parser for the Tasks form.
 *  Recognizes: "tomorrow[, at H(:MM)( am|pm)]", "today at ...", "in N minutes/hours/days",
 *  weekday names ("monday"), and bare "H(:MM)(am|pm)" (assumes today, rolls to tomorrow
 *  if already past). Returns a Date or null if it can't confidently parse.
 */
export function parseNaturalDueTime(text) {
  if (!text) return null;
  const s = text.trim().toLowerCase();
  const now = new Date();

  const inMatch = s.match(/^in\s+(\d+)\s*(minute|min|hour|hr|day)s?$/);
  if (inMatch) {
    const n = parseInt(inMatch[1], 10);
    const unit = inMatch[2];
    const d = new Date(now);
    if (unit.startsWith('min')) d.setMinutes(d.getMinutes() + n);
    else if (unit.startsWith('hour') || unit.startsWith('hr')) d.setHours(d.getHours() + n);
    else d.setDate(d.getDate() + n);
    return d;
  }

  const timeRe = /(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/;
  const dayWords = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

  let base = null;
  if (/^tomorrow/.test(s)) {
    base = new Date(now);
    base.setDate(base.getDate() + 1);
  } else if (/^today/.test(s)) {
    base = new Date(now);
  } else {
    const dayIdx = dayWords.findIndex((w) => s.startsWith(w));
    if (dayIdx !== -1) {
      base = new Date(now);
      let delta = (dayIdx - now.getDay() + 7) % 7;
      if (delta === 0) delta = 7;
      base.setDate(base.getDate() + delta);
    }
  }

  const timeMatch = s.match(timeRe);
  if (base && timeMatch) {
    let hour = parseInt(timeMatch[1], 10);
    const min = timeMatch[2] ? parseInt(timeMatch[2], 10) : 0;
    const ampm = timeMatch[3];
    if (ampm === 'pm' && hour < 12) hour += 12;
    if (ampm === 'am' && hour === 12) hour = 0;
    base.setHours(hour, min, 0, 0);
    return base;
  }
  if (base) {
    base.setHours(9, 0, 0, 0);
    return base;
  }

  if (timeMatch && s.length <= 8) {
    let hour = parseInt(timeMatch[1], 10);
    const min = timeMatch[2] ? parseInt(timeMatch[2], 10) : 0;
    const ampm = timeMatch[3];
    if (ampm === 'pm' && hour < 12) hour += 12;
    if (ampm === 'am' && hour === 12) hour = 0;
    const d = new Date(now);
    d.setHours(hour, min, 0, 0);
    if (d < now) d.setDate(d.getDate() + 1);
    return d;
  }

  return null;
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
