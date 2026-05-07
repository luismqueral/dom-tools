/**
 * Inject the precompiled Tailwind stylesheet so design-mode classes render.
 *
 * No CDN/JIT runtime: this is a static CSS file built at `npm run build:css`.
 * We resolve its URL relative to wherever `dom-tools.js` is loaded from, so
 * the same code works in local dev (./dist/dom-tools.css) and when the script
 * is hosted (https://.../tools/dom-tools/dom-tools.css).
 */

const HOSTED_FALLBACK = 'https://design.nyt.net/tools/dom-tools/dom-tools.css';

function resolveStylesheetUrl() {
  const scripts = document.querySelectorAll('script[src]');
  for (const s of scripts) {
    const src = s.getAttribute('src') || '';
    const match = src.match(/^(.*\/)?dom-tools(\.min)?\.js(?:\?.*)?$/);
    if (match) {
      const dir = match[1] || '';
      return dir + 'dom-tools.css';
    }
  }
  return HOSTED_FALLBACK;
}

export function loadTailwind() {
  if (document.querySelector('link[data-dom-tools-tw]')) return;
  if (document.querySelector('link[rel="stylesheet"][href*="dom-tools.css"]')) return;

  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = resolveStylesheetUrl();
  link.dataset.domToolsTw = '1';
  document.head.appendChild(link);
}
