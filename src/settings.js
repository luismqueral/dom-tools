/**
 * Settings panel — full-screen modal with tabbed sections.
 *
 * Tabs: General | Tools | Plugins | About
 * Each experiment has a `category` that determines which tab it appears in.
 * Click the gear → modal with tabs. Esc or backdrop click closes.
 */

import { inspectorUI } from './core/state.js';
import { Z } from './core/constants.js';
import { addTooltip, nudge } from './core/helpers.js';
import { activateModule } from './core/registry.js';
import { setActiveButton, onToolActivate, toolbar as tbEl } from './toolbar.js';
import { COLOR_OPTIONS, getSelectionColor, setSelectionColor, onColorChange } from './core/theme.js';

let visible = false;
let _settingsBtn = null;
let _popover = null;

const EXP_KEY = 'dom-tools-experiments';
let experiments = {};
try { experiments = JSON.parse(localStorage.getItem(EXP_KEY) || '{}'); } catch (e) {}

const EXPERIMENT_DEFS = [
  // General
  { id: 'dock', label: 'Edge snap', category: 'general', description: 'Drag the toolbar near a screen edge to dock it.', default: true },
  { id: 'canvas-zoom', label: 'Canvas zoom & pan', category: 'general', description: 'Cmd+Scroll to zoom, Spacebar+Drag to pan, Cmd+Esc to reset.', default: true },
  { id: 'dblclick-edit', label: 'Double-click to edit text', category: 'general', description: 'Double-click a text element in Select mode to edit it inline.', default: true },
  { id: 'kidpix-clear', label: 'Kid Pix clear', category: 'general', description: 'Dramatic animated screen wipe when clearing all changes (Shift+Esc).', default: false },
  // Tools
  {
    id: 'move',
    label: 'Move elements',
    category: 'tools',
    description: 'Hold Cmd to grab and rearrange elements.',
    default: false,
    options: {
      id: 'moveType',
      label: 'Type',
      choices: [
        { value: 'dom-reorder', label: 'DOM reorder' },
        { value: 'free-position', label: 'Free position' },
      ],
      default: 'dom-reorder',
    },
  },
  { id: 'duplicate', label: 'Duplicate element', category: 'tools', description: 'Hold Shift and click-drag any element to duplicate it.', default: false },
  { id: 'camera', label: 'Full-page screenshot', category: 'tools', description: 'Capture the entire scrollable page as PNG.', default: false },
  // Plugins
  { id: 'dom-xray', label: 'DOM X-Ray', category: 'plugins', description: 'Visualize box model — content, padding, border, and margin as colored overlays.', default: false },
  { id: 'spacing-debugger', label: 'Spacing Debugger', category: 'plugins', description: 'Show all margins and paddings across the page simultaneously.', default: false },
];

export function isExperimentEnabled(id) {
  const def = EXPERIMENT_DEFS.find(e => e.id === id);
  if (id in experiments) return experiments[id];
  return def ? def.default : false;
}

export function getExperimentOption(id, optionId) {
  const def = EXPERIMENT_DEFS.find(e => e.id === id);
  if (!def || !def.options || def.options.id !== optionId) return null;
  const key = `${id}.${optionId}`;
  if (key in experiments) return experiments[key];
  return def.options.default;
}

function setExperiment(id, on) {
  experiments[id] = on;
  localStorage.setItem(EXP_KEY, JSON.stringify(experiments));
}

function setExperimentOption(id, optionId, value) {
  experiments[`${id}.${optionId}`] = value;
  localStorage.setItem(EXP_KEY, JSON.stringify(experiments));
}

// --- UI Helpers ---
function el(tag, styles, text) {
  const e = document.createElement(tag);
  if (styles) Object.assign(e.style, styles);
  if (text) e.textContent = text;
  return e;
}

let _refreshHint = null;
function showRefreshHint(container) {
  if (_refreshHint) return;
  _refreshHint = el('div', {
    marginTop: '16px', padding: '8px 12px',
    background: 'rgba(255,255,255,0.06)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '6px', fontSize: '11px', color: '#aaa', textAlign: 'center',
  }, 'Refresh page for changes to take effect');
  container.appendChild(_refreshHint);
}

// --- Experiment toggle row (reused across tabs) ---
function buildExperimentRow(exp, hintContainer) {
  const wrap = el('div', { marginBottom: '10px' });
  const row = el('label', {
    display: 'flex', alignItems: 'flex-start', gap: '10px', padding: '6px 0',
    color: '#ddd', fontSize: '13px', cursor: 'pointer',
  });
  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.checked = isExperimentEnabled(exp.id);
  checkbox.style.accentColor = getSelectionColor();
  checkbox.style.marginTop = '3px';
  const labelWrap = el('div');
  labelWrap.appendChild(el('span', { display: 'block', fontWeight: '500' }, exp.label));
  labelWrap.appendChild(el('span', { display: 'block', fontSize: '11px', color: '#888', marginTop: '3px' }, exp.description));
  row.appendChild(checkbox);
  row.appendChild(labelWrap);
  wrap.appendChild(row);

  let optionsBlock = null;
  if (exp.options) {
    optionsBlock = buildExperimentOptions(exp);
    optionsBlock.style.display = isExperimentEnabled(exp.id) ? 'block' : 'none';
    wrap.appendChild(optionsBlock);
  }

  checkbox.addEventListener('change', () => {
    setExperiment(exp.id, checkbox.checked);
    if (optionsBlock) optionsBlock.style.display = checkbox.checked ? 'block' : 'none';
    showRefreshHint(hintContainer);
  });

  return wrap;
}

function buildExperimentOptions(exp) {
  const block = el('div', {
    marginLeft: '24px', marginTop: '4px', marginBottom: '6px',
    paddingLeft: '8px', borderLeft: '2px solid rgba(255,255,255,0.08)',
  });
  block.appendChild(el('div', {
    color: '#aaa', fontSize: '10px', marginBottom: '4px',
    textTransform: 'uppercase', letterSpacing: '0.4px',
  }, exp.options.label));

  const groupName = `dt-exp-${exp.id}-${exp.options.id}`;
  exp.options.choices.forEach(choice => {
    const row = el('label', {
      display: 'flex', alignItems: 'center', gap: '6px', padding: '2px 0',
      color: '#ddd', fontSize: '11px', cursor: 'pointer',
    });
    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = groupName;
    radio.value = choice.value;
    radio.checked = getExperimentOption(exp.id, exp.options.id) === choice.value;
    radio.style.accentColor = getSelectionColor();
    radio.addEventListener('change', () => {
      if (radio.checked) setExperimentOption(exp.id, exp.options.id, choice.value);
    });
    row.appendChild(radio);
    row.appendChild(el('span', {}, choice.label));
    block.appendChild(row);
  });
  return block;
}

// --- Tab: General ---
function buildGeneralTab(container) {
  // Color swatches
  container.appendChild(el('div', {
    fontSize: '11px', fontWeight: '600', textTransform: 'uppercase',
    letterSpacing: '1px', color: '#888', marginBottom: '10px',
  }, 'Selection color'));
  container.appendChild(buildColorSwatches());

  // General experiments
  container.appendChild(el('div', {
    fontSize: '11px', fontWeight: '600', textTransform: 'uppercase',
    letterSpacing: '1px', color: '#888', marginTop: '20px', marginBottom: '12px',
    paddingTop: '16px', borderTop: '1px solid rgba(255,255,255,0.06)',
  }, 'Behavior'));

  EXPERIMENT_DEFS.filter(e => e.category === 'general').forEach(exp => {
    container.appendChild(buildExperimentRow(exp, container));
  });
}

// --- Tab: Tools ---
function buildToolsTab(container) {
  container.appendChild(el('div', {
    fontSize: '11px', color: '#666', marginBottom: '16px',
  }, 'Additional tools that add new capabilities to the toolbar.'));

  EXPERIMENT_DEFS.filter(e => e.category === 'tools').forEach(exp => {
    container.appendChild(buildExperimentRow(exp, container));
  });
}

// --- Tab: Plugins ---
function buildPluginsTab(container) {
  container.appendChild(el('div', {
    fontSize: '11px', color: '#666', marginBottom: '16px',
  }, 'External plugins loaded alongside DOM-Tools. Enable to show their toolbar button.'));

  EXPERIMENT_DEFS.filter(e => e.category === 'plugins').forEach(exp => {
    container.appendChild(buildExperimentRow(exp, container));
  });
}

// --- Tab: About ---
function buildAboutTab(container) {
  // Version
  const version = el('div', { marginBottom: '20px' });
  version.appendChild(el('div', { fontSize: '14px', fontWeight: '600', color: '#fff', marginBottom: '4px' }, 'DOM-Tools'));
  version.appendChild(el('div', { fontSize: '11px', color: '#888' }, 'v1.0.0'));
  container.appendChild(version);

  // Shortcuts
  container.appendChild(el('div', {
    fontSize: '11px', fontWeight: '600', textTransform: 'uppercase',
    letterSpacing: '1px', color: '#888', marginBottom: '12px',
    paddingTop: '16px', borderTop: '1px solid rgba(255,255,255,0.06)',
  }, 'Keyboard shortcuts'));

  const shortcuts = [
    ['Cmd+Shift+K / Ctrl+Shift+K', 'Toggle inspector'],
    ['Esc Esc (double-tap)', 'Re-focus cursor tool'],
    ['Cmd+Shift+S / Ctrl+Shift+S', 'Full page screenshot'],
    ['Esc', 'Exit current popover or tool'],
    ['A', 'Toggle annotate/draw mode'],
    ['Shift+Esc', 'Clear all changes'],
  ];
  shortcuts.forEach(([key, desc]) => {
    const row = el('div', { display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: '11px' });
    row.appendChild(el('span', { color: '#bbb', fontFamily: 'monospace', fontSize: '10px' }, key));
    row.appendChild(el('span', { color: '#888' }, desc));
    container.appendChild(row);
  });

  // Links
  container.appendChild(el('div', {
    fontSize: '11px', fontWeight: '600', textTransform: 'uppercase',
    letterSpacing: '1px', color: '#888', marginTop: '20px', marginBottom: '12px',
    paddingTop: '16px', borderTop: '1px solid rgba(255,255,255,0.06)',
  }, 'Links'));

  const links = [
    ['GitHub', 'https://github.com/luismqueral/dom-tools'],
    ['Documentation', 'https://queral.studio/notes/dom-tools'],
  ];
  links.forEach(([label, href]) => {
    const a = document.createElement('a');
    a.href = href;
    a.target = '_blank';
    a.rel = 'noopener';
    a.textContent = label;
    Object.assign(a.style, {
      display: 'block', fontSize: '12px', color: getSelectionColor(),
      textDecoration: 'none', padding: '4px 0',
    });
    a.addEventListener('mouseenter', () => { a.style.textDecoration = 'underline'; });
    a.addEventListener('mouseleave', () => { a.style.textDecoration = 'none'; });
    container.appendChild(a);
  });

  // Reset
  container.appendChild(el('div', {
    fontSize: '11px', fontWeight: '600', textTransform: 'uppercase',
    letterSpacing: '1px', color: '#888', marginTop: '20px', marginBottom: '12px',
    paddingTop: '16px', borderTop: '1px solid rgba(255,255,255,0.06)',
  }, 'Data'));

  const resetBtn = el('button', {
    padding: '8px 16px', fontSize: '11px', fontWeight: '600',
    background: 'rgba(239,68,68,0.15)', color: '#ef4444',
    border: '1px solid rgba(239,68,68,0.3)', borderRadius: '6px',
    cursor: 'pointer', fontFamily: 'inherit',
  }, 'Reset all settings');
  resetBtn.addEventListener('click', () => {
    if (confirm('Reset all DOM-Tools settings to defaults?')) {
      localStorage.removeItem(EXP_KEY);
      localStorage.removeItem('dom-tools-selection-color');
      localStorage.removeItem('dom-tools-features');
      experiments = {};
      location.reload();
    }
  });
  resetBtn.addEventListener('mouseenter', () => { resetBtn.style.background = 'rgba(239,68,68,0.25)'; });
  resetBtn.addEventListener('mouseleave', () => { resetBtn.style.background = 'rgba(239,68,68,0.15)'; });
  container.appendChild(resetBtn);
}

// --- Color swatches ---
function buildColorSwatches() {
  const wrap = el('div', { display: 'flex', gap: '8px', alignItems: 'center', padding: '4px 0' });
  const swatchEls = [];
  function refresh() {
    const active = getSelectionColor();
    swatchEls.forEach(({ el: sw, value }) => {
      sw.style.boxShadow = value === active
        ? '0 0 0 2px #181818, 0 0 0 4px ' + value
        : 'none';
    });
  }
  COLOR_OPTIONS.forEach(opt => {
    const sw = document.createElement('button');
    sw.type = 'button';
    sw.title = opt.label;
    sw.setAttribute('aria-label', opt.label);
    Object.assign(sw.style, {
      width: '22px', height: '22px', borderRadius: '50%',
      background: opt.value, border: 'none', padding: '0',
      cursor: 'pointer', flexShrink: '0', outline: 'none',
      transition: 'box-shadow 0.12s',
    });
    sw.addEventListener('click', (e) => {
      e.stopPropagation();
      setSelectionColor(opt.value);
      refresh();
    });
    swatchEls.push({ el: sw, value: opt.value });
    wrap.appendChild(sw);
  });
  refresh();
  return wrap;
}

// --- Tabbed panel ---
const TABS = [
  { id: 'general', label: 'General', build: buildGeneralTab },
  { id: 'tools', label: 'Tools', build: buildToolsTab },
  { id: 'plugins', label: 'Plugins', build: buildPluginsTab },
  { id: 'about', label: 'About', build: buildAboutTab },
];

function buildSettingsPanel() {
  const outer = el('div');
  let activeTab = 'general';

  // Tab bar
  const tabBar = el('div', {
    display: 'flex', gap: '4px', marginBottom: '20px',
    paddingBottom: '14px', borderBottom: '1px solid rgba(255,255,255,0.06)',
  });

  // Tab content area
  const contentArea = el('div', { minHeight: '200px' });

  const tabBtns = {};

  function switchTab(id) {
    activeTab = id;
    // Update button styles
    Object.entries(tabBtns).forEach(([key, btn]) => {
      if (key === id) {
        btn.style.background = getSelectionColor();
        btn.style.color = '#fff';
      } else {
        btn.style.background = 'transparent';
        btn.style.color = '#888';
      }
    });
    // Rebuild content
    contentArea.innerHTML = '';
    _refreshHint = null;
    const tab = TABS.find(t => t.id === id);
    if (tab) tab.build(contentArea);
  }

  TABS.forEach(tab => {
    const btn = el('button', {
      padding: '5px 12px', fontSize: '10px', fontWeight: '600',
      textTransform: 'uppercase', letterSpacing: '0.5px',
      border: 'none', borderRadius: '4px', cursor: 'pointer',
      fontFamily: 'inherit', transition: 'background 0.15s, color 0.15s',
      background: tab.id === activeTab ? getSelectionColor() : 'transparent',
      color: tab.id === activeTab ? '#fff' : '#888',
    });
    btn.textContent = tab.label;
    btn.addEventListener('click', () => switchTab(tab.id));
    btn.addEventListener('mouseenter', () => {
      if (tab.id !== activeTab) btn.style.color = '#ccc';
    });
    btn.addEventListener('mouseleave', () => {
      if (tab.id !== activeTab) btn.style.color = '#888';
    });
    tabBtns[tab.id] = btn;
    tabBar.appendChild(btn);
  });

  outer.appendChild(tabBar);
  outer.appendChild(contentArea);

  // Initial render
  switchTab(activeTab);

  return outer;
}

// --- Popover (modal) ---
function onPopoverKeyDown(e) {
  if (e.key === 'Escape') closeSettings();
}

function showPopover() {
  _popover = document.createElement('div');
  _popover.setAttribute('data-dt-settings', '');
  Object.assign(_popover.style, {
    position: 'fixed', inset: '0',
    zIndex: String(Z.toolbar + 1),
    background: 'rgba(0,0,0,0.55)',
    backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontFamily: 'system-ui, sans-serif', fontSize: '12px', color: '#eee',
    boxSizing: 'border-box', padding: '40px',
  });

  const card = el('div', {
    width: 'min(560px, 100%)',
    maxHeight: '100%',
    background: 'rgba(24,24,24,0.96)',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: '12px',
    boxShadow: '0 24px 64px rgba(0,0,0,0.5)',
    padding: '28px 32px',
    boxSizing: 'border-box',
    overflow: 'auto',
    position: 'relative',
  });

  // Header
  const header = el('div', {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    marginBottom: '18px',
  });
  header.appendChild(el('div', {
    fontSize: '18px', fontWeight: '600', color: '#fff', letterSpacing: '0.3px',
  }, 'Settings'));

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.innerHTML = '&times;';
  closeBtn.setAttribute('aria-label', 'Close settings');
  Object.assign(closeBtn.style, {
    width: '32px', height: '32px', background: 'transparent',
    border: 'none', color: '#aaa', fontSize: '24px', lineHeight: '1',
    cursor: 'pointer', borderRadius: '6px', padding: '0',
  });
  closeBtn.addEventListener('mouseenter', () => { closeBtn.style.background = 'rgba(255,255,255,0.08)'; closeBtn.style.color = '#fff'; });
  closeBtn.addEventListener('mouseleave', () => { closeBtn.style.background = 'transparent'; closeBtn.style.color = '#aaa'; });
  closeBtn.addEventListener('click', () => closeSettings());
  header.appendChild(closeBtn);

  card.appendChild(header);
  card.appendChild(buildSettingsPanel());
  _popover.appendChild(card);

  _popover.addEventListener('click', (e) => {
    if (e.target === _popover) closeSettings();
  });

  document.body.appendChild(_popover);
  inspectorUI.add(_popover);
  document.addEventListener('keydown', onPopoverKeyDown, true);
}

function hidePopover() {
  if (_popover) {
    inspectorUI.delete(_popover);
    _popover.remove();
    _popover = null;
    document.removeEventListener('keydown', onPopoverKeyDown, true);
  }
}

export function toggleSettings() {
  visible = !visible;
  if (visible) {
    activateModule(null);
    setActiveButton(null);
    showPopover();
    if (_settingsBtn) _settingsBtn.style.background = getSelectionColor();
  } else {
    hidePopover();
    if (_settingsBtn) _settingsBtn.style.background = '#222';
    activateModule('style-modifier');
    setActiveButton('style-modifier');
  }
}

export function closeSettings() {
  if (visible) {
    visible = false;
    hidePopover();
    if (_settingsBtn) _settingsBtn.style.background = '#222';
    activateModule('style-modifier');
    setActiveButton('style-modifier');
  }
}

export function initSettings() {
  onToolActivate(closeSettings);

  const btnStyle = {
    width: '40px', height: '40px', background: '#222', color: '#fff',
    borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
    cursor: 'pointer', boxShadow: '0 2px 8px rgba(0,0,0,0.3)', userSelect: 'none',
    flexShrink: '0'
  };
  _settingsBtn = document.createElement('div');
  _settingsBtn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="#fff"><path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 00.12-.61l-1.92-3.32a.49.49 0 00-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.484.484 0 00-.48-.41h-3.84c-.24 0-.44.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96a.49.49 0 00-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.07.62-.07.94s.02.64.07.94l-2.03 1.58a.49.49 0 00-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6a3.6 3.6 0 110-7.2 3.6 3.6 0 010 7.2z"/></svg>';
  Object.assign(_settingsBtn.style, btnStyle);
  _settingsBtn.addEventListener('mouseenter', () => { if (!visible) _settingsBtn.style.background = '#333'; });
  _settingsBtn.addEventListener('mouseleave', () => { if (!visible) _settingsBtn.style.background = '#222'; });
  _settingsBtn.addEventListener('click', (e) => { e.stopPropagation(); nudge(_settingsBtn); toggleSettings(); });
  addTooltip(_settingsBtn, 'Settings');

  tbEl.appendChild(_settingsBtn);
  inspectorUI.add(_settingsBtn);

  onColorChange((color) => {
    if (visible && _settingsBtn) _settingsBtn.style.background = color;
  });
}
