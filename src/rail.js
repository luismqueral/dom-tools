import { inspectorUI } from './core/state.js';
import { Z } from './core/constants.js';
import { addTooltip, nudge } from './core/helpers.js';
import { getModules, isEnabled, activateModule } from './core/registry.js';

const RAIL_WIDTH = 48;
const PANEL_WIDTH = 300;

// Rail container
const rail = document.createElement('div');
Object.assign(rail.style, {
  position: 'fixed', left: '0', top: '0', height: '100vh', width: RAIL_WIDTH + 'px',
  display: 'flex', flexDirection: 'column', alignItems: 'center',
  zIndex: String(Z.toolbar), padding: '8px 0',
  background: 'rgba(24,24,24,0.96)', borderRight: '1px solid rgba(255,255,255,0.08)',
  backdropFilter: 'blur(14px)', WebkitBackdropFilter: 'blur(14px)',
  boxShadow: '2px 0 20px rgba(0,0,0,0.3)', fontFamily: 'system-ui, sans-serif',
  boxSizing: 'border-box'
});

// Icon container (top section)
const iconSection = document.createElement('div');
Object.assign(iconSection.style, {
  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px',
  flex: '1'
});
rail.appendChild(iconSection);

// Bottom section (copy + settings)
const bottomSection = document.createElement('div');
Object.assign(bottomSection.style, {
  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px',
  paddingTop: '8px', borderTop: '1px solid rgba(255,255,255,0.08)'
});
rail.appendChild(bottomSection);

// Content panel (expandable, sits to the right of the icon column)
const contentPanel = document.createElement('div');
Object.assign(contentPanel.style, {
  position: 'fixed', left: RAIL_WIDTH + 'px', top: '0', height: '100vh',
  width: PANEL_WIDTH + 'px', background: 'rgba(24,24,24,0.96)',
  borderRight: '1px solid rgba(255,255,255,0.08)',
  backdropFilter: 'blur(14px)', WebkitBackdropFilter: 'blur(14px)',
  boxShadow: '2px 0 16px rgba(0,0,0,0.2)', overflowY: 'auto',
  display: 'none', zIndex: String(Z.toolbar - 1), padding: '14px',
  boxSizing: 'border-box', fontSize: '11px', color: '#eee',
  fontFamily: 'system-ui, sans-serif'
});
rail.appendChild(contentPanel);

// Button style
const btnStyle = {
  width: '36px', height: '36px', background: 'transparent', color: '#fff',
  borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center',
  cursor: 'pointer', userSelect: 'none', flexShrink: '0', transition: 'background 0.12s'
};

// Map: moduleId → button element
const buttonMap = new Map();

// Callbacks for tool activation
const onToolActivateCallbacks = [];
export function onToolActivate(fn) { onToolActivateCallbacks.push(fn); }
function fireToolActivate() { onToolActivateCallbacks.forEach(fn => fn()); }

export function createButton(mod) {
  const btn = document.createElement('div');
  btn.innerHTML = mod.button.icon;
  Object.assign(btn.style, btnStyle);
  btn.addEventListener('mouseenter', () => {
    if (btn.style.background === 'transparent') btn.style.background = 'rgba(255,255,255,0.08)';
  });
  btn.addEventListener('mouseleave', () => {
    if (btn.style.background === 'rgba(255,255,255,0.08)') btn.style.background = 'transparent';
  });
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
      btn.style.background = 'transparent';
    }
  });

  // Update URL param to reflect active tool
  const url = new URL(window.location);
  const paramVal = (activeId === 'selector') ? '' : activeId === 'style-modifier' ? 'design' : activeId;
  if (paramVal) {
    url.searchParams.set('dom-tools', paramVal);
  } else {
    url.searchParams.set('dom-tools', '');
  }
  history.replaceState(null, '', url);
}

export function showButton(id) {
  const btn = buttonMap.get(id);
  if (btn) btn.style.display = 'flex';
}

export function hideButton(id) {
  const btn = buttonMap.get(id);
  if (btn) btn.style.display = 'none';
}

// Panel API — modules call these to show/hide content in the expandable panel
export function showRailPanel(content) {
  contentPanel.innerHTML = '';
  if (typeof content === 'string') {
    contentPanel.innerHTML = content;
  } else if (content instanceof HTMLElement) {
    contentPanel.appendChild(content);
  }
  contentPanel.style.display = 'block';
  document.body.style.paddingLeft = (RAIL_WIDTH + PANEL_WIDTH) + 'px';
}

export function hideRailPanel() {
  contentPanel.style.display = 'none';
  contentPanel.innerHTML = '';
  document.body.style.paddingLeft = RAIL_WIDTH + 'px';
}

export function getRailPanel() {
  return contentPanel;
}

// Copy All Changes button (wired externally by copy-all.js)
let copyBtn = null;
let copyBadge = null;

export function getCopyButton() { return copyBtn; }

export function updateCopyBadge(count) {
  if (!copyBadge) return;
  if (count > 0) {
    copyBadge.textContent = count;
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

  // Badge
  copyBadge = document.createElement('div');
  Object.assign(copyBadge.style, {
    position: 'absolute', top: '-2px', right: '-2px', minWidth: '14px', height: '14px',
    background: '#ec4899', color: '#fff', borderRadius: '7px', fontSize: '9px',
    fontWeight: '700', display: 'none', alignItems: 'center', justifyContent: 'center',
    padding: '0 3px', lineHeight: '1'
  });
  copyBtn.style.position = 'relative';
  copyBtn.appendChild(copyBadge);

  bottomSection.appendChild(copyBtn);
  inspectorUI.add(copyBtn);
}

export function renderRail() {
  const modules = getModules();
  const allButtons = [];
  modules.forEach(mod => {
    if (mod.button && isEnabled(mod.id)) {
      allButtons.push({ ...mod.button, id: mod.id, mod });
    }
  });
  allButtons.sort((a, b) => a.order - b.order);

  allButtons.forEach(def => {
    const btn = createButton(def.mod);
    iconSection.appendChild(btn);
    inspectorUI.add(btn);
  });

  // Copy all changes button
  createCopyButton();

  document.body.appendChild(rail);
  inspectorUI.add(rail);
  inspectorUI.add(contentPanel);

  // Push page content (use documentElement to avoid conflicting with body margin:auto)
  document.body.style.paddingLeft = RAIL_WIDTH + 'px';

  setActiveButton('selector');
}

export { rail, contentPanel, bottomSection };
