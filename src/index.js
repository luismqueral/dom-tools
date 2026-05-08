/**
 * DOM-Tools (minimal)
 * Drop <script src="dom-tools.js"></script> before </body> in any HTML file.
 * Activate by adding ?dom-tools to the page URL, OR by double-tapping Esc.
 */

import { register, boot } from './core/registry.js';
import { initHelpers } from './core/helpers.js';
import { renderToolbar, toolbar, setActiveButton } from './toolbar.js';
import { initKeyboard } from './keyboard.js';
import { initSettings, isExperimentEnabled } from './settings.js';
import { initCopyAll } from './features/copy-all.js';
import styleModifier from './features/style-modifier.js';
import annotations from './features/annotations.js';
import camera from './features/camera.js';
import draw from './features/draw.js';
import editMode from './features/edit-mode.js';
import terminal from './features/terminal.js';
import move from './features/move.js';
import duplicate from './features/duplicate.js';
import copySelector from './features/copy-selector.js';

let booted = false;

function bootDomTools() {
  if (booted) return;
  booted = true;

  initHelpers();

  register(annotations);
  register(draw);
  register(styleModifier);
  register(editMode);
  register(camera);
  register(copySelector);
  if (isExperimentEnabled('terminal')) register(terminal);
  if (isExperimentEnabled('move')) register(move);
  if (isExperimentEnabled('duplicate')) register(duplicate);

  renderToolbar();
  initSettings(toolbar);
  boot();
  initCopyAll();
  initKeyboard();

  styleModifier.activate();
  setActiveButton('style-modifier');
}

if (new URLSearchParams(window.location.search).has('dom-tools')) {
  bootDomTools();
} else {
  // Pre-boot keyboard listener: until DOM-Tools is alive, watch for a
  // double-tap of Escape and bring it up. Capture-phase so page-level
  // Escape handlers (modals, editors) can't swallow the event before us.
  // Removes itself once boot completes — keyboard.js takes over from there.
  let lastEsc = 0;
  function preBootEsc(e) {
    if (e.key !== 'Escape' || e.shiftKey) return;
    const now = Date.now();
    if (now - lastEsc < 400) {
      e.preventDefault();
      document.removeEventListener('keydown', preBootEsc, true);
      bootDomTools();
      lastEsc = 0;
      return;
    }
    lastEsc = now;
  }
  document.addEventListener('keydown', preBootEsc, true);
}
