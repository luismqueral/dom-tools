(function () {
  'use strict';

  const STORAGE_KEY = 'dom-tools-features';
  const modules = [];
  let featureState = {};

  try { featureState = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); } catch (e) {}

  function register(mod) {
    modules.push(mod);
  }

  function getModules() {
    return modules;
  }

  function isEnabled(id) {
    if (id in featureState) return featureState[id];
    const mod = modules.find(m => m.id === id);
    return mod ? mod.enabledByDefault !== false : true;
  }

  function setEnabled(id, on) {
    featureState[id] = on;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(featureState));
    const mod = modules.find(m => m.id === id);
    if (!mod) return;
    if (on) {
      if (mod.enable) mod.enable();
    } else {
      if (mod.deactivate) mod.deactivate();
      if (mod.disable) mod.disable();
    }
  }

  function activateModule(id) {
    modules.forEach(m => {
      if (!isEnabled(m.id)) return;
      if (m.id === id) { if (m.activate) m.activate(); }
      else { if (m.deactivate) m.deactivate(); }
    });
  }

  function boot() {
    modules.forEach(m => {
      if (isEnabled(m.id) && m.init) m.init();
    });
  }

  const state = {
    active: true,
    hovered: null,
    selected: [],      // {el, desc, badge}[]
    altHeld: false,
    slotType: null,    // 'before' | 'after' | 'left' | 'right' | 'inside'
    cameraMode: false,
    annotateMode: false,
    annotateSub: 'sticky', // 'pen' | 'sticky'
    styleModActive: false,
  };

  // Set of all inspector UI elements (ignored by hover/click)
  const inspectorUI = new Set();

  // Colors
  const COLORS = {
    selector: '#0066ff',
    camera: '#cc3300',
    annotate: '#7c3aed',
    pen: '#dc2626',
  };
  const SEL_OUTLINE = '2px solid ' + COLORS.selector;
  const SEL_BG = 'rgba(0, 102, 255, 0.12)';
  const CAM_OUTLINE = '2px solid ' + COLORS.camera;
  const CAM_BG = 'rgba(204, 51, 0, 0.06)';
  const PEN_WIDTH = 2.5;

  const Z = {
    toolbar: 100000,
    overlay: 99998,
    tooltip: 100001,
    flash: 100002,
    badge: 99999,
  };

  // --- Toast ---
  let toast = null;

  function showToast(msg) {
    if (!toast) return;
    toast.textContent = msg;
    toast.style.display = 'block';
    toast.style.opacity = '1';
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { toast.style.opacity = '0'; setTimeout(() => toast.style.display = 'none', 200); }, 2000);
  }

  // --- Tooltip ---
  let tooltip = null;
  let _tipTimer = null;

  function addTooltip(el, label) {
    el.addEventListener('mouseenter', () => {
      if (!tooltip) return;
      clearTimeout(_tipTimer);
      _tipTimer = setTimeout(() => {
        const r = el.getBoundingClientRect();
        tooltip.textContent = label;
        tooltip.style.display = 'block';
        const tw = tooltip.offsetWidth;
        tooltip.style.left = (r.left + r.width / 2 - tw / 2) + 'px';
        tooltip.style.top = (r.top - 28) + 'px';
        tooltip.style.opacity = '1';
      }, 400);
    });
    el.addEventListener('mouseleave', () => {
      if (!tooltip) return;
      clearTimeout(_tipTimer);
      tooltip.style.opacity = '0';
      setTimeout(() => { tooltip.style.display = 'none'; }, 150);
    });
  }

  // --- Init DOM elements (called once on boot) ---
  function initHelpers() {
    toast = document.createElement('div');
    Object.assign(toast.style, {
      position: 'fixed', top: '16px', left: '50%', transform: 'translateX(-50%)',
      background: '#222', color: '#fff', padding: '8px 16px', borderRadius: '6px',
      fontSize: '13px', fontFamily: 'monospace', zIndex: String(Z.toolbar), display: 'none',
      transition: 'opacity 0.2s', whiteSpace: 'nowrap', maxWidth: '90vw', overflow: 'hidden', textOverflow: 'ellipsis'
    });
    document.body.appendChild(toast);
    inspectorUI.add(toast);

    tooltip = document.createElement('div');
    Object.assign(tooltip.style, {
      position: 'fixed', background: '#222', color: '#fff', padding: '4px 8px',
      borderRadius: '4px', fontSize: '11px', fontFamily: 'system-ui, sans-serif',
      fontWeight: '500', zIndex: String(Z.tooltip), pointerEvents: 'none', display: 'none',
      whiteSpace: 'nowrap', opacity: '0', transition: 'opacity 0.15s', letterSpacing: '0.2px'
    });
    document.body.appendChild(tooltip);
    inspectorUI.add(tooltip);

    const nudgeStyle = document.createElement('style');
    nudgeStyle.textContent = `
    @keyframes inspector-nudge {
      0% { transform: translateY(0); }
      30% { transform: translateY(3px); }
      100% { transform: translateY(0); }
    }
    .inspector-nudge { animation: inspector-nudge 0.2s ease-out; }
  `;
    document.head.appendChild(nudgeStyle);
  }

  function nudge(el) {
    el.classList.remove('inspector-nudge');
    void el.offsetWidth;
    el.classList.add('inspector-nudge');
    el.addEventListener('animationend', () => el.classList.remove('inspector-nudge'), { once: true });
  }

  // --- Flash screen ---
  function flashElement(el) {
    const rect = el.getBoundingClientRect();
    const flash = document.createElement('div');
    Object.assign(flash.style, {
      position: 'fixed', top: rect.top + 'px', left: rect.left + 'px',
      width: rect.width + 'px', height: rect.height + 'px',
      background: '#fff', zIndex: String(Z.flash),
      opacity: '0.7', pointerEvents: 'none', transition: 'opacity 0.3s',
      borderRadius: getComputedStyle(el).borderRadius
    });
    document.body.appendChild(flash);
    requestAnimationFrame(() => {
      flash.style.opacity = '0';
      setTimeout(() => flash.remove(), 300);
    });
  }

  // --- Selector utilities ---
  function getSelector(el) {
    if (el.id) return '#' + el.id;
    let path = [];
    while (el && el !== document.body) {
      let seg = el.tagName.toLowerCase();
      if (el.className && typeof el.className === 'string') {
        seg += '.' + el.className.trim().split(/\s+/).join('.');
      }
      path.unshift(seg);
      el = el.parentElement;
    }
    return path.join(' > ');
  }

  function isInspectorUI(el) {
    let node = el;
    while (node) {
      if (inspectorUI.has(node)) return true;
      node = node.parentElement;
    }
    return false;
  }

  function clearHover$1() {
    if (state.hovered) {
      const idx = state.selected.findIndex(s => s.el === state.hovered);
      if (idx !== -1) {
        state.hovered.style.outline = SEL_OUTLINE;
        state.hovered.style.backgroundColor = SEL_BG;
      } else {
        state.hovered.style.outline = state.hovered._origOutline || '';
        state.hovered.style.backgroundColor = state.hovered._origBg || '';
      }
      state.hovered = null;
    }
  }

  /**
   * Floating, draggable toolbar (bottom-center pill).
   *
   * Adapted from the main-branch toolbar to drive the minimal build:
   *  - style-modifier is the home tool (cursor) instead of the original selector
   *  - inline copy-all button + badge (was in the rail's bottomSection)
   *  - tiny dock/snap to bottom/top/left/right edges
   */


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
    position: 'fixed', background: 'rgba(236,72,153,0.1)', border: '2px dashed rgba(236,72,153,0.4)',
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
  function onToolActivate(fn) { onToolActivateCallbacks.push(fn); }
  function fireToolActivate() { onToolActivateCallbacks.forEach(fn => fn()); }

  function createButton(mod) {
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
        if (stayed) setActiveButton(mod.id);
        else activateHome$1();
      } else {
        activateModule(mod.id);
        setActiveButton(mod.id);
      }
    });
    addTooltip(btn, mod.button.tooltip);
    buttonMap.set(mod.id, btn);
    return btn;
  }

  function activateHome$1() {
    const home = getModules().find(m => m.id === 'style-modifier');
    if (home && home.activate) home.activate();
    setActiveButton('style-modifier');
  }

  function setActiveButton(activeId) {
    buttonMap.forEach((btn, id) => {
      const mod = getModules().find(m => m.id === id);
      if (id === activeId && mod && mod.button) btn.style.background = mod.button.color;
      else btn.style.background = '#222';
    });
  }

  function showButton(id) {
    const btn = buttonMap.get(id);
    if (btn) btn.style.display = 'flex';
  }

  function hideButton(id) {
    const btn = buttonMap.get(id);
    if (btn) btn.style.display = 'none';
  }

  // --- Copy-all button (with badge for changed-element count) ---
  let copyBtn = null;
  let copyBadge = null;

  function getCopyButton() { return copyBtn; }

  function updateCopyBadge(count) {
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
      background: '#ec4899', color: '#fff', borderRadius: '7px', fontSize: '9px',
      fontWeight: '700', display: 'none', alignItems: 'center', justifyContent: 'center',
      padding: '0 3px', lineHeight: '1'
    });
    copyBtn.appendChild(copyBadge);
    return copyBtn;
  }

  function renderToolbar() {
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
  }

  const HOME_MOD_ID = 'style-modifier';

  function activateHome(modules) {
    const home = modules.find(m => m.id === HOME_MOD_ID);
    if (home && home.activate) home.activate();
    setActiveButton(HOME_MOD_ID);
  }

  let lastEsc = 0;

  function initKeyboard() {
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Alt') {
        e.preventDefault();
        state.altHeld = true;
        return;
      }

      const modules = getModules();
      for (const mod of modules) {
        if (!isEnabled(mod.id) || !mod.shortcuts) continue;
        for (const sc of mod.shortcuts) {
          if (sc.when && !sc.when()) continue;
          const keyMatch = e.key.toLowerCase() === sc.key.toLowerCase();
          const metaMatch = sc.meta ? (e.ctrlKey || e.metaKey) : !(e.ctrlKey || e.metaKey);
          const shiftMatch = sc.shift ? e.shiftKey : !e.shiftKey;
          if (keyMatch && metaMatch && shiftMatch) {
            e.preventDefault();
            if (sc.action === 'toggle' && mod.toggle) {
              const stayed = mod.toggle();
              if (stayed) setActiveButton(mod.id);
              else activateHome(modules);
            } else if (sc.action && mod[sc.action]) {
              mod[sc.action]();
            }
            return;
          }
        }
      }

      if (e.key === 'Escape') {
        if (state.annotateMode) {
          e.preventDefault();
          modules.filter(m => m.id === 'draw').forEach(m => m.deactivate?.());
          state.annotateMode = false;
          activateHome(modules);
          return;
        }
        if (state.cameraMode) {
          e.preventDefault();
          const cameraMod = modules.find(m => m.id === 'camera');
          if (cameraMod) cameraMod.deactivate();
          activateHome(modules);
          return;
        }
        // Double-tap Escape: re-focus the home tool (Design). Always activates;
        // there's no "off" state for the home mode.
        const now = Date.now();
        if (now - lastEsc < 400) {
          activateHome(modules);
          lastEsc = 0;
        } else {
          lastEsc = now;
        }
      }
    });

    document.addEventListener('keyup', (e) => {
      if (e.key === 'Alt') {
        state.altHeld = false;
        state.slotType = null;
      }
    });
  }

  /**
   * Settings popover, anchored above the toolbar's settings button.
   *
   * Self-contained for the minimal build — doesn't depend on a side panel.
   * Click the gear → small dark popover floats just above the gear with the
   * feature toggles. Click the gear again or activate any tool → closes.
   */


  let visible = false;
  let _settingsBtn = null;
  let _popover = null;
  const SETTINGS_COLOR = '#0066ff';

  const EXP_KEY = 'dom-tools-experiments';
  let experiments = {};
  try { experiments = JSON.parse(localStorage.getItem(EXP_KEY) || '{}'); } catch (e) {}

  const EXPERIMENT_DEFS = [
    { id: 'dock', label: 'Edge snap', description: 'Drag the toolbar near a screen edge to dock it.', default: true },
  ];

  function isExperimentEnabled(id) {
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
        if (checkbox.checked) showButton(mod.id); else hideButton(mod.id);
      });
      const label = document.createElement('span');
      label.textContent = mod.label || mod.id;
      row.appendChild(checkbox);
      row.appendChild(label);
      container.appendChild(row);
    });

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

  function positionPopover$1() {
    if (!_popover || !_settingsBtn) return;
    const r = _settingsBtn.getBoundingClientRect();
    const popW = _popover.offsetWidth || 220;
    const popH = _popover.offsetHeight || 200;
    // Place popover above the gear button. If no room, place below.
    let top = r.top - popH - 8;
    if (top < 8) top = r.bottom + 8;
    let left = r.left + (r.width / 2) - (popW / 2);
    left = Math.max(8, Math.min(left, window.innerWidth - popW - 8));
    _popover.style.left = left + 'px';
    _popover.style.top = top + 'px';
  }

  function showPopover$1() {
    _popover = document.createElement('div');
    Object.assign(_popover.style, {
      position: 'fixed', zIndex: String(Z.toolbar + 1),
      width: '220px', padding: '14px',
      background: 'rgba(24,24,24,0.96)', borderRadius: '10px',
      border: '1px solid rgba(255,255,255,0.08)',
      boxShadow: '0 6px 24px rgba(0,0,0,0.35)',
      backdropFilter: 'blur(14px)', WebkitBackdropFilter: 'blur(14px)',
      fontFamily: 'system-ui, sans-serif', fontSize: '11px', color: '#eee',
      boxSizing: 'border-box'
    });
    _popover.appendChild(buildSettingsPanel());
    document.body.appendChild(_popover);
    inspectorUI.add(_popover);
    positionPopover$1();
    window.addEventListener('resize', positionPopover$1);
    window.addEventListener('scroll', positionPopover$1, true);
  }

  function hidePopover$1() {
    if (_popover) {
      inspectorUI.delete(_popover);
      _popover.remove();
      _popover = null;
      window.removeEventListener('resize', positionPopover$1);
      window.removeEventListener('scroll', positionPopover$1, true);
    }
  }

  function toggleSettings() {
    visible = !visible;
    if (visible) {
      activateModule(null);
      setActiveButton(null);
      showPopover$1();
      if (_settingsBtn) _settingsBtn.style.background = SETTINGS_COLOR;
    } else {
      hidePopover$1();
      if (_settingsBtn) _settingsBtn.style.background = '#222';
      activateModule('style-modifier');
      setActiveButton('style-modifier');
    }
  }

  function closeSettings() {
    if (visible) {
      visible = false;
      hidePopover$1();
      if (_settingsBtn) _settingsBtn.style.background = '#222';
    }
  }

  function initSettings() {
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

    toolbar.appendChild(_settingsBtn);
    inspectorUI.add(_settingsBtn);
  }

  /**
   * Comment tool — minimal click-to-leave-feedback mode.
   *
   * Click any element on the page → it gets a pink outline and a small dark
   * popover floats near it with a textarea. Type your note; it's saved live to
   * the annotation store and shows up as a persistent on-page bubble (handled by
   * annotations.js). Esc or blur closes the popover. Text-tagged elements are
   * also editable inline; edits are tracked and surfaced through copy-all.
   *
   * Replaces the old Tailwind-driven Design mode for the minimal build.
   */


  const TEXT_TAGS = ['P','H1','H2','H3','H4','H5','H6','SPAN','A','LABEL','LI','BLOCKQUOTE','FIGCAPTION','DT','DD','EM','STRONG','SMALL'];
  const PINK = '#ec4899';

  let activeMode = false;
  let selected = [];

  function getSelected() { return selected; }

  // --- Floating popover (the input itself) ---------------------------------
  let popover = null;
  let popoverTextarea = null;
  let popoverEl = null;

  function buildPopover() {
    const wrap = document.createElement('div');
    Object.assign(wrap.style, {
      position: 'absolute',
      width: '260px',
      padding: '8px',
      background: 'rgba(24,24,24,0.96)',
      border: '1px solid rgba(255,255,255,0.1)',
      borderRadius: '8px',
      boxShadow: '0 6px 24px rgba(0,0,0,0.35)',
      backdropFilter: 'blur(14px)',
      WebkitBackdropFilter: 'blur(14px)',
      zIndex: String(Z.toolbar),
      fontFamily: 'system-ui, sans-serif',
      boxSizing: 'border-box',
    });

    const ta = document.createElement('textarea');
    ta.placeholder = 'Describe the change…';
    Object.assign(ta.style, {
      width: '100%', minHeight: '60px', padding: '7px',
      border: '1px solid rgba(255,255,255,0.12)',
      background: 'rgba(255,255,255,0.05)',
      color: '#fff', fontSize: '12px', lineHeight: '1.4',
      fontFamily: 'system-ui, sans-serif', resize: 'vertical',
      outline: 'none', boxSizing: 'border-box', borderRadius: '4px'
    });
    wrap.appendChild(ta);

    // Stop click/mousedown from bubbling so the doc-level handlers below
    // (which clear selection on outside-click) don't fire on our own UI.
    ['mousedown','click','mouseup'].forEach(t => {
      wrap.addEventListener(t, (e) => e.stopPropagation());
    });
    ta.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') { hidePopover(); }
    });
    ta.addEventListener('blur', () => {
      setTimeout(() => {
        if (popoverTextarea && document.activeElement !== popoverTextarea) hidePopover();
      }, 120);
    });

    popoverTextarea = ta;
    popoverEl = wrap;
    return wrap;
  }

  function positionPopover(el) {
    if (!popoverEl) return;
    const r = el.getBoundingClientRect();
    const popH = popoverEl.offsetHeight || 100;
    const popW = popoverEl.offsetWidth || 260;
    // Prefer above, anchored to the element's left edge
    let top = r.top + window.scrollY - popH - 8;
    if (top < window.scrollY + 8) top = r.bottom + window.scrollY + 8;
    let left = r.left + window.scrollX;
    left = Math.max(window.scrollX + 8, Math.min(left, window.scrollX + window.innerWidth - popW - 8));
    popoverEl.style.left = left + 'px';
    popoverEl.style.top = top + 'px';
  }

  function showPopover(entry) {
    hidePopover();
    popover = buildPopover();
    document.body.appendChild(popover);
    popoverTextarea.value = getElementNote(entry.el) || '';
    positionPopover(entry.el);
    popoverTextarea.addEventListener('input', () => {
      setElementNote(entry.el, popoverTextarea.value, entry.originalClasses);
    });
    setTimeout(() => {
      if (popoverTextarea) {
        popoverTextarea.focus();
        const end = popoverTextarea.value.length;
        try { popoverTextarea.setSelectionRange(end, end); } catch (_) {}
      }
    }, 0);
  }

  function hidePopover() {
    if (popover) { popover.remove(); popover = null; popoverEl = null; popoverTextarea = null; }
  }

  function repositionPopover() {
    if (popoverEl && selected.length) positionPopover(selected[0].el);
  }
  window.addEventListener('scroll', repositionPopover, true);
  window.addEventListener('resize', repositionPopover);

  // --- Selection -----------------------------------------------------------
  function teardownEntry(s) {
    s.el.style.outline = s.origOutline;
    if (s.madeEditable) { s.el.contentEditable = 'false'; s.el.style.cursor = ''; }
    if (s.onTextInput) { s.el.removeEventListener('input', s.onTextInput); s.onTextInput = null; }
  }

  function selectElement(el) {
    selected.forEach(teardownEntry);
    selected = [];

    const entry = {
      el,
      originalClasses: el.className,
      origOutline: el.style.outline,
      madeEditable: false,
    };

    if (TEXT_TAGS.includes(el.tagName)) {
      el.contentEditable = 'true';
      el.style.cursor = 'text';
      entry.madeEditable = true;
      entry.originalText = el.innerText;
      entry.onTextInput = () => {
        setElementText(el, entry.originalText, entry.originalClasses);
        evaluateAnnotation(el);
        queueRepositionAll();
      };
      el.addEventListener('input', entry.onTextInput);
    }

    el.style.outline = '2px solid ' + PINK;
    selected.push(entry);
    showPopover(entry);
  }

  function clearSelection() {
    selected.forEach(teardownEntry);
    selected = [];
    hidePopover();
  }

  // Public: activate from outside (annotation bubble click)
  function focusElement(el) {
    if (!activeMode) {
      activateModule('style-modifier');
      setActiveButton('style-modifier');
    }
    selectElement(el);
    el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  // --- Hover highlight -----------------------------------------------------
  let hoveredEl = null;

  function clearHover() {
    if (hoveredEl) {
      hoveredEl.style.outline = hoveredEl._smHoverOutline || '';
      hoveredEl.style.backgroundColor = hoveredEl._smHoverBg || '';
      delete hoveredEl._smHoverOutline;
      delete hoveredEl._smHoverBg;
      hoveredEl = null;
    }
  }

  function onMove(e) {
    if (!activeMode) return;
    const el = e.target;
    if (isInspectorUI(el) || el === document.body || el === document.documentElement) {
      clearHover();
      return;
    }
    if (el === hoveredEl) return;
    clearHover();
    if (selected.find(s => s.el === el)) return;
    hoveredEl = el;
    hoveredEl._smHoverOutline = hoveredEl.style.outline;
    hoveredEl._smHoverBg = hoveredEl.style.backgroundColor;
    hoveredEl.style.outline = '2px solid rgba(236,72,153,0.5)';
    hoveredEl.style.backgroundColor = 'rgba(236,72,153,0.04)';
  }

  // --- Click handler -------------------------------------------------------
  function onClick(e) {
    if (!activeMode) return;
    const el = e.target;
    if (isInspectorUI(el)) return;

    // Click on already-selected text element → drop into the inline editor
    // instead of re-opening the popover (so caret lands on the clicked word).
    const alreadySelected = selected.find(s => s.el === el || s.el.contains(el));
    if (alreadySelected && alreadySelected.madeEditable) {
      e.stopPropagation();
      return;
    }

    e.preventDefault();
    e.stopPropagation();
    clearHover();
    selectElement(el);
  }

  // --- Module spec ---------------------------------------------------------
  var styleModifier = {
    id: 'style-modifier',
    label: 'Comment',
    enabledByDefault: true,

    button: {
      icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="#fff"><path d="M21 3L3 10.53v.98l6.84 2.65L12.48 21h.98L21 3z"/></svg>',
      tooltip: 'Comment',
      color: PINK,
      order: 5,
    },

    shortcuts: [],

    init() {
      document.addEventListener('click', onClick, true);
      document.addEventListener('mousemove', onMove, true);
    },

    activate() {
      activeMode = true;
      state.styleModActive = true;
      showToast('Click an element to leave a comment');
    },

    deactivate() {
      activeMode = false;
      state.styleModActive = false;
      clearHover();
      clearSelection();
    },

    // Home mode: clicking the button always activates, never toggles off.
    // Other tools fall back to this module when they deactivate.
    toggle() {
      this.activate();
      return true;
    },

    enable() {},
    disable() { this.deactivate(); },
  };

  /**
   * Annotations service.
   *
   * The Comment tool (style-modifier) owns the note-leaving UX (popover
   * textarea + on-page bubble); this file is just the shared store + bubble
   * layer it depends on. No toolbar button, no mode lifecycle — it registers
   * only to install scroll/resize listeners that keep bubbles anchored to
   * their elements.
   *
   * Public API consumed by the Comment tool (style-modifier.js):
   *   setElementNote(el, text, originalClasses) → create/update/remove an
   *     annotation for `el` based on `text`. The on-page bubble auto-syncs.
   *   getElementNote(el) → string note for an element (or '').
   *   queueRepositionAll() → request a rAF-batched bubble reposition (call
   *     after class changes that may affect element bounds).
   *   getAnnotations() → annotation list (used by copy-all to build output).
   */


  // --- Annotation store ---
  // Each annotation tracks up to three kinds of change for one element:
  //   - note (free-form prose, shown as on-page bubble)
  //   - originalClasses (compared to el.className → class diff)
  //   - originalText (compared to el.innerText → text diff, shown as a small
  //     emerald pencil marker; visually distinct from the amber note bubble)
  const annotations = []; // { id, el, selector, note, originalClasses, originalText, bubbleEl, textMarkerEl }
  let nextId = 1;

  function getAnnotations() { return annotations; }
  function findAnnotationByEl(el) { return annotations.find(a => a.el === el) || null; }
  function getElementNote(el) {
    const a = findAnnotationByEl(el);
    return a ? a.note : '';
  }

  function hasTextDiff(annotation) {
    return annotation.originalText != null
      && annotation.el.innerText !== annotation.originalText;
  }

  function hasClassDiff(annotation) {
    return annotation.el.className !== annotation.originalClasses;
  }

  function hasNote(annotation) {
    return !!(annotation.note && annotation.note.trim().length);
  }

  function isAnnotationEmpty(annotation) {
    return !hasNote(annotation)
      && !hasClassDiff(annotation)
      && !hasTextDiff(annotation);
  }

  // --- Persistent on-page note bubble ---
  // Anchored via getBoundingClientRect so it can extend outside the element's
  // bounds (avoids clipping by overflow:hidden ancestors). Repositions on
  // scroll/resize via rAF-batched listener installed on registry init().
  function createBubble(annotation) {
    const bubble = document.createElement('div');
    Object.assign(bubble.style, {
      position: 'absolute',
      background: '#ec4899',
      border: 'none',
      borderRadius: '6px',
      padding: '6px 9px',
      fontSize: '11px', lineHeight: '1.4',
      fontFamily: 'system-ui, sans-serif', color: '#fff',
      maxWidth: '220px', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
      cursor: 'pointer', zIndex: String(Z.badge - 1),
      boxShadow: '0 2px 8px rgba(0,0,0,0.25)',
      pointerEvents: 'auto',
      transition: 'transform 0.1s'
    });
    bubble.addEventListener('mouseenter', () => { bubble.style.transform = 'scale(1.03)'; });
    bubble.addEventListener('mouseleave', () => { bubble.style.transform = 'scale(1)'; });
    bubble.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      focusElement(annotation.el);
    });
    document.body.appendChild(bubble);
    inspectorUI.add(bubble);
    return bubble;
  }

  // Always anchored to the element's top-left: bubble's bottom-left sits at
  // the element's top-left corner with a small 6px gap. No flipping to below
  // the element regardless of viewport — predictable, consistent placement.
  function positionBubble(bubble, el) {
    const r = el.getBoundingClientRect();
    const bubbleH = bubble.offsetHeight || 32;
    bubble.style.left = (r.left + window.scrollX) + 'px';
    bubble.style.top = (r.top + window.scrollY - bubbleH - 6) + 'px';
  }

  let _repositionQueued = false;
  function queueRepositionAll() {
    if (_repositionQueued) return;
    _repositionQueued = true;
    requestAnimationFrame(() => {
      _repositionQueued = false;
      annotations.forEach(a => {
        if (a.bubbleEl) positionBubble(a.bubbleEl, a.el);
        if (a.textMarkerEl) positionTextMarker(a.textMarkerEl, a.el);
      });
    });
  }

  function removeBubble(annotation) {
    if (!annotation.bubbleEl) return;
    inspectorUI.delete(annotation.bubbleEl);
    annotation.bubbleEl.remove();
    annotation.bubbleEl = null;
  }

  function syncBubble(annotation) {
    if (hasNote(annotation)) {
      if (!annotation.bubbleEl) annotation.bubbleEl = createBubble(annotation);
      annotation.bubbleEl.textContent = annotation.note;
      positionBubble(annotation.bubbleEl, annotation.el);
    } else {
      removeBubble(annotation);
    }
  }

  // --- Text-edit marker (emerald pencil, top-right of element) ---
  function createTextMarker(annotation) {
    const marker = document.createElement('div');
    marker.textContent = '\u270E'; // ✎
    Object.assign(marker.style, {
      position: 'absolute',
      width: '20px', height: '20px',
      background: '#10b981',
      color: '#fff',
      borderRadius: '4px',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: '12px', fontWeight: '700',
      fontFamily: 'system-ui, sans-serif',
      cursor: 'pointer', zIndex: String(Z.badge - 1),
      boxShadow: '0 1px 4px rgba(0,0,0,0.25)',
      pointerEvents: 'auto',
      transition: 'transform 0.1s'
    });
    marker.title = 'Text edited (click to view)';
    marker.addEventListener('mouseenter', () => { marker.style.transform = 'scale(1.15)'; });
    marker.addEventListener('mouseleave', () => { marker.style.transform = 'scale(1)'; });
    marker.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      focusElement(annotation.el);
    });
    document.body.appendChild(marker);
    inspectorUI.add(marker);
    return marker;
  }

  function positionTextMarker(marker, el) {
    const r = el.getBoundingClientRect();
    // Top-right, slightly outside the element to not overlap content. Falls
    // back inside the right edge if the element is up against the viewport.
    const x = Math.min(r.right + 4, window.innerWidth - 24) + window.scrollX;
    marker.style.left = (x - 20) + 'px';
    marker.style.top = (r.top + window.scrollY + 4) + 'px';
  }

  function removeTextMarker(annotation) {
    if (!annotation.textMarkerEl) return;
    inspectorUI.delete(annotation.textMarkerEl);
    annotation.textMarkerEl.remove();
    annotation.textMarkerEl = null;
  }

  function syncTextMarker(annotation) {
    if (hasTextDiff(annotation)) {
      if (!annotation.textMarkerEl) annotation.textMarkerEl = createTextMarker(annotation);
      positionTextMarker(annotation.textMarkerEl, annotation.el);
    } else {
      removeTextMarker(annotation);
    }
  }

  function removeAnnotation(annotation) {
    removeBubble(annotation);
    removeTextMarker(annotation);
    // Restore class state. Text is intentionally NOT restored — clearing the
    // tracking entry shouldn't undo what the user typed. (If they want a
    // text revert, they'd type the original back manually.)
    annotation.el.className = annotation.originalClasses;
    const idx = annotations.indexOf(annotation);
    if (idx !== -1) annotations.splice(idx, 1);
    updateBadgeCount();
  }

  function updateBadgeCount() {
    const count = annotations.filter(a =>
      hasNote(a) || hasClassDiff(a) || hasTextDiff(a)
    ).length;
    updateCopyBadge(count);
  }

  // Build a fresh annotation object. Caller is responsible for pushing it onto
  // the store and calling evaluateAnnotation afterward.
  function newAnnotation(el, opts) {
    return {
      id: nextId++,
      el,
      selector: getSelector(el),
      note: opts.note != null ? opts.note : '',
      originalClasses: opts.originalClasses != null ? opts.originalClasses : el.className,
      originalText: opts.originalText != null ? opts.originalText : null,
      bubbleEl: null,
      textMarkerEl: null,
    };
  }

  // --- Public: re-sync all on-page indicators for an element's annotation
  //     and prune the annotation if it has no remaining changes. Used by
  //     style-modifier after class or text mutations. ---
  function evaluateAnnotation(el) {
    const a = findAnnotationByEl(el);
    if (!a) return;
    syncBubble(a);
    syncTextMarker(a);
    updateBadgeCount();
    if (isAnnotationEmpty(a)) removeAnnotation(a);
  }

  // --- Public: set/clear a note for an element. Lazily creates the
  //     annotation; auto-removes when no note, no class diff, and no text
  //     diff remain. ---
  function setElementNote(el, text, originalClasses) {
    let a = findAnnotationByEl(el);
    const trimmed = (text || '').trim();

    if (!a) {
      if (!trimmed) return null;
      a = newAnnotation(el, { note: text, originalClasses });
      annotations.push(a);
    } else {
      a.note = text;
    }

    syncBubble(a);
    updateBadgeCount();

    if (isAnnotationEmpty(a)) {
      removeAnnotation(a);
      return null;
    }

    return a;
  }

  // --- Public: capture the original text of an element (idempotent — only
  //     sets it the first time). Call once when the element becomes editable
  //     in Design mode. Pair with evaluateAnnotation(el) on text input to
  //     keep the marker + badge count up to date. ---
  function setElementText(el, originalText, originalClasses) {
    let a = findAnnotationByEl(el);
    if (!a) {
      // No existing annotation: create one solely to track text. Marker + badge
      // appear lazily once the user actually changes the text.
      a = newAnnotation(el, { originalClasses, originalText });
      annotations.push(a);
    } else if (a.originalText == null) {
      a.originalText = originalText;
    }
    evaluateAnnotation(el);
    return a;
  }

  // --- Module shell: registered with the registry only so init() runs at
  //     boot. No `button` — won't appear in the toolbar. ---
  var annotations$1 = {
    id: 'annotations',
    enabledByDefault: true,

    init() {
      window.addEventListener('scroll', queueRepositionAll, true);
      window.addEventListener('resize', queueRepositionAll);
    },
  };

  // Compute class diffs between original and current
  function getClassDiff(el, originalClasses) {
    const origSet = new Set(originalClasses.trim().split(/\s+/).filter(Boolean));
    const currSet = new Set(el.className.trim().split(/\s+/).filter(Boolean));
    const added = [...currSet].filter(c => !origSet.has(c));
    const removed = [...origSet].filter(c => !currSet.has(c));
    return { added, removed };
  }

  function buildOutput() {
    const sections = [];
    const annotatedEls = new Set();

    // From annotations: includes notes, class diffs, and text edits.
    const annotations = getAnnotations();
    annotations.forEach(ann => {
      annotatedEls.add(ann.el);
      const { added, removed } = getClassDiff(ann.el, ann.originalClasses);
      const hasNote = ann.note && ann.note.trim().length > 0;
      const hasClassChanges = added.length > 0 || removed.length > 0;
      const hasTextChange = ann.originalText != null
        && ann.el.innerText !== ann.originalText;

      if (!hasNote && !hasClassChanges && !hasTextChange) return;

      let section = `### ${ann.selector}`;
      if (hasNote) section += `\nNote: "${ann.note.trim()}"`;
      if (hasTextChange) {
        const before = ann.originalText.replace(/\n/g, '\\n');
        const after = ann.el.innerText.replace(/\n/g, '\\n');
        section += `\nText: "${before}" → "${after}"`;
      }
      if (hasClassChanges) {
        section += '\nClasses:';
        if (added.length) section += `\n  + ${added.join(' ')}`;
        if (removed.length) section += `\n  - ${removed.join(' ')}`;
      }
      sections.push(section);
    });

    // From design-mode changes (elements without annotations)
    const selected = getSelected();
    selected.forEach(({ el, originalClasses }) => {
      if (annotatedEls.has(el)) return;
      if (el.className === originalClasses) return;

      const { added, removed } = getClassDiff(el, originalClasses);
      if (!added.length && !removed.length) return;

      const selector = getSelector(el);
      let section = `### ${selector}`;
      section += '\nClasses:';
      if (added.length) section += `\n  + ${added.join(' ')}`;
      if (removed.length) section += `\n  - ${removed.join(' ')}`;
      sections.push(section);
    });

    if (!sections.length) return null;
    return '## DOM Changes\n\n' + sections.join('\n\n');
  }

  function copyAllChanges() {
    const output = buildOutput();
    if (!output) {
      showToast('No changes to copy');
      return;
    }
    navigator.clipboard.writeText(output).then(() => {
      showToast('All changes copied');
    }).catch(() => {
      showToast(output.substring(0, 100) + '...');
    });
  }

  function initCopyAll() {
    const btn = getCopyButton();
    if (btn) {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        copyAllChanges();
      });
      btn.addEventListener('mouseenter', () => { btn.style.background = '#333'; });
      btn.addEventListener('mouseleave', () => { btn.style.background = '#222'; });
    }
  }

  let selBox = null;
  function playShutter() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const t = ctx.currentTime;

      // Click 1 — shutter open (short burst of noise)
      const buf1 = ctx.createBuffer(1, ctx.sampleRate * 0.02, ctx.sampleRate);
      const data1 = buf1.getChannelData(0);
      for (let i = 0; i < data1.length; i++) data1[i] = (Math.random() * 2 - 1) * (1 - i / data1.length);
      const click1 = ctx.createBufferSource();
      click1.buffer = buf1;
      const g1 = ctx.createGain();
      g1.gain.setValueAtTime(0.3, t);
      g1.gain.exponentialRampToValueAtTime(0.001, t + 0.02);
      click1.connect(g1);
      g1.connect(ctx.destination);
      click1.start(t);

      // Click 2 — shutter close (slightly delayed, lower)
      const buf2 = ctx.createBuffer(1, ctx.sampleRate * 0.015, ctx.sampleRate);
      const data2 = buf2.getChannelData(0);
      for (let i = 0; i < data2.length; i++) data2[i] = (Math.random() * 2 - 1) * (1 - i / data2.length);
      const click2 = ctx.createBufferSource();
      click2.buffer = buf2;
      const g2 = ctx.createGain();
      g2.gain.setValueAtTime(0.2, t + 0.06);
      g2.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
      click2.connect(g2);
      g2.connect(ctx.destination);
      click2.start(t + 0.06);
    } catch (e) {}
  }

  let camDragging = false, camStartX = 0, camStartY = 0, camDidDrag = false;

  async function loadH2C() {
    if (!window.html2canvas) {
      const s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
      document.head.appendChild(s);
      await new Promise(r => s.onload = r);
    }
  }

  async function saveCapture(canvas, el, filename) {
    playShutter();
    flashElement(el || document.documentElement);
    try {
      const blobPromise = new Promise(r => canvas.toBlob(r, 'image/png'));
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blobPromise })]);
      showToast('Copied to clipboard');
    } catch (err) {
      try {
        const link = document.createElement('a');
        link.download = filename || 'screenshot.png';
        link.href = canvas.toDataURL('image/png');
        link.click();
        showToast('Downloaded screenshot');
      } catch (e2) {
        showToast('Clipboard failed — requires HTTPS or localhost');
      }
    }
  }

  async function captureElement(el) {
    await loadH2C();
    const oo = el.style.outline, ob = el.style.backgroundColor;
    el.style.outline = el._origOutline || '';
    el.style.backgroundColor = el._origBg || '';
    showToast('Capturing...');
    try {
      const canvas = await html2canvas(el, { backgroundColor: null, scale: 2, logging: false });
      await saveCapture(canvas, el);
    } catch (e) { showToast('Capture failed'); }
    el.style.outline = oo;
    el.style.backgroundColor = ob;
  }

  async function captureRegion(x, y, w, h) {
    await loadH2C();
    showToast('Capturing...');
    try {
      const scale = 2;
      const full = await html2canvas(document.documentElement, {
        backgroundColor: '#fff', scale, logging: false,
        scrollX: 0, scrollY: 0,
        windowWidth: document.documentElement.scrollWidth,
        windowHeight: document.documentElement.scrollHeight
      });
      const sx = (x + window.scrollX) * scale;
      const sy = (y + window.scrollY) * scale;
      const sw = w * scale;
      const sh = h * scale;
      const crop = document.createElement('canvas');
      crop.width = sw; crop.height = sh;
      crop.getContext('2d').drawImage(full, sx, sy, sw, sh, 0, 0, sw, sh);
      await saveCapture(crop);
    } catch (e) { showToast('Capture failed'); }
  }

  async function captureFullPage() {
    await loadH2C();
    showToast('Capturing full page...');
    try {
      const canvas = await html2canvas(document.documentElement, {
        backgroundColor: '#fff', scale: 2, logging: false,
        scrollX: 0, scrollY: 0,
        windowWidth: document.documentElement.scrollWidth,
        windowHeight: document.documentElement.scrollHeight,
        width: document.documentElement.scrollWidth,
        height: document.documentElement.scrollHeight,
        ignoreElements: (el) => inspectorUI.has(el)
      });
      await saveCapture(canvas, 'full-page-screenshot.png');
    } catch (e) { showToast('Full page capture failed'); }
  }

  var camera = {
    id: 'camera',
    label: 'Screenshots',
    enabledByDefault: true,

    button: {
      icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="#fff"><circle cx="12" cy="12" r="3.2"/><path d="M9 2L7.17 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2h-3.17L15 2H9zm3 15c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5z"/></svg>',
      tooltip: 'Screenshot',
      color: COLORS.camera,
      order: 30,
    },


    shortcuts: [
      { key: 'S', meta: true, shift: true, action: 'captureFullPage' }
    ],

    init() {
      selBox = document.createElement('div');
      Object.assign(selBox.style, {
        position: 'fixed', border: '2px dashed ' + COLORS.camera, background: 'rgba(204, 51, 0, 0.08)',
        zIndex: String(Z.tooltip), pointerEvents: 'none', display: 'none', borderRadius: '2px'
      });
      document.body.appendChild(selBox);
      inspectorUI.add(selBox);


      // Camera mousedown — shift+click = full page, otherwise start drag
      document.addEventListener('mousedown', (e) => {
        if (!state.cameraMode || isInspectorUI(e.target)) return;
        e.preventDefault();
        if (e.shiftKey) {
          captureFullPage();
          return;
        }
        camDragging = true;
        camDidDrag = false;
        camStartX = e.clientX;
        camStartY = e.clientY;
      }, true);

      // Full-page highlight when shift held in camera mode
      let fullPageHighlight = false;
      function showFullPageHighlight() {
        if (fullPageHighlight) return;
        fullPageHighlight = true;
        clearHover$1();
        document.documentElement.style.outline = CAM_OUTLINE;
        document.documentElement.style.backgroundColor = CAM_BG;
      }
      function hideFullPageHighlight() {
        if (!fullPageHighlight) return;
        fullPageHighlight = false;
        document.documentElement.style.outline = '';
        document.documentElement.style.backgroundColor = '';
      }

      document.addEventListener('keydown', (e) => {
        if (state.cameraMode && e.key === 'Shift') showFullPageHighlight();
      });
      document.addEventListener('keyup', (e) => {
        if (e.key === 'Shift') hideFullPageHighlight();
      });

      // Camera mousemove — drag or hover
      document.addEventListener('mousemove', (e) => {
        if (!state.cameraMode) return;
        if (e.shiftKey) { showFullPageHighlight(); return; }
        else { hideFullPageHighlight(); }
        if (camDragging) {
          const dx = Math.abs(e.clientX - camStartX);
          const dy = Math.abs(e.clientY - camStartY);
          if (dx > 4 || dy > 4) {
            camDidDrag = true;
            clearHover$1();
            const x = Math.min(e.clientX, camStartX);
            const y = Math.min(e.clientY, camStartY);
            Object.assign(selBox.style, {
              display: 'block', left: x + 'px', top: y + 'px', width: dx + 'px', height: dy + 'px'
            });
          }
          return;
        }
        // Not dragging — show red hover
        const el = e.target;
        if (isInspectorUI(el) || el === document.body || el === document.documentElement) return;
        if (state.hovered && state.hovered !== el) {
          state.hovered.style.outline = state.hovered._origOutline || '';
          state.hovered.style.backgroundColor = state.hovered._origBg || '';
        }
        if (el !== state.hovered) {
          el._origOutline = el._origOutline ?? el.style.outline;
          el._origBg = el._origBg ?? el.style.backgroundColor;
        }
        el.style.outline = CAM_OUTLINE;
        el.style.backgroundColor = CAM_BG;
        state.hovered = el;
      }, true);

      // Camera mouseup — capture
      document.addEventListener('mouseup', (e) => {
        if (!state.cameraMode || !camDragging) return;
        camDragging = false;
        if (camDidDrag) {
          const x = Math.min(e.clientX, camStartX);
          const y = Math.min(e.clientY, camStartY);
          const w = Math.abs(e.clientX - camStartX);
          const h = Math.abs(e.clientY - camStartY);
          selBox.style.display = 'none';
          if (w > 4 && h > 4) captureRegion(x, y, w, h);
        } else {
          const el = e.target;
          if (!isInspectorUI(el) && el !== document.body && el !== document.documentElement) {
            nudge(el);
            captureElement(el);
          }
        }
        camDidDrag = false;
      }, true);
    },

    activate() {
      state.cameraMode = true;
      state.active = true;
      document.body.style.cursor = 'crosshair';
      showToast('Camera ON — click element, drag area, or Cmd+Shift+S full page');
    },

    deactivate() {
      state.cameraMode = false;
      camDragging = false;
      if (selBox) selBox.style.display = 'none';
      // Clear any hovered element highlight from camera mode
      if (state.hovered) {
        state.hovered.style.outline = state.hovered._origOutline || '';
        state.hovered.style.backgroundColor = state.hovered._origBg || '';
        state.hovered = null;
      }
      // Clear full-page highlight if shift was held
      document.documentElement.style.outline = '';
      document.documentElement.style.backgroundColor = '';
    },

    captureFullPage,

    enable() {},
    disable() { this.deactivate(); },
  };

  let drawCanvas = null;
  let isDrawing = false;

  function resizeDrawCanvas() {
    const dpr = window.devicePixelRatio || 1;
    const pageW = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth);
    const pageH = Math.max(document.documentElement.scrollHeight, document.body.scrollHeight);
    const oldData = drawCanvas.width > 0 ? drawCanvas.getContext('2d').getImageData(0, 0, drawCanvas.width, drawCanvas.height) : null;
    drawCanvas.width = pageW * dpr;
    drawCanvas.height = pageH * dpr;
    drawCanvas.style.width = pageW + 'px';
    drawCanvas.style.height = pageH + 'px';
    const ctx = drawCanvas.getContext('2d');
    ctx.scale(dpr, dpr);
    if (oldData) ctx.putImageData(oldData, 0, 0);
    ctx.strokeStyle = COLORS.pen;
    ctx.lineWidth = PEN_WIDTH;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
  }

  var draw = {
    id: 'draw',
    label: 'Draw',
    enabledByDefault: true,

    button: {
      icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="#fff"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 000-1.41l-2.34-2.34a1 1 0 00-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>',
      tooltip: 'Draw',
      color: COLORS.annotate,
      order: 10,
    },

    shortcuts: [],

    init() {
      drawCanvas = document.createElement('canvas');
      Object.assign(drawCanvas.style, {
        position: 'absolute', top: '0', left: '0', zIndex: String(Z.overlay), pointerEvents: 'none'
      });
      document.body.appendChild(drawCanvas);
      inspectorUI.add(drawCanvas);
      resizeDrawCanvas();
      window.addEventListener('resize', resizeDrawCanvas);

      // Eraser cursor (follows mouse during right-click erase)
      const ERASER_SIZE = 20;
      const eraserCursor = document.createElement('div');
      Object.assign(eraserCursor.style, {
        position: 'fixed', width: ERASER_SIZE + 'px', height: ERASER_SIZE + 'px',
        border: '2px solid #666', borderRadius: '50%', pointerEvents: 'none',
        display: 'none', zIndex: '100003', background: 'rgba(255,255,255,0.3)'
      });
      document.body.appendChild(eraserCursor);
      let isErasing = false;

      // Prevent context menu on canvas
      drawCanvas.addEventListener('contextmenu', (e) => {
        if (state.annotateMode && state.annotateSub === 'pen') e.preventDefault();
      });

      drawCanvas.addEventListener('mousedown', (e) => {
        if (!state.annotateMode || state.annotateSub !== 'pen') return;
        if (e.button === 2) {
          // Right-click: erase mode
          isErasing = true;
          eraserCursor.style.display = 'block';
          const ctx = drawCanvas.getContext('2d');
          const dpr = window.devicePixelRatio || 1;
          const x = (e.clientX + window.scrollX) * dpr;
          const y = (e.clientY + window.scrollY) * dpr;
          ctx.save();
          ctx.globalCompositeOperation = 'destination-out';
          ctx.beginPath();
          ctx.arc(x / dpr, y / dpr, ERASER_SIZE / 2, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
          eraserCursor.style.left = (e.clientX - ERASER_SIZE / 2) + 'px';
          eraserCursor.style.top = (e.clientY - ERASER_SIZE / 2) + 'px';
          return;
        }
        isDrawing = true;
        const ctx = drawCanvas.getContext('2d');
        ctx.beginPath();
        ctx.moveTo(e.clientX + window.scrollX, e.clientY + window.scrollY);
      });
      drawCanvas.addEventListener('mousemove', (e) => {
        if (isErasing) {
          eraserCursor.style.left = (e.clientX - ERASER_SIZE / 2) + 'px';
          eraserCursor.style.top = (e.clientY - ERASER_SIZE / 2) + 'px';
          const ctx = drawCanvas.getContext('2d');
          ctx.save();
          ctx.globalCompositeOperation = 'destination-out';
          ctx.beginPath();
          ctx.arc(e.clientX + window.scrollX, e.clientY + window.scrollY, ERASER_SIZE / 2, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
          return;
        }
        if (!isDrawing) return;
        const ctx = drawCanvas.getContext('2d');
        ctx.lineTo(e.clientX + window.scrollX, e.clientY + window.scrollY);
        ctx.stroke();
      });
      drawCanvas.addEventListener('mouseup', () => { isDrawing = false; isErasing = false; eraserCursor.style.display = 'none'; });
      drawCanvas.addEventListener('mouseleave', () => { isDrawing = false; isErasing = false; eraserCursor.style.display = 'none'; });
    },

    activate() {
      state.annotateMode = true;
      state.annotateSub = 'pen';
      drawCanvas.style.pointerEvents = 'auto';
      document.body.style.cursor = 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'20\' height=\'20\' viewBox=\'0 0 24 24\'%3E%3Cpath stroke=\'%23000\' stroke-width=\'1.5\' fill=\'%23fff\' d=\'M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 000-1.41l-2.34-2.34a1 1 0 00-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z\'/%3E%3C/svg%3E") 2 18, crosshair';
      showToast('Draw mode');
    },

    deactivate() {
      if (state.annotateSub === 'pen') {
        state.annotateMode = false;
      }
      isDrawing = false;
      if (drawCanvas) drawCanvas.style.pointerEvents = 'none';
    },

    clear() {
      if (!drawCanvas) return;
      const ctx = drawCanvas.getContext('2d');
      ctx.clearRect(0, 0, drawCanvas.width, drawCanvas.height);
      showToast('Drawing cleared');
    },

    enable() {},
    disable() { this.deactivate(); },
  };

  /**
   * DOM-Tools (minimal)
   * Drop <script src="dom-tools.js"></script> before </body> in any HTML file.
   * Activate by adding ?dom-tools to the page URL.
   */


  if (new URLSearchParams(window.location.search).has('dom-tools')) {
    initHelpers();

    register(annotations$1);
    register(draw);
    register(styleModifier);
    register(camera);

    renderToolbar();
    initSettings();
    boot();
    initCopyAll();
    initKeyboard();

    styleModifier.activate();
    setActiveButton('style-modifier');
  }

})();
