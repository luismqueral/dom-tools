import { inspectorUI } from './core/state.js';
import { Z, COLORS } from './core/constants.js';
import { addTooltip, nudge } from './core/helpers.js';
import { getModules, isEnabled, setEnabled, activateModule } from './core/registry.js';
import { showButton, hideButton, setActiveButton, onToolActivate } from './toolbar.js';

let panel = null;
let visible = false;
let _toolbar = null;
let _settingsBtn = null;
const SETTINGS_COLOR = '#0066ff';

// --- Experiments ---
const EXP_KEY = 'dom-tools-experiments';
let experiments = {};
try { experiments = JSON.parse(localStorage.getItem(EXP_KEY) || '{}'); } catch (e) {}

const EXPERIMENT_DEFS = [
  { id: 'wysiwyg', label: 'Typography WYSIWYG', description: 'Floating toolbar with rich type controls in Edit Mode', default: false },
  { id: 'dock', label: 'Edge Snapping', description: 'Drag toolbar near a screen edge to dock it there', default: true },
];

export function isExperimentEnabled(id) {
  const def = EXPERIMENT_DEFS.find(e => e.id === id);
  if (id in experiments) return experiments[id];
  return def ? def.default : false;
}

function setExperiment(id, on) {
  experiments[id] = on;
  localStorage.setItem(EXP_KEY, JSON.stringify(experiments));
}

function createPanel() {
  panel = document.createElement('div');
  Object.assign(panel.style, {
    position: 'absolute', bottom: '100%', left: '50%', transform: 'translateX(-50%)',
    marginBottom: '8px',
    background: 'rgba(30,30,30,0.95)', borderRadius: '10px', padding: '16px',
    zIndex: String(Z.toolbar + 1), display: 'none', minWidth: '200px',
    backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)',
    boxShadow: '0 4px 20px rgba(0,0,0,0.4)', fontFamily: 'system-ui, sans-serif'
  });

  const title = document.createElement('div');
  title.textContent = 'Features';
  Object.assign(title.style, {
    color: '#fff', fontSize: '13px', fontWeight: '600', marginBottom: '12px',
    letterSpacing: '0.3px'
  });
  panel.appendChild(title);

  const modules = getModules();
  modules.forEach(mod => {
    if (!mod.button) return;
    const row = document.createElement('label');
    Object.assign(row.style, {
      display: 'flex', alignItems: 'center', gap: '8px', padding: '4px 0',
      color: '#ddd', fontSize: '12px', cursor: 'pointer'
    });
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = isEnabled(mod.id);
    checkbox.style.accentColor = mod.button.color || COLORS.selector;
    checkbox.addEventListener('change', () => {
      setEnabled(mod.id, checkbox.checked);
      if (checkbox.checked) {
        showButton(mod.id);
      } else {
        hideButton(mod.id);
      }
    });
    const label = document.createElement('span');
    label.textContent = mod.label || mod.id;
    row.appendChild(checkbox);
    row.appendChild(label);
    panel.appendChild(row);
  });

  // --- Experiments section ---
  const expTitle = document.createElement('div');
  expTitle.textContent = 'Experiments';
  Object.assign(expTitle.style, {
    color: '#fff', fontSize: '13px', fontWeight: '600', marginTop: '14px', marginBottom: '8px',
    paddingTop: '10px', borderTop: '1px solid rgba(255,255,255,0.1)', letterSpacing: '0.3px'
  });
  panel.appendChild(expTitle);

  EXPERIMENT_DEFS.forEach(exp => {
    const row = document.createElement('label');
    Object.assign(row.style, {
      display: 'flex', alignItems: 'flex-start', gap: '8px', padding: '4px 0',
      color: '#ddd', fontSize: '12px', cursor: 'pointer'
    });
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = isExperimentEnabled(exp.id);
    checkbox.style.accentColor = '#ec4899';
    checkbox.style.marginTop = '2px';
    checkbox.addEventListener('change', () => { setExperiment(exp.id, checkbox.checked); });
    const labelWrap = document.createElement('div');
    const labelText = document.createElement('span');
    labelText.textContent = exp.label;
    Object.assign(labelText.style, { display: 'block' });
    const desc = document.createElement('span');
    desc.textContent = exp.description;
    Object.assign(desc.style, { display: 'block', fontSize: '10px', color: '#888', marginTop: '2px' });
    labelWrap.appendChild(labelText);
    labelWrap.appendChild(desc);
    row.appendChild(checkbox);
    row.appendChild(labelWrap);
    panel.appendChild(row);
  });

  // Append to toolbar so it moves with it
  _toolbar.appendChild(panel);
  inspectorUI.add(panel);
}

export function toggleSettings() {
  if (!panel) createPanel();
  visible = !visible;
  panel.style.display = visible ? 'block' : 'none';
  if (visible) {
    // Deactivate all tools, highlight gear
    activateModule(null);
    setActiveButton(null);
    _settingsBtn.style.background = SETTINGS_COLOR;
  } else {
    // Return to selector
    _settingsBtn.style.background = '#222';
    activateModule('selector');
    setActiveButton('selector');
  }
}

export function closeSettings() {
  if (visible) {
    visible = false;
    if (panel) panel.style.display = 'none';
    if (_settingsBtn) _settingsBtn.style.background = '#222';
  }
}

export function initSettings(toolbar) {
  _toolbar = toolbar;
  // Make toolbar a positioning context for the panel
  if (getComputedStyle(toolbar).position === 'static') {
    toolbar.style.position = 'fixed';
  }

  // Close settings when another tool is activated
  onToolActivate(closeSettings);

  const btnStyle = {
    width: '40px', height: '40px', background: '#222', color: '#fff',
    borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
    cursor: 'pointer', boxShadow: '0 2px 8px rgba(0,0,0,0.3)', userSelect: 'none',
    transition: 'background 0.15s', flexShrink: '0'
  };
  _settingsBtn = document.createElement('div');
  _settingsBtn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="#fff"><path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 00.12-.61l-1.92-3.32a.49.49 0 00-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.484.484 0 00-.48-.41h-3.84c-.24 0-.44.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96a.49.49 0 00-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.07.62-.07.94s.02.64.07.94l-2.03 1.58a.49.49 0 00-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6a3.6 3.6 0 110-7.2 3.6 3.6 0 010 7.2z"/></svg>';
  Object.assign(_settingsBtn.style, btnStyle);
  _settingsBtn.addEventListener('mouseenter', () => { if (!visible) _settingsBtn.style.background = '#444'; });
  _settingsBtn.addEventListener('mouseleave', () => { if (!visible) _settingsBtn.style.background = '#222'; });
  _settingsBtn.addEventListener('click', (e) => { e.stopPropagation(); nudge(_settingsBtn); toggleSettings(); });
  addTooltip(_settingsBtn, 'Settings');
  toolbar.appendChild(_settingsBtn);
  inspectorUI.add(_settingsBtn);
}
