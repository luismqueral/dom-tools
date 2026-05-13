/**
 * Settings popover, anchored above the toolbar's settings button.
 *
 * Self-contained for the minimal build — doesn't depend on a side panel.
 * Click the gear → small dark popover floats just above the gear with the
 * feature toggles. Click the gear again or activate any tool → closes.
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
  { id: 'dock', label: 'Edge snap', description: 'Drag the toolbar near a screen edge to dock it.', default: true },
  { id: 'terminal', label: 'Terminal', description: 'Mock terminal overlay for experimentation.', default: false },
  {
    id: 'move',
    label: 'Move elements',
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
  {
    id: 'duplicate',
    label: 'Duplicate element',
    description: 'Hold Shift and click-drag any element to duplicate it.',
    default: false,
  },
  {
    id: 'camera',
    label: 'Full-page screenshot',
    description: 'Capture the entire scrollable page as PNG.',
    default: false,
  },
  {
    id: 'canvas-zoom',
    label: 'Canvas zoom & pan',
    description: 'Cmd+Scroll to zoom, Spacebar+Drag to pan, Cmd+Esc to reset.',
    default: true,
  },
  {
    id: 'dblclick-edit',
    label: 'Double-click to edit text',
    description: 'Double-click a text element in Select mode to edit it inline.',
    default: false,
  },
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

let _refreshHint = null;
function showRefreshHint(container) {
  if (_refreshHint) return;
  _refreshHint = document.createElement('div');
  _refreshHint.textContent = 'Refresh page for changes to take effect';
  Object.assign(_refreshHint.style, {
    marginTop: '16px',
    padding: '8px 12px',
    background: 'rgba(255,255,255,0.06)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '6px',
    fontSize: '11px',
    color: '#aaa',
    textAlign: 'center',
  });
  container.appendChild(_refreshHint);
}

function sectionTitle(text, opts = {}) {
  const div = document.createElement('div');
  div.textContent = text;
  Object.assign(div.style, {
    color: '#fff', fontSize: '11px', fontWeight: '600',
    textTransform: 'uppercase', letterSpacing: '1px',
    marginTop: opts.first ? '0' : '24px',
    marginBottom: '12px',
    paddingTop: opts.first ? '0' : '18px',
    borderTop: opts.first ? 'none' : '1px solid rgba(255,255,255,0.08)',
    color: '#888',
  });
  return div;
}

function buildColorSwatches() {
  const wrap = document.createElement('div');
  Object.assign(wrap.style, {
    display: 'flex', gap: '8px', alignItems: 'center', padding: '4px 0',
  });
  const swatchEls = [];
  function refresh() {
    const active = getSelectionColor();
    swatchEls.forEach(({ el, value }) => {
      el.style.boxShadow = value === active
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

function buildSettingsPanel() {
  const container = document.createElement('div');

  const colorTitle = sectionTitle('Selection color', { first: true });
  container.appendChild(colorTitle);
  container.appendChild(buildColorSwatches());

  const expTitle = sectionTitle('Experiments');
  container.appendChild(expTitle);

  EXPERIMENT_DEFS.forEach(exp => {
    const wrap = document.createElement('div');
    wrap.style.marginBottom = '10px';
    const row = document.createElement('label');
    Object.assign(row.style, {
      display: 'flex', alignItems: 'flex-start', gap: '10px', padding: '6px 0',
      color: '#ddd', fontSize: '13px', cursor: 'pointer'
    });
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = isExperimentEnabled(exp.id);
    checkbox.style.accentColor = getSelectionColor();
    checkbox.style.marginTop = '3px';
    const labelWrap = document.createElement('div');
    const labelText = document.createElement('span');
    labelText.textContent = exp.label;
    Object.assign(labelText.style, { display: 'block', fontWeight: '500' });
    const desc = document.createElement('span');
    desc.textContent = exp.description;
    Object.assign(desc.style, { display: 'block', fontSize: '11px', color: '#888', marginTop: '3px' });
    labelWrap.appendChild(labelText);
    labelWrap.appendChild(desc);
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
      showRefreshHint(container);
    });

    container.appendChild(wrap);
  });

  return container;
}

// Inline radio group rendered just under an experiment when it has
// nested options. Only the "move" experiment uses this so far; the
// renderer is generic for future ones.
function buildExperimentOptions(exp) {
  const block = document.createElement('div');
  Object.assign(block.style, {
    marginLeft: '24px', marginTop: '4px', marginBottom: '6px',
    paddingLeft: '8px', borderLeft: '2px solid rgba(255,255,255,0.08)',
  });
  const optLabel = document.createElement('div');
  optLabel.textContent = exp.options.label;
  Object.assign(optLabel.style, {
    color: '#aaa', fontSize: '10px', marginBottom: '4px',
    textTransform: 'uppercase', letterSpacing: '0.4px',
  });
  block.appendChild(optLabel);

  const groupName = `dt-exp-${exp.id}-${exp.options.id}`;
  exp.options.choices.forEach(choice => {
    const row = document.createElement('label');
    Object.assign(row.style, {
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
    const text = document.createElement('span');
    text.textContent = choice.label;
    row.appendChild(radio);
    row.appendChild(text);
    block.appendChild(row);
  });
  return block;
}

function onPopoverKeyDown(e) {
  if (e.key === 'Escape') closeSettings();
}

function showPopover() {
  // Full-screen overlay: a dimmed/blurred backdrop covering the whole
  // viewport, with a centered card holding the settings UI. Clicking
  // the backdrop or pressing Esc closes the panel.
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

  const card = document.createElement('div');
  Object.assign(card.style, {
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

  const header = document.createElement('div');
  Object.assign(header.style, {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    marginBottom: '18px',
  });
  const title = document.createElement('div');
  title.textContent = 'Settings';
  Object.assign(title.style, {
    fontSize: '18px', fontWeight: '600', color: '#fff', letterSpacing: '0.3px',
  });
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.innerHTML = '&times;';
  closeBtn.setAttribute('aria-label', 'Close settings');
  Object.assign(closeBtn.style, {
    width: '32px', height: '32px', background: 'transparent',
    border: 'none', color: '#aaa', fontSize: '24px', lineHeight: '1',
    cursor: 'pointer', borderRadius: '6px', padding: '0',
  });
  closeBtn.addEventListener('mouseenter', () => {
    closeBtn.style.background = 'rgba(255,255,255,0.08)';
    closeBtn.style.color = '#fff';
  });
  closeBtn.addEventListener('mouseleave', () => {
    closeBtn.style.background = 'transparent';
    closeBtn.style.color = '#aaa';
  });
  closeBtn.addEventListener('click', () => closeSettings());

  header.appendChild(title);
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

  // Live theme: keep the gear's "active" background in sync if the
  // user changes color while the popover is open.
  onColorChange((color) => {
    if (visible && _settingsBtn) _settingsBtn.style.background = color;
  });
}
