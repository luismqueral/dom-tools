/**
 * DOM-Tools
 * Drop <script src="dom-tools.js"></script> before </body> in any HTML file.
 * Activate by adding ?dom-tools to the page URL.
 * Toggle: click the floating button or press Cmd+Shift+K (Ctrl+Shift+K on Windows/Linux).
 */

import { register, boot } from './core/registry.js';
import { initHelpers } from './core/helpers.js';
import { renderToolbar, toolbar, setActiveButton } from './toolbar.js';
import { initKeyboard } from './keyboard.js';
import { initSettings } from './settings.js';
import selector from './features/selector.js';
import styleModifier from './features/style-modifier.js';
import camera from './features/camera.js';
import draw from './features/draw.js';
import stickyNotes from './features/sticky-notes.js';

// Only activate when ?dom-tools is present in the URL
if (new URLSearchParams(window.location.search).has('dom-tools')) {
  initHelpers();

  register(draw);
  register(stickyNotes);
  register(camera);
  register(styleModifier);
  register(selector);

  renderToolbar();
  initSettings(toolbar);
  boot();
  initKeyboard();

  // ?dom-tools=design launches directly into Design mode
  const mode = new URLSearchParams(window.location.search).get('dom-tools');
  if (mode === 'design') {
    styleModifier.activate();
    setActiveButton('style-modifier');
  } else {
    selector.activate();
  }
}
