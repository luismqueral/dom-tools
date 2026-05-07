/**
 * DOM-Tools
 * Drop <script src="dom-tools.js"></script> before </body> in any HTML file.
 * Activate by adding ?dom-tools to the page URL.
 * Toggle: click the floating button or press Cmd+Shift+K (Ctrl+Shift+K on Windows/Linux).
 */

import { register, boot } from './core/registry.js';
import { initHelpers } from './core/helpers.js';
import { renderRail, rail, setActiveButton } from './rail.js';
import { initKeyboard } from './keyboard.js';
import { initSettings } from './settings.js';
import { initCopyAll } from './features/copy-all.js';
import styleModifier from './features/style-modifier.js';
import annotations from './features/annotations.js';
import camera from './features/camera.js';
import draw from './features/draw.js';

// Only activate when ?dom-tools is present in the URL
if (new URLSearchParams(window.location.search).has('dom-tools')) {
  initHelpers();

  register(annotations);
  register(draw);
  register(styleModifier);
  register(camera);

  renderRail();
  initSettings(rail);
  boot();
  initCopyAll();
  initKeyboard();

  // Design mode is the home tool. All URL forms (?dom-tools, ?dom-tools=design,
  // and the legacy ?dom-tools=annotate) launch into it.
  styleModifier.activate();
  setActiveButton('style-modifier');
}
