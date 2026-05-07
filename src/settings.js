import { inspectorUI } from './core/state.js';
import { Z, COLORS } from './core/constants.js';
import { addTooltip, nudge } from './core/helpers.js';
import { getModules, isEnabled, setEnabled, activateModule } from './core/registry.js';
import { showButton, hideButton, setActiveButton, onToolActivate, showRailPanel, hideRailPanel, bottomSection as railBottomSection } from './rail.js';

let visible = false;
let _rail = null;
let _settingsBtn = null;
const SETTINGS_COLOR = '#0066ff';

// --- Experiments ---
const EXP_KEY = 'dom-tools-experiments';
let experiments = {};
try { experiments = JSON.parse(localStorage.getItem(EXP_KEY) || '{}'); } catch (e) {}

const EXPERIMENT_DEFS = [
  { id: 'design', label: 'Design Mode', description: 'Contextual style editor with Tailwind class controls', default: true },
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

function buildSettingsPanel() {
  const container = document.createElement('div');

  const title = document.createElement('div');
  title.textContent = 'Features';
  Object.assign(title.style, {
    color: '#fff', fontSize: '13px', fontWeight: '600', marginBottom: '12px',
    letterSpacing: '0.3px'
  });
  container.appendChild(title);

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
      if (checkbox.checked) showButton(mod.id);
      else hideButton(mod.id);
    });
    const label = document.createElement('span');
    label.textContent = mod.label || mod.id;
    row.appendChild(checkbox);
    row.appendChild(label);
    container.appendChild(row);
  });

  // --- Experiments section ---
  const expTitle = document.createElement('div');
  expTitle.textContent = 'Experiments';
  Object.assign(expTitle.style, {
    color: '#fff', fontSize: '13px', fontWeight: '600', marginTop: '14px', marginBottom: '8px',
    paddingTop: '10px', borderTop: '1px solid rgba(255,255,255,0.1)', letterSpacing: '0.3px'
  });
  container.appendChild(expTitle);

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
    container.appendChild(row);
  });

  return container;
}

export function toggleSettings() {
  visible = !visible;
  if (visible) {
    activateModule(null);
    setActiveButton(null);
    showRailPanel(buildSettingsPanel());
    if (_settingsBtn) _settingsBtn.style.background = SETTINGS_COLOR;
  } else {
    hideRailPanel();
    if (_settingsBtn) _settingsBtn.style.background = 'transparent';
    activateModule('style-modifier');
    setActiveButton('style-modifier');
  }
}

export function closeSettings() {
  if (visible) {
    visible = false;
    hideRailPanel();
    if (_settingsBtn) _settingsBtn.style.background = 'transparent';
  }
}

export function initSettings(rail) {
  _rail = rail;

  // Close settings when another tool is activated
  onToolActivate(closeSettings);

  const btnStyle = {
    width: '36px', height: '36px', background: 'transparent', color: '#fff',
    borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center',
    cursor: 'pointer', userSelect: 'none', transition: 'background 0.12s', flexShrink: '0'
  };
  _settingsBtn = document.createElement('div');
  _settingsBtn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="#fff"><path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 00.12-.61l-1.92-3.32a.49.49 0 00-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.484.484 0 00-.48-.41h-3.84c-.24 0-.44.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96a.49.49 0 00-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.07.62-.07.94s.02.64.07.94l-2.03 1.58a.49.49 0 00-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6a3.6 3.6 0 110-7.2 3.6 3.6 0 010 7.2z"/></svg>';
  Object.assign(_settingsBtn.style, btnStyle);
  _settingsBtn.addEventListener('mouseenter', () => { if (!visible) _settingsBtn.style.background = 'rgba(255,255,255,0.08)'; });
  _settingsBtn.addEventListener('mouseleave', () => { if (!visible) _settingsBtn.style.background = 'transparent'; });
  _settingsBtn.addEventListener('click', (e) => { e.stopPropagation(); nudge(_settingsBtn); toggleSettings(); });
  addTooltip(_settingsBtn, 'Settings');

  // Append settings button to the bottom section of the rail
  railBottomSection.appendChild(_settingsBtn);
  inspectorUI.add(_settingsBtn);
}
