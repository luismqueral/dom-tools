/**
 * Floating, draggable toolbar (bottom-center pill).
 *
 * Adapted from the main-branch toolbar to drive the minimal build:
 *  - style-modifier is the home tool (cursor) instead of the original selector
 *  - inline copy-all button + badge (was in the rail's bottomSection)
 *  - tiny dock/snap to bottom/top/left/right edges
 */

import { inspectorUI } from './core/state.js';
import { Z } from './core/constants.js';
import { addTooltip, nudge } from './core/helpers.js';
import { getModules, isEnabled, activateModule } from './core/registry.js';
import { getSelectionColor, withAlpha, onColorChange } from './core/theme.js';

function isDockEnabled() {
  try { const e = JSON.parse(localStorage.getItem('dom-tools-experiments') || '{}'); return e.dock !== false; } catch (e) { return true; }
}

const btnStyle = {
  width: '40px', height: '40px', background: '#222', color: '#fff',
  borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
  cursor: 'pointer', boxShadow: '0 2px 8px rgba(0,0,0,0.3)', userSelect: 'none',
  flexShrink: '0', position: 'relative'
};

const toolbar = document.createElement('div');
toolbar.setAttribute('data-dt-toolbar', '');
Object.assign(toolbar.style, {
  position: 'fixed', bottom: '20px', left: '50%', transform: 'translateX(-50%)',
  display: 'flex', gap: '6px', alignItems: 'center',
  zIndex: String(Z.toolbar), padding: '6px 8px',
  background: 'rgba(30,30,30,0.85)', borderRadius: '10px',
  backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)',
  boxShadow: '0 4px 20px rgba(0,0,0,0.3)'
});

const tbHandle = document.createElement('div');
tbHandle.innerHTML = '\u2837';
Object.assign(tbHandle.style, {
  color: 'rgba(255,255,255,0.35)', fontSize: '14px', cursor: 'grab',
  userSelect: 'none', padding: '0 4px 0 2px', lineHeight: '1', letterSpacing: '1px'
});
toolbar.appendChild(tbHandle);

// --- Drag + edge snap ---
let tbDragging = false, tbDx = 0, tbDy = 0;
let docked = null;
const SNAP_THRESHOLD = 40;

function resetToolbarPosition() {
  toolbar.style.top = ''; toolbar.style.bottom = '';
  toolbar.style.left = ''; toolbar.style.right = '';
  toolbar.style.transform = 'none';
  toolbar.style.flexDirection = 'row';
  toolbar.style.borderRadius = '10px';
}

function applyDock(edge) {
  docked = edge;
  resetToolbarPosition();
  if (edge === 'bottom') {
    toolbar.style.bottom = '0px'; toolbar.style.left = '50%'; toolbar.style.transform = 'translateX(-50%)';
    toolbar.style.borderRadius = '10px 10px 0 0';
  } else if (edge === 'top') {
    toolbar.style.top = '0px'; toolbar.style.left = '50%'; toolbar.style.transform = 'translateX(-50%)';
    toolbar.style.borderRadius = '0 0 10px 10px';
  } else if (edge === 'left') {
    toolbar.style.flexDirection = 'column';
    toolbar.style.left = '0px'; toolbar.style.top = '50%'; toolbar.style.transform = 'translateY(-50%)';
    toolbar.style.borderRadius = '0 10px 10px 0';
  } else if (edge === 'right') {
    toolbar.style.flexDirection = 'column';
    toolbar.style.right = '0px'; toolbar.style.top = '50%'; toolbar.style.transform = 'translateY(-50%)';
    toolbar.style.borderRadius = '10px 0 0 10px';
  }
}

function undock() {
  docked = null;
  toolbar.style.right = '';
  toolbar.style.flexDirection = 'row';
  toolbar.style.borderRadius = '10px';
}

tbHandle.addEventListener('mousedown', (e) => {
  tbDragging = true;
  const tbRect = toolbar.getBoundingClientRect();
  tbDx = e.clientX - tbRect.left;
  tbDy = e.clientY - tbRect.top;
  tbHandle.style.cursor = 'grabbing';
  if (docked) undock();
  e.preventDefault();
});

const snapIndicator = document.createElement('div');
Object.assign(snapIndicator.style, {
  position: 'fixed', background: 'var(--dt-color-mist)', border: '2px dashed var(--dt-color-soft)',
  borderRadius: '8px', zIndex: String(Z.toolbar - 1), display: 'none', pointerEvents: 'none',
  transition: 'all 0.15s ease'
});
document.body.appendChild(snapIndicator);

function showSnapPreview(edge) {
  const pad = 4;
  snapIndicator.style.display = 'block';
  if (edge === 'bottom') Object.assign(snapIndicator.style, { left: '20%', right: '20%', bottom: pad + 'px', top: '', height: '52px', width: '' });
  else if (edge === 'top') Object.assign(snapIndicator.style, { left: '20%', right: '20%', top: pad + 'px', bottom: '', height: '52px', width: '' });
  else if (edge === 'left') Object.assign(snapIndicator.style, { left: pad + 'px', right: '', top: '20%', bottom: '20%', width: '52px', height: '' });
  else if (edge === 'right') Object.assign(snapIndicator.style, { right: pad + 'px', left: '', top: '20%', bottom: '20%', width: '52px', height: '' });
}

function hideSnapPreview() { snapIndicator.style.display = 'none'; }

function getSnapEdge(x, y) {
  const vw = window.innerWidth, vh = window.innerHeight;
  if (y > vh - SNAP_THRESHOLD) return 'bottom';
  if (y < SNAP_THRESHOLD) return 'top';
  if (x < SNAP_THRESHOLD) return 'left';
  if (x > vw - SNAP_THRESHOLD) return 'right';
  return null;
}

document.addEventListener('mousemove', (e) => {
  if (!tbDragging) return;
  toolbar.style.left = (e.clientX - tbDx) + 'px';
  toolbar.style.top = (e.clientY - tbDy) + 'px';
  toolbar.style.transform = 'none';
  toolbar.style.bottom = 'auto';
  toolbar.style.right = '';
  if (isDockEnabled()) {
    const edge = getSnapEdge(e.clientX, e.clientY);
    if (edge) showSnapPreview(edge); else hideSnapPreview();
  }
});

document.addEventListener('mouseup', (e) => {
  if (!tbDragging) return;
  tbDragging = false;
  tbHandle.style.cursor = 'grab';
  hideSnapPreview();
  if (!isDockEnabled()) return;
  const edge = getSnapEdge(e.clientX, e.clientY);
  if (edge) applyDock(edge);
});

// --- Buttons ---
const buttonMap = new Map();

const onToolActivateCallbacks = [];
export function onToolActivate(fn) { onToolActivateCallbacks.push(fn); }
function fireToolActivate() { onToolActivateCallbacks.forEach(fn => fn()); }

export function createButton(mod) {
  const btn = document.createElement('div');
  btn.innerHTML = mod.button.icon;
  Object.assign(btn.style, btnStyle);
  btn.addEventListener('mouseenter', () => { if (btn.style.background === 'rgb(34, 34, 34)' || btn.style.background === '#222') btn.style.background = '#333'; });
  btn.addEventListener('mouseleave', () => { if (btn.style.background === 'rgb(51, 51, 51)' || btn.style.background === '#333') btn.style.background = '#222'; });
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    nudge(btn);
    fireToolActivate();
    const module = getModules().find(m => m.id === mod.id);
    if (module && module.toggle) {
      const stayed = module.toggle();
      if (stayed) {
        // Activating this tool — make sure no other tool is also live.
        // Tools have independent mode flags that their handlers check,
        // and without this they'd both fire on every click.
        getModules().forEach(m => {
          if (m.id !== mod.id && m.deactivate) m.deactivate();
        });
        setActiveButton(mod.id);
      } else {
        activateHome();
      }
    } else {
      activateModule(mod.id);
      setActiveButton(mod.id);
    }
  });
  addTooltip(btn, mod.button.tooltip);
  buttonMap.set(mod.id, btn);
  return btn;
}

function activateHome() {
  // activateModule deactivates all other tools and activates the home —
  // this is what guarantees only one tool's handlers run at a time.
  activateModule('style-modifier');
  setActiveButton('style-modifier');
}

export function setActiveButton(activeId) {
  buttonMap.forEach((btn, id) => {
    const mod = getModules().find(m => m.id === id);
    if (id === activeId && mod && mod.button) btn.style.background = mod.button.color;
    else btn.style.background = '#222';
  });
}

export function showButton(id) {
  const btn = buttonMap.get(id);
  if (btn) btn.style.display = 'flex';
}

export function hideButton(id) {
  const btn = buttonMap.get(id);
  if (btn) btn.style.display = 'none';
}

// --- Copy-all button (with badge for changed-element count) ---
let copyBtn = null;
let copyBadge = null;

export function getCopyButton() { return copyBtn; }

export function updateCopyBadge(count) {
  if (!copyBadge) return;
  if (count > 0) {
    copyBadge.textContent = String(count);
    copyBadge.style.display = 'flex';
  } else {
    copyBadge.style.display = 'none';
  }
}

function createCopyButton() {
  copyBtn = document.createElement('div');
  copyBtn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="#fff"><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>';
  Object.assign(copyBtn.style, btnStyle);
  addTooltip(copyBtn, 'Copy All Changes');

  copyBadge = document.createElement('div');
  Object.assign(copyBadge.style, {
    position: 'absolute', top: '-2px', right: '-2px', minWidth: '14px', height: '14px',
    background: 'var(--dt-color)', color: '#fff', borderRadius: '7px', fontSize: '9px',
    fontWeight: '700', display: 'none', alignItems: 'center', justifyContent: 'center',
    padding: '0 3px', lineHeight: '1'
  });
  copyBtn.appendChild(copyBadge);
  return copyBtn;
}

export function renderToolbar() {
  const modules = getModules();
  const toolButtons = [];
  modules.forEach(mod => {
    if (mod.button && isEnabled(mod.id)) {
      toolButtons.push({ ...mod.button, id: mod.id, mod });
    }
  });
  toolButtons.sort((a, b) => a.order - b.order);

  toolButtons.forEach(def => {
    const btn = createButton(def.mod);
    toolbar.appendChild(btn);
    inspectorUI.add(btn);
  });

  // Copy-all button at the end (settings.js will append its own button after this)
  const cBtn = createCopyButton();
  toolbar.appendChild(cBtn);
  inspectorUI.add(cBtn);

  document.body.appendChild(toolbar);
  inspectorUI.add(toolbar);
  inspectorUI.add(tbHandle);

  setActiveButton('style-modifier');

  // Counter-scale toolbar against browser zoom so it stays a fixed
  // physical size regardless of Cmd+/- zoom level.
  // devicePixelRatio changes ONLY on browser zoom (Cmd+/-), NOT on
  // window resize, so it's the reliable signal.
  const baseDPR = window.devicePixelRatio;
  function compensateZoom() {
    const zoomFactor = window.devicePixelRatio / baseDPR;
    if (Math.abs(zoomFactor - 1) > 0.05) {
      toolbar.style.zoom = 1 / zoomFactor;
    } else {
      toolbar.style.zoom = '';
    }
  }
  window.addEventListener('resize', compensateZoom);
}

// Dynamically append a button for a late-registered plugin (inserted before copy button).
export function appendButton(mod) {
  // Normalize plugin shape: plugins use top-level icon/label, core uses mod.button
  if (!mod.button && mod.icon) {
    mod.button = { icon: mod.icon, tooltip: mod.label || mod.id, color: '#2563eb' };
  }
  if (!mod.button || !isEnabled(mod.id)) return;
  const btn = createButton(mod);
  if (copyBtn) toolbar.insertBefore(btn, copyBtn);
  else toolbar.appendChild(btn);
  inspectorUI.add(btn);
}

export { toolbar };
