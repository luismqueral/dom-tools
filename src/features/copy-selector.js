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
import { showToast, isInspectorUI, getSelector, nudge } from '../core/helpers.js';

function onContextMenu(e) {
  // Draw tool owns right-click while in pen mode (it erases).
  if (state.annotateMode && state.annotateSub === 'pen') return;

  // Suppress the native right-click menu page-wide while dom-tools is
  // active — the right-click is now our "copy selector" gesture.
  e.preventDefault();
  e.stopPropagation();

  const el = e.target;
  if (!el || el.nodeType !== 1) return;
  if (isInspectorUI(el)) return;
  if (el === document.body || el === document.documentElement) return;

  const selector = getSelector(el);
  navigator.clipboard.writeText(selector).then(() => {
    nudge(el);
    showToast(`Copied: ${selector.length > 60 ? selector.slice(0, 57) + '…' : selector}`);
  }).catch(() => {
    showToast('Could not copy selector');
  });
}

export default {
  id: 'copy-selector',
  enabledByDefault: true,

  init() {
    document.addEventListener('contextmenu', onContextMenu, true);
  },
};
