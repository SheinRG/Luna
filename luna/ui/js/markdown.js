// luna/ui/js/markdown.js
// Markdown rendering pipeline: marked (vendored) → DOM-based sanitizer →
// code-block enhancement (hljs highlight + copy button).
// Falls back to a minimal renderer if the vendored lib somehow failed to load.

/* ---------------- Sanitizer ---------------- */

const ALLOWED_TAGS = new Set([
  'P', 'BR', 'HR', 'STRONG', 'B', 'EM', 'I', 'DEL', 'S', 'U',
  'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
  'UL', 'OL', 'LI', 'BLOCKQUOTE', 'PRE', 'CODE', 'SPAN',
  'A', 'IMG', 'TABLE', 'THEAD', 'TBODY', 'TR', 'TH', 'TD', 'INPUT', 'DIV',
]);

const ALLOWED_ATTRS = new Set([
  'href', 'src', 'alt', 'title', 'class', 'start', 'align',
  'colspan', 'rowspan', 'type', 'checked', 'disabled',
]);

function sanitizeNode(node) {
  const children = Array.from(node.children);
  for (const child of children) {
    if (!ALLOWED_TAGS.has(child.tagName)) {
      // unwrap unknown-but-harmless containers, drop known-dangerous ones outright
      const dangerous = ['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'FORM', 'LINK', 'META'];
      if (dangerous.includes(child.tagName)) {
        child.remove();
        continue;
      }
      while (child.firstChild) node.insertBefore(child.firstChild, child);
      child.remove();
      continue;
    }
    // input only allowed as a disabled task-list checkbox
    if (child.tagName === 'INPUT' && child.getAttribute('type') !== 'checkbox') {
      child.remove();
      continue;
    }
    for (const attr of Array.from(child.attributes)) {
      const name = attr.name.toLowerCase();
      if (!ALLOWED_ATTRS.has(name) || name.startsWith('on')) {
        child.removeAttribute(attr.name);
        continue;
      }
      if ((name === 'href' || name === 'src')) {
        const value = attr.value.trim().toLowerCase();
        if (value.startsWith('javascript:') || value.startsWith('vbscript:') ||
            (value.startsWith('data:') && !value.startsWith('data:image/'))) {
          child.removeAttribute(attr.name);
        }
      }
    }
    if (child.tagName === 'A') {
      child.setAttribute('target', '_blank');
      child.setAttribute('rel', 'noopener noreferrer');
    }
    if (child.tagName === 'INPUT') child.setAttribute('disabled', '');
    sanitizeNode(child);
  }
}

export function sanitizeHtml(html) {
  // Parse inertly via <template> (scripts don't execute), then walk & scrub
  // from a wrapper element so root-level nodes are covered too.
  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  const wrapper = document.createElement('div');
  wrapper.appendChild(tpl.content);
  sanitizeNode(wrapper);
  return wrapper.innerHTML;
}

/* ---------------- Minimal fallback renderer ---------------- */

function escapeText(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Tiny markdown subset: fences, inline code, bold, italic, links, lists,
 *  headings, paragraphs. Only used if vendored marked.min.js failed. */
function miniMarkdown(md) {
  const out = [];
  const lines = String(md).split('\n');
  let inFence = false;
  let fenceLang = '';
  let fenceBuf = [];
  let listBuf = [];
  let listType = null;

  const flushList = () => {
    if (!listBuf.length) return;
    out.push(`<${listType}>` + listBuf.map((li) => `<li>${li}</li>`).join('') + `</${listType}>`);
    listBuf = [];
    listType = null;
  };

  const inline = (s) =>
    escapeText(s)
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\*([^*]+)\*/g, '<em>$1</em>')
      .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2">$1</a>');

  for (const line of lines) {
    const fence = line.match(/^```(\w*)\s*$/);
    if (fence) {
      if (inFence) {
        out.push(
          `<pre><code class="language-${fenceLang}">${escapeText(fenceBuf.join('\n'))}</code></pre>`
        );
        fenceBuf = [];
        inFence = false;
      } else {
        flushList();
        inFence = true;
        fenceLang = fence[1] || '';
      }
      continue;
    }
    if (inFence) {
      fenceBuf.push(line);
      continue;
    }
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      flushList();
      out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`);
      continue;
    }
    const ul = line.match(/^\s*[-*]\s+(.*)$/);
    const ol = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (ul || ol) {
      const type = ul ? 'ul' : 'ol';
      if (listType && listType !== type) flushList();
      listType = type;
      listBuf.push(inline((ul || ol)[1]));
      continue;
    }
    flushList();
    if (line.trim() === '') continue;
    out.push(`<p>${inline(line)}</p>`);
  }
  if (inFence) {
    out.push(`<pre><code class="language-${fenceLang}">${escapeText(fenceBuf.join('\n'))}</code></pre>`);
  }
  flushList();
  return out.join('\n');
}

/* ---------------- Public API ---------------- */

export function renderMarkdown(md) {
  const source = String(md ?? '');
  let html;
  if (window.marked && typeof window.marked.parse === 'function') {
    try {
      html = window.marked.parse(source, { gfm: true, breaks: true, async: false });
    } catch (err) {
      console.warn('marked failed, using fallback renderer', err);
      html = miniMarkdown(source);
    }
  } else {
    html = miniMarkdown(source);
  }
  return sanitizeHtml(html);
}

/** Renders markdown into `container` and wires up code blocks. */
export function renderMarkdownInto(container, md, { enhance = true } = {}) {
  container.innerHTML = renderMarkdown(md);
  if (enhance) enhanceCodeBlocks(container);
}

/** Wrap each <pre><code> in a header bar (language label + copy button)
 *  and run highlight.js on the code. Idempotent per fresh innerHTML. */
export function enhanceCodeBlocks(container) {
  const pres = container.querySelectorAll('pre');
  pres.forEach((pre) => {
    if (pre.parentElement?.classList.contains('code-block')) return;
    const code = pre.querySelector('code');
    if (!code) return;

    const langMatch = (code.className || '').match(/language-([\w+-]+)/);
    const lang = langMatch ? langMatch[1] : '';

    if (window.hljs) {
      try {
        window.hljs.highlightElement(code);
      } catch (_err) {
        /* partial fences while streaming can trip hljs — fine */
      }
    }

    const wrapper = document.createElement('div');
    wrapper.className = 'code-block';

    const header = document.createElement('div');
    header.className = 'code-block-header';

    const langLabel = document.createElement('span');
    langLabel.className = 'code-block-lang';
    langLabel.textContent = lang || 'code';

    const copyBtn = document.createElement('button');
    copyBtn.className = 'code-copy-btn';
    copyBtn.type = 'button';
    copyBtn.setAttribute('aria-label', 'Copy code');
    copyBtn.innerHTML =
      '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg><span>Copy</span>';
    copyBtn.addEventListener('click', async () => {
      const ok = await copyText(code.textContent || '');
      copyBtn.classList.toggle('copied', ok);
      copyBtn.querySelector('span').textContent = ok ? 'Copied!' : 'Failed';
      setTimeout(() => {
        copyBtn.classList.remove('copied');
        copyBtn.querySelector('span').textContent = 'Copy';
      }, 1600);
    });

    header.appendChild(langLabel);
    header.appendChild(copyBtn);

    pre.parentNode.insertBefore(wrapper, pre);
    wrapper.appendChild(header);
    wrapper.appendChild(pre);
  });
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (_err) {
    // WebView/permission fallback
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch (_err2) {
      return false;
    }
  }
}
