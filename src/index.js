/**
 * DOM-Tools (minimal)
 * Drop <script src="dom-tools.js"></script> before </body> in any HTML file.
 * Activate by adding ?dom-tools to the page URL, OR by double-tapping Esc.
 */

import { register, boot, registerLate, onLateRegister } from './core/registry.js';
import { initHelpers } from './core/helpers.js';
import { renderToolbar, toolbar, setActiveButton, appendButton } from './toolbar.js';
import { initKeyboard } from './keyboard.js';
import { initBeforeUnload } from './core/lifecycle.js';
import { initSettings, isExperimentEnabled } from './settings.js';
import { initCopyAll } from './features/copy-all.js';
import { pluginAPI } from './core/plugin-api.js';
import styleModifier from './features/style-modifier.js';
import annotations from './features/annotations.js';
import camera from './features/camera.js';
import draw from './features/draw.js';
import editMode from './features/edit-mode.js';
import move from './features/move.js';
import duplicate from './features/duplicate.js';
import copySelector from './features/copy-selector.js';
import canvasZoom from './features/canvas-zoom.js';

// --- Plugin namespace (available before boot for early-loading plugins) ---
window.DomTools = window.DomTools || { _pendingPlugins: [] };

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
  register(canvasZoom);
  if (isExperimentEnabled('move')) register(move);
  if (isExperimentEnabled('duplicate')) register(duplicate);

  renderToolbar();
  initSettings(toolbar);
  boot();
  initCopyAll();
  initKeyboard();
  initBeforeUnload();

  styleModifier.activate();
  setActiveButton('style-modifier');

  // Wire up late-register callback (for plugins loaded after boot)
  onLateRegister((mod) => appendButton(mod));

  // Drain any plugins that loaded before boot
  drainPluginQueue();
}

function drainPluginQueue() {
  const pending = window.DomTools._pendingPlugins || [];
  pending.forEach(plugin => {
    if (!isExperimentEnabled(plugin.id)) return;
    registerLate(plugin, pluginAPI);
  });
  window.DomTools._pendingPlugins = [];
}

// Public plugin registration (works before or after boot)
window.DomTools.registerPlugin = function(plugin) {
  if (booted) {
    if (!isExperimentEnabled(plugin.id)) return;
    registerLate(plugin, pluginAPI);
  } else {
    window.DomTools._pendingPlugins.push(plugin);
  }
};

// Expose API for plugins that want to access it after registration
window.DomTools.api = pluginAPI;

// Expose for SPA integration (call window.bootDomTools() from JS)
window.bootDomTools = bootDomTools;

function ready(fn) {
  if (document.body) fn();
  else document.addEventListener('DOMContentLoaded', fn);
}

if (new URLSearchParams(window.location.search).has('dom-tools')) {
  ready(bootDomTools);
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
      ready(bootDomTools);
      lastEsc = 0;
      return;
    }
    lastEsc = now;
  }
  document.addEventListener('keydown', preBootEsc, true);
}
