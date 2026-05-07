/**
 * DOM-Tools (minimal)
 * Drop <script src="dom-tools.js"></script> before </body> in any HTML file.
 * Activate by adding ?dom-tools to the page URL.
 */

import { register, boot } from './core/registry.js';
import { initHelpers } from './core/helpers.js';
import { renderToolbar, toolbar, setActiveButton } from './toolbar.js';
import { initKeyboard } from './keyboard.js';
import { initSettings } from './settings.js';
import { initCopyAll } from './features/copy-all.js';
import styleModifier from './features/style-modifier.js';
import annotations from './features/annotations.js';
import camera from './features/camera.js';
import draw from './features/draw.js';

if (new URLSearchParams(window.location.search).has('dom-tools')) {
  initHelpers();

  register(annotations);
  register(draw);
  register(styleModifier);
  register(camera);

  renderToolbar();
  initSettings(toolbar);
  boot();
  initCopyAll();
  initKeyboard();

  styleModifier.activate();
  setActiveButton('style-modifier');
}
