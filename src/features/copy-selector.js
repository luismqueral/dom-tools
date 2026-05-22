/**
 * Cmd+click → copy element selector.
 *
 * Lightweight global handler: Cmd+click (Ctrl+click on non-Mac) on any
 * page element copies a CSS selector for it to the clipboard, with a
 * small "nudge" animation on the element to confirm the copy.
 *
 * Skipped when:
 *   - the click is on inspector UI (toolbar, bubble, settings panel…)
 *   - DOM-Tools is disabled
 */

import { state } from '../core/state.js';
import { showToast, isInspectorUI, getSelector, nudge, copyText } from '../core/helpers.js';
import { buildChangesForElement } from './copy-all.js';
import { isToolsEnabled } from '../core/lifecycle.js';

function ellipsize(s, n) {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

async function onClick(e) {
  if (!isToolsEnabled()) return;
  // Cmd on Mac, Ctrl on others
  if (!(e.metaKey || e.ctrlKey)) return;
  if (e.shiftKey) return; // leave Shift+click for multi-select

  const el = e.target;
  if (!el || el.nodeType !== 1) return;
  if (isInspectorUI(el)) return;
  if (el === document.body || el === document.documentElement) return;

  e.preventDefault();
  e.stopPropagation();

  // If the element has any tracked changes (own note, text edit,
  // class diff, or group-note membership), copy the same Markdown
  // section copy-all would emit for it. Otherwise fall back to the
  // bare selector.
  const richBlock = buildChangesForElement(el);
  const selector = getSelector(el);
  const payload = richBlock || selector;

  const ok = await copyText(payload);
  if (!ok) {
    showToast('Could not copy');
    return;
  }
  nudge(el);
  if (richBlock) {
    showToast(`Copied element + changes (${ellipsize(selector, 50)})`);
  } else {
    showToast(`Copied: ${ellipsize(selector, 60)}`);
  }
}

export default {
  id: 'copy-selector',
  enabledByDefault: true,

  init() {
    document.addEventListener('click', onClick, true);
  },
};
