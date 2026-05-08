/**
 * Global enable/disable + clear-all for DOM-Tools.
 *
 * Disabled hides the toolbar and any persistent bubbles via a single
 * class on <html> — annotation data is preserved, just visually gone,
 * so re-enabling brings everything back. Tools are deactivated to
 * stop intercepting page interaction.
 *
 * Toggled by double-tapping Escape; clear-all is bound to Shift+Esc.
 */

import { state } from './state.js';
import { getModules, activateModule } from './registry.js';
import { setActiveButton } from '../toolbar.js';
import { showToast } from './helpers.js';
import { clearAnnotations, closeEditor } from '../features/annotations.js';

const HOME_ID = 'style-modifier';

function ensureDisabledStyles() {
  if (document.getElementById('dt-disabled-styles')) return;
  const style = document.createElement('style');
  style.id = 'dt-disabled-styles';
  style.textContent = `
    html.dt-disabled [data-dt-bubble],
    html.dt-disabled [data-dt-toolbar] { display: none !important; }
  `;
  document.head.appendChild(style);
}

export function isToolsEnabled() { return state.enabled !== false; }

export function setToolsEnabled(on) {
  ensureDisabledStyles();
  state.enabled = !!on;
  if (state.enabled) {
    document.documentElement.classList.remove('dt-disabled');
    activateModule(HOME_ID);
    setActiveButton(HOME_ID);
    showToast('DOM-Tools on');
  } else {
    closeEditor();
    getModules().forEach(m => { if (m.deactivate) m.deactivate(); });
    document.documentElement.classList.add('dt-disabled');
    showToast('DOM-Tools off');
  }
}

export function toggleToolsEnabled() {
  setToolsEnabled(!isToolsEnabled());
}

export function clearAllChanges() {
  clearAnnotations();
  // Clear freehand drawings too — "everything" includes the canvas.
  const drawMod = getModules().find(m => m.id === 'draw');
  if (drawMod && drawMod.clear) drawMod.clear();
  showToast('Cleared all changes');
}
