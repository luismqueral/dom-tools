/**
 * Right-click → copy element selector.
 *
 * Lightweight global handler: right-click on any page element copies a
 * CSS selector for it to the clipboard, with a small "nudge" animation
 * on the element to confirm the copy. Suppresses the native context
 * menu when the click hits a real page element.
 *
 * Skipped when:
 *   - the click is on inspector UI (toolbar, bubble, settings panel…)
 *   - the Draw tool is in pen mode (it uses right-click for erase)
 */

import { state } from '../core/state.js';
import { showToast, isInspectorUI, getSelector, nudge, copyText } from '../core/helpers.js';
import { buildChangesForElement } from './copy-all.js';

function ellipsize(s, n) {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

async function onContextMenu(e) {
  // Draw tool owns right-click while in pen mode (it erases).
  if (state.annotateMode && state.annotateSub === 'pen') return;

  // Suppress the native right-click menu page-wide while dom-tools is
  // active — the right-click is now our "copy element" gesture.
  e.preventDefault();
  e.stopPropagation();

  const el = e.target;
  if (!el || el.nodeType !== 1) return;
  if (isInspectorUI(el)) return;
  if (el === document.body || el === document.documentElement) return;

  // If the element has any tracked changes (own note, text edit,
  // class diff, or group-note membership), copy the same Markdown
  // section copy-all would emit for it. Otherwise fall back to the
  // bare selector — that's what right-click on an unannotated
  // element has always meant.
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
    document.addEventListener('contextmenu', onContextMenu, true);
  },
};
