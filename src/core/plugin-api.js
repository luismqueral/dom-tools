/**
 * Plugin API — the public surface plugins receive in their init(api) call.
 * Plugins are standalone scripts with no module imports, so this object
 * gives them access to the internals they need without bundler coupling.
 */

import { state, inspectorUI } from './state.js';
import { Z, COLORS } from './constants.js';
import { activateModule, isEnabled } from './registry.js';
import { showToast, addTooltip, nudge, flashElement, copyText, getSelector, getContext, isInspectorUI } from './helpers.js';
import { setActiveButton } from '../toolbar.js';
import { getSelectionColor, withAlpha, onColorChange } from './theme.js';

/**
 * createPanel — reusable draggable floating panel factory.
 * Used by draw.js internally and available to plugins.
 */
export function createPanel({ title = '', position = { top: '16px', right: '16px' }, width = 'auto' } = {}) {
  const panel = document.createElement('div');
  Object.assign(panel.style, {
    position: 'fixed',
    top: position.top || '',
    right: position.right || '',
    left: position.left || '',
    bottom: position.bottom || '',
    width,
    background: 'rgba(30,30,30,0.92)',
    borderRadius: '10px',
    padding: '0',
    zIndex: String(Z.toolbar + 1),
    backdropFilter: 'blur(12px)',
    WebkitBackdropFilter: 'blur(12px)',
    boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
    fontFamily: 'system-ui, -apple-system, sans-serif',
    fontSize: '12px',
    color: '#fff',
    userSelect: 'none',
    display: 'none',
  });

  // Header with drag handle
  const header = document.createElement('div');
  Object.assign(header.style, {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    padding: '8px 12px',
    cursor: 'grab',
    borderBottom: '1px solid rgba(255,255,255,0.1)',
  });

  const grip = document.createElement('span');
  grip.textContent = '\u283F';
  Object.assign(grip.style, { color: 'rgba(255,255,255,0.35)', fontSize: '16px' });

  const titleEl = document.createElement('span');
  titleEl.textContent = title;
  Object.assign(titleEl.style, { fontWeight: '600', fontSize: '11px', letterSpacing: '0.3px' });

  header.appendChild(grip);
  header.appendChild(titleEl);
  panel.appendChild(header);

  // Content area
  const content = document.createElement('div');
  Object.assign(content.style, { padding: '10px 12px' });
  panel.appendChild(content);

  // Drag logic
  let dragging = false, dx = 0, dy = 0;
  header.addEventListener('mousedown', (e) => {
    dragging = true;
    const r = panel.getBoundingClientRect();
    dx = e.clientX - r.left;
    dy = e.clientY - r.top;
    header.style.cursor = 'grabbing';
    e.preventDefault();
  });
  document.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    let x = e.clientX - dx;
    let y = e.clientY - dy;
    x = Math.max(0, Math.min(x, window.innerWidth - panel.offsetWidth));
    y = Math.max(0, Math.min(y, window.innerHeight - panel.offsetHeight));
    panel.style.left = x + 'px';
    panel.style.top = y + 'px';
    panel.style.right = 'auto';
    panel.style.bottom = 'auto';
  });
  document.addEventListener('mouseup', () => {
    if (!dragging) return;
    dragging = false;
    header.style.cursor = 'grab';
  });

  document.body.appendChild(panel);
  inspectorUI.add(panel);

  // Return panel + content ref for the plugin to populate
  panel._content = content;
  return panel;
}

export const pluginAPI = {
  state,
  inspectorUI,
  activateModule,
  isEnabled,
  showToast,
  addTooltip,
  nudge,
  flashElement,
  copyText,
  getSelector,
  getContext,
  isInspectorUI,
  setActiveButton,
  getSelectionColor,
  withAlpha,
  onColorChange,
  createPanel,
  Z,
  COLORS,
};
