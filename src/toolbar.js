import { inspectorUI } from './core/state.js';
import { Z } from './core/constants.js';
import { addTooltip, nudge } from './core/helpers.js';
import { getModules, isEnabled, activateModule } from './core/registry.js';

function isDockEnabled() {
  try { const e = JSON.parse(localStorage.getItem('dom-tools-experiments') || '{}'); return e.dock !== false; } catch (e) { return true; }
}

const btnStyle = {
  width: '40px', height: '40px', background: '#222', color: '#fff',
  borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
  cursor: 'pointer', boxShadow: '0 2px 8px rgba(0,0,0,0.3)', userSelect: 'none',
  flexShrink: '0'
};

// Toolbar container
const toolbar = document.createElement('div');
Object.assign(toolbar.style, {
  position: 'fixed', bottom: '20px', left: '50%', transform: 'translateX(-50%)',
  display: 'flex', gap: '6px', alignItems: 'center',
  zIndex: String(Z.toolbar), padding: '6px 8px',
  background: 'rgba(30,30,30,0.85)', borderRadius: '10px',
  backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)',
  boxShadow: '0 4px 20px rgba(0,0,0,0.3)'
});

// Drag handle
const tbHandle = document.createElement('div');
tbHandle.innerHTML = '⠿';
Object.assign(tbHandle.style, {
  color: 'rgba(255,255,255,0.35)', fontSize: '14px', cursor: 'grab',
  userSelect: 'none', padding: '0 4px 0 2px', lineHeight: '1', letterSpacing: '1px'
});
toolbar.appendChild(tbHandle);

// Drag behavior with edge snapping
let tbDragging = false, tbDx = 0, tbDy = 0;
let docked = null; // null | 'bottom' | 'top' | 'left' | 'right'
const SNAP_THRESHOLD = 40;

function resetToolbarPosition() {
  toolbar.style.top = '';
  toolbar.style.bottom = '';
  toolbar.style.left = '';
  toolbar.style.right = '';
  toolbar.style.transform = 'none';
  toolbar.style.flexDirection = 'row';
  toolbar.style.borderRadius = '10px';
}

function applyDock(edge) {
  docked = edge;
  resetToolbarPosition();

  if (edge === 'bottom') {
    toolbar.style.bottom = '0px';
    toolbar.style.left = '50%';
    toolbar.style.transform = 'translateX(-50%)';
    toolbar.style.borderRadius = '10px 10px 0 0';
  } else if (edge === 'top') {
    toolbar.style.top = '0px';
    toolbar.style.left = '50%';
    toolbar.style.transform = 'translateX(-50%)';
    toolbar.style.borderRadius = '0 0 10px 10px';
  } else if (edge === 'left') {
    toolbar.style.flexDirection = 'column';
    toolbar.style.left = '0px';
    toolbar.style.top = '50%';
    toolbar.style.transform = 'translateY(-50%)';
    toolbar.style.borderRadius = '0 10px 10px 0';
  } else if (edge === 'right') {
    toolbar.style.flexDirection = 'column';
    toolbar.style.right = '0px';
    toolbar.style.top = '50%';
    toolbar.style.transform = 'translateY(-50%)';
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
// Snap preview indicator
const snapIndicator = document.createElement('div');
Object.assign(snapIndicator.style, {
  position: 'fixed', background: 'rgba(236,72,153,0.1)', border: '2px dashed rgba(236,72,153,0.4)',
  borderRadius: '8px', zIndex: String(Z.toolbar - 1), display: 'none', pointerEvents: 'none',
  transition: 'all 0.15s ease'
});
document.body.appendChild(snapIndicator);

function showSnapPreview(edge) {
  const pad = 4;
  snapIndicator.style.display = 'block';
  if (edge === 'bottom') {
    Object.assign(snapIndicator.style, { left: '20%', right: '20%', bottom: pad + 'px', top: '', height: '52px', width: '' });
  } else if (edge === 'top') {
    Object.assign(snapIndicator.style, { left: '20%', right: '20%', top: pad + 'px', bottom: '', height: '52px', width: '' });
  } else if (edge === 'left') {
    Object.assign(snapIndicator.style, { left: pad + 'px', right: '', top: '20%', bottom: '20%', width: '52px', height: '' });
  } else if (edge === 'right') {
    Object.assign(snapIndicator.style, { right: pad + 'px', left: '', top: '20%', bottom: '20%', width: '52px', height: '' });
  }
}

function hideSnapPreview() {
  snapIndicator.style.display = 'none';
}

function getSnapEdge(x, y) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
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

  // Show snap preview
  if (isDockEnabled()) {
    const edge = getSnapEdge(e.clientX, e.clientY);
    if (edge) showSnapPreview(edge);
    else hideSnapPreview();
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

// Map: moduleId → button element
const buttonMap = new Map();

// Callbacks to fire when a tool is activated (used by settings to close panel)
const onToolActivateCallbacks = [];
export function onToolActivate(fn) { onToolActivateCallbacks.push(fn); }
function fireToolActivate() { onToolActivateCallbacks.forEach(fn => fn()); }

export function createButton(mod) {
  const btn = document.createElement('div');
  btn.innerHTML = mod.button.icon;
  Object.assign(btn.style, btnStyle);
  btn.addEventListener('mouseenter', () => { if (btn.style.background === '#222') btn.style.background = '#333'; });
  btn.addEventListener('mouseleave', () => { if (btn.style.background === '#333') btn.style.background = '#222'; });
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    nudge(btn);
    fireToolActivate();
    const module = getModules().find(m => m.id === mod.id);
    if (module && module.toggle) {
      const stayed = module.toggle();
      if (stayed) {
        setActiveButton(mod.id);
      } else {
        const selectorMod = getModules().find(m => m.id === 'selector');
        if (selectorMod && selectorMod.activate) selectorMod.activate();
        setActiveButton('selector');
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

export function setActiveButton(activeId) {
  buttonMap.forEach((btn, id) => {
    const mod = getModules().find(m => m.id === id);
    if (id === activeId && mod && mod.button) {
      btn.style.background = mod.button.color;
    } else {
      btn.style.background = '#222';
    }
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

export function renderToolbar() {
  const modules = getModules();
  // Collect all buttons (main + extra) sorted by order
  const allButtons = [];
  modules.forEach(mod => {
    if (mod.button && isEnabled(mod.id)) {
      allButtons.push({ ...mod.button, id: mod.id, mod });
    }
    if (mod.extraButtons) {
      mod.extraButtons.forEach(extra => {
        if (isEnabled(mod.id)) allButtons.push({ ...extra, parentId: mod.id });
      });
    }
  });
  allButtons.sort((a, b) => a.order - b.order);

  allButtons.forEach(def => {
    if (def.onClick) {
      // Extra button (like full-page screenshot)
      const btn = document.createElement('div');
      btn.innerHTML = def.icon;
      Object.assign(btn.style, btnStyle);
      btn.addEventListener('mouseenter', () => { btn.style.background = '#444'; });
      btn.addEventListener('mouseleave', () => { btn.style.background = '#222'; });
      btn.addEventListener('click', (e) => { e.stopPropagation(); nudge(btn); def.onClick(); });
      if (def.tooltip) addTooltip(btn, def.tooltip);
      toolbar.appendChild(btn);
      inspectorUI.add(btn);
    } else {
      const btn = createButton(def.mod);
      toolbar.appendChild(btn);
      inspectorUI.add(btn);
    }
  });

  document.body.appendChild(toolbar);
  inspectorUI.add(toolbar);
  inspectorUI.add(tbHandle);

  // Activate selector by default
  setActiveButton('selector');
}

export { toolbar };
