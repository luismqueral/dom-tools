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
    editMode: false,
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

  const OUTLINE = '2px solid ' + COLORS.selector;
  const BG = 'rgba(0, 102, 255, 0.08)';
  const SEL_OUTLINE = '2px solid ' + COLORS.selector;
  const SEL_BG = 'rgba(0, 102, 255, 0.12)';
  const SLOT_OUTLINE = '2px solid #00a651';
  const SLOT_BG = 'rgba(0, 166, 81, 0.08)';
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

  function getContext(el) {
    const sel = getSelector(el);
    const text = el.textContent.trim().substring(0, 80);
    let desc = sel;
    if (text) desc += ' | "' + text + (el.textContent.trim().length > 80 ? '...' : '') + '"';
    return desc;
  }

  function isInspectorUI(el) {
    let node = el;
    while (node) {
      if (inspectorUI.has(node)) return true;
      node = node.parentElement;
    }
    return false;
  }

  function clearHover() {
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

  function clearSelection$1() {
    state.selected.forEach(s => {
      s.el.style.outline = s.el._origOutline || '';
      s.el.style.backgroundColor = s.el._origBg || '';
      if (s.badge) s.badge.remove();
    });
    state.selected = [];
  }

  function addBadge(el, num) {
    const badge = document.createElement('div');
    badge.textContent = num;
    Object.assign(badge.style, {
      position: 'absolute', top: '-6px', left: '-6px', width: '18px', height: '18px',
      background: '#0066ff', color: '#fff', borderRadius: '50%', fontSize: '11px',
      fontWeight: '700', fontFamily: 'system-ui, sans-serif', display: 'flex',
      alignItems: 'center', justifyContent: 'center', zIndex: String(Z.badge),
      boxShadow: '0 1px 4px rgba(0,0,0,0.25)', pointerEvents: 'none'
    });
    const pos = getComputedStyle(el).position;
    if (pos === 'static') el.style.position = 'relative';
    el.appendChild(badge);
    return badge;
  }

  function refreshBadges() {
    state.selected.forEach((s, i) => {
      if (s.badge) s.badge.textContent = i + 1;
    });
  }

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
  function onToolActivate(fn) { onToolActivateCallbacks.push(fn); }
  function fireToolActivate() { onToolActivateCallbacks.forEach(fn => fn()); }

  function createButton(mod) {
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

  function setActiveButton(activeId) {
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

  function showButton(id) {
    const btn = buttonMap.get(id);
    if (btn) btn.style.display = 'flex';
  }

  function hideButton(id) {
    const btn = buttonMap.get(id);
    if (btn) btn.style.display = 'none';
  }

  // Panel API — modules call these to show/hide content in the expandable panel
  function showRailPanel(content) {
    contentPanel.innerHTML = '';
    if (typeof content === 'string') {
      contentPanel.innerHTML = content;
    } else if (content instanceof HTMLElement) {
      contentPanel.appendChild(content);
    }
    contentPanel.style.display = 'block';
    document.body.style.paddingLeft = (RAIL_WIDTH + PANEL_WIDTH) + 'px';
  }

  function hideRailPanel() {
    contentPanel.style.display = 'none';
    contentPanel.innerHTML = '';
    document.body.style.paddingLeft = RAIL_WIDTH + 'px';
  }

  // Copy All Changes button (wired externally by copy-all.js)
  let copyBtn = null;
  let copyBadge = null;

  function getCopyButton() { return copyBtn; }

  function updateCopyBadge(count) {
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

  function renderRail() {
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

  let lastEsc = 0;

  function initKeyboard() {
    document.addEventListener('keydown', (e) => {
      // Alt key for slot mode
      if (e.key === 'Alt') {
        e.preventDefault();
        state.altHeld = true;
        return;
      }

      // Check module shortcuts
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
              if (stayed) {
                setActiveButton(mod.id);
              } else {
                const selectorMod = modules.find(m => m.id === 'selector');
                if (selectorMod && selectorMod.activate) selectorMod.activate();
                setActiveButton('selector');
              }
            } else if (sc.action && mod[sc.action]) {
              mod[sc.action]();
            }
            return;
          }
        }
      }


      // Escape handling
      if (e.key === 'Escape') {
        if (state.annotateMode) {
          e.preventDefault();
          const selectorMod = modules.find(m => m.id === 'selector');
          if (selectorMod) { selectorMod.activate(); setActiveButton('selector'); }
          modules.filter(m => m.id === 'draw' || m.id === 'annotations').forEach(m => m.deactivate?.());
          state.annotateMode = false;
          return;
        }
        if (state.cameraMode) {
          e.preventDefault();
          const cameraMod = modules.find(m => m.id === 'camera');
          if (cameraMod) cameraMod.deactivate();
          const selectorMod = modules.find(m => m.id === 'selector');
          if (selectorMod) selectorMod.activate();
          setActiveButton('selector');
          return;
        }
        // Double-tap escape toggles selector
        const now = Date.now();
        if (now - lastEsc < 400) {
          const selectorMod = modules.find(m => m.id === 'selector');
          if (selectorMod && selectorMod.toggle) {
            const stayed = selectorMod.toggle();
            setActiveButton(stayed ? 'selector' : '');
          }
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

  let visible = false;
  let _settingsBtn = null;
  const SETTINGS_COLOR = '#0066ff';

  // --- Experiments ---
  const EXP_KEY = 'dom-tools-experiments';
  let experiments = {};
  try { experiments = JSON.parse(localStorage.getItem(EXP_KEY) || '{}'); } catch (e) {}

  const EXPERIMENT_DEFS = [
    { id: 'design', label: 'Design Mode', description: 'Contextual style editor with Tailwind class controls', default: true },
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

  function toggleSettings() {
    visible = !visible;
    if (visible) {
      activateModule(null);
      setActiveButton(null);
      showRailPanel(buildSettingsPanel());
      if (_settingsBtn) _settingsBtn.style.background = SETTINGS_COLOR;
    } else {
      hideRailPanel();
      if (_settingsBtn) _settingsBtn.style.background = 'transparent';
      activateModule('selector');
      setActiveButton('selector');
    }
  }

  function closeSettings() {
    if (visible) {
      visible = false;
      hideRailPanel();
      if (_settingsBtn) _settingsBtn.style.background = 'transparent';
    }
  }

  function initSettings(rail) {

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
    bottomSection.appendChild(_settingsBtn);
    inspectorUI.add(_settingsBtn);
  }

  // Inject Tailwind CDN (async, preflight disabled) so design-mode classes render.
  // Called lazily — only when user first enters a mode that needs Tailwind.
  function loadTailwind() {
    if (window.tailwind || document.querySelector('script[src*="tailwindcss"]')) return;
    window.tailwind = { config: { corePlugins: { preflight: false } } };
    const s = document.createElement('script');
    s.src = 'https://cdn.tailwindcss.com';
    document.head.appendChild(s);
  }

  // --- Tailwind class database ---
  const CLASSES = [
    'block','inline-block','inline','flex','inline-flex','grid','inline-grid','hidden','contents',
    'static','fixed','absolute','relative','sticky',
    'flex-row','flex-row-reverse','flex-col','flex-col-reverse',
    'flex-wrap','flex-nowrap','flex-1','flex-auto','flex-none','grow','grow-0','shrink','shrink-0',
    'justify-start','justify-end','justify-center','justify-between','justify-around','justify-evenly',
    'items-start','items-end','items-center','items-baseline','items-stretch',
    'grid-cols-1','grid-cols-2','grid-cols-3','grid-cols-4','grid-cols-6','grid-cols-12',
    'gap-0','gap-1','gap-2','gap-3','gap-4','gap-5','gap-6','gap-8','gap-10','gap-12',
    'p-0','p-1','p-2','p-3','p-4','p-5','p-6','p-8','p-10','p-12','p-16','p-20',
    'px-0','px-1','px-2','px-3','px-4','px-6','px-8','px-12',
    'py-0','py-1','py-2','py-3','py-4','py-6','py-8','py-12',
    'm-0','m-1','m-2','m-3','m-4','m-6','m-8','m-auto',
    'mx-0','mx-1','mx-2','mx-4','mx-6','mx-8','mx-auto',
    'my-0','my-1','my-2','my-4','my-6','my-8',
    'mt-0','mt-1','mt-2','mt-4','mt-6','mt-8','mt-12',
    'mb-0','mb-1','mb-2','mb-4','mb-6','mb-8','mb-12',
    'w-auto','w-full','w-screen','w-fit','w-1/2','w-1/3','w-2/3','w-1/4','w-3/4',
    'h-auto','h-full','h-screen','h-fit',
    'max-w-none','max-w-xs','max-w-sm','max-w-md','max-w-lg','max-w-xl','max-w-2xl','max-w-4xl','max-w-full','max-w-prose',
    'text-xs','text-sm','text-base','text-lg','text-xl','text-2xl','text-3xl','text-4xl','text-5xl',
    'font-thin','font-light','font-normal','font-medium','font-semibold','font-bold','font-extrabold','font-black',
    'italic','not-italic','underline','no-underline','uppercase','lowercase','normal-case',
    'text-left','text-center','text-right','text-justify',
    'leading-none','leading-tight','leading-snug','leading-normal','leading-relaxed','leading-loose',
    'tracking-tighter','tracking-tight','tracking-normal','tracking-wide','tracking-wider','tracking-widest',
    'text-transparent','text-black','text-white','text-gray-500','text-gray-700','text-gray-900',
    'text-red-600','text-blue-600','text-green-600','text-nyt-fg','text-nyt-dim','text-nyt-accent',
    'bg-transparent','bg-black','bg-white','bg-gray-50','bg-gray-100','bg-gray-200','bg-gray-500','bg-gray-800','bg-gray-900',
    'bg-red-50','bg-blue-50','bg-green-50','bg-nyt-bg-alt',
    'border','border-0','border-2','border-4',
    'border-solid','border-dashed','border-none',
    'border-gray-200','border-gray-300','border-gray-500','border-nyt-border',
    'rounded-none','rounded-sm','rounded','rounded-md','rounded-lg','rounded-xl','rounded-2xl','rounded-full',
    'shadow-none','shadow-sm','shadow','shadow-md','shadow-lg','shadow-xl','shadow-2xl',
    'opacity-0','opacity-25','opacity-50','opacity-75','opacity-100',
    'overflow-hidden','overflow-auto','overflow-visible',
    'object-contain','object-cover','object-fill','object-none',
    'font-franklin','font-cheltenham','font-karnak',
    'transition','transition-all','transition-colors','transition-opacity',
    'duration-150','duration-200','duration-300','duration-500',
  ];

  // --- Slider configurations per context ---
  const TYPO_SLIDERS = [
    { label: 'Size', options: ['text-xs','text-sm','text-base','text-lg','text-xl','text-2xl','text-3xl','text-4xl','text-5xl'] },
    { label: 'Weight', options: ['font-thin','font-light','font-normal','font-medium','font-semibold','font-bold','font-extrabold','font-black'] },
    { label: 'Leading', options: ['leading-none','leading-tight','leading-snug','leading-normal','leading-relaxed','leading-loose'] },
    { label: 'Tracking', options: ['tracking-tighter','tracking-tight','tracking-normal','tracking-wide','tracking-wider','tracking-widest'] },
  ];

  const LAYOUT_SLIDERS = [
    { label: 'Padding', options: ['p-0','p-1','p-2','p-3','p-4','p-5','p-6','p-8','p-10','p-12','p-16','p-20'] },
    { label: 'Pad X', options: ['px-0','px-1','px-2','px-3','px-4','px-6','px-8','px-12'] },
    { label: 'Pad Y', options: ['py-0','py-1','py-2','py-3','py-4','py-6','py-8','py-12'] },
    { label: 'Gap', options: ['gap-0','gap-1','gap-2','gap-3','gap-4','gap-5','gap-6','gap-8','gap-10','gap-12'] },
    { label: 'Rounded', options: ['rounded-none','rounded-sm','rounded','rounded-md','rounded-lg','rounded-xl','rounded-2xl','rounded-full'] },
    { label: 'Shadow', options: ['shadow-none','shadow-sm','shadow','shadow-md','shadow-lg','shadow-xl','shadow-2xl'] },
  ];

  const MEDIA_SLIDERS = [
    { label: 'Rounded', options: ['rounded-none','rounded-sm','rounded','rounded-md','rounded-lg','rounded-xl','rounded-2xl','rounded-full'] },
    { label: 'Shadow', options: ['shadow-none','shadow-sm','shadow','shadow-md','shadow-lg','shadow-xl','shadow-2xl'] },
    { label: 'Opacity', options: ['opacity-0','opacity-25','opacity-50','opacity-75','opacity-100'] },
  ];

  const TEXT_COLORS = [
    { cls: 'text-black', color: '#000' },
    { cls: 'text-gray-900', color: '#111827' },
    { cls: 'text-gray-700', color: '#374151' },
    { cls: 'text-gray-500', color: '#6b7280' },
    { cls: 'text-white', color: '#fff' },
    { cls: 'text-red-600', color: '#dc2626' },
    { cls: 'text-blue-600', color: '#2563eb' },
    { cls: 'text-green-600', color: '#16a34a' },
    { cls: 'text-nyt-fg', color: '#121212' },
    { cls: 'text-nyt-dim', color: '#5a5a5a' },
    { cls: 'text-nyt-accent', color: '#326891' },
  ];

  const BG_COLORS = [
    { cls: 'bg-transparent', color: 'transparent' },
    { cls: 'bg-white', color: '#fff' },
    { cls: 'bg-gray-50', color: '#f9fafb' },
    { cls: 'bg-gray-100', color: '#f3f4f6' },
    { cls: 'bg-gray-200', color: '#e5e7eb' },
    { cls: 'bg-gray-800', color: '#1f2937' },
    { cls: 'bg-gray-900', color: '#111827' },
    { cls: 'bg-black', color: '#000' },
    { cls: 'bg-blue-50', color: '#eff6ff' },
    { cls: 'bg-red-50', color: '#fef2f2' },
    { cls: 'bg-nyt-bg-alt', color: '#f5f5f2' },
  ];

  const ALIGN_OPTIONS = ['text-left','text-center','text-right','text-justify'];
  const DISPLAY_OPTIONS = ['block','flex','grid','inline','inline-flex','hidden'];
  const JUSTIFY_OPTIONS = ['justify-start','justify-center','justify-end','justify-between','justify-around'];
  const ITEMS_OPTIONS = ['items-start','items-center','items-end','items-stretch','items-baseline'];
  const OBJECT_FIT_OPTIONS = ['object-contain','object-cover','object-fill','object-none'];

  // --- State ---
  let selected = []; // { el, originalClasses }[]
  let activeMode$1 = false;

  // --- Export for copy-all and annotations ---
  function getSelected() { return selected; }

  // --- Element type detection ---
  function getElType(el) {
    const tag = el.tagName;
    if (['IMG','VIDEO','SVG','PICTURE','CANVAS'].includes(tag)) return 'media';
    if (['P','H1','H2','H3','H4','H5','H6','SPAN','A','LABEL','LI','BLOCKQUOTE','FIGCAPTION','DT','DD','EM','STRONG','SMALL'].includes(tag)) return 'text';
    if (['BUTTON','INPUT','SELECT','TEXTAREA'].includes(tag)) return 'interactive';
    return 'container';
  }

  function getMixedType(elements) {
    const types = new Set(elements.map(s => getElType(s.el)));
    if (types.size === 1) return [...types][0];
    return 'mixed';
  }

  // --- Apply class to all selected ---
  function applyToAll(addCls, groupOptions) {
    selected.forEach(({ el }) => {
      if (groupOptions) groupOptions.forEach(c => el.classList.remove(c));
      if (addCls) el.classList.add(addCls);
    });
  }

  function removeFromAll(cls) {
    selected.forEach(({ el }) => el.classList.remove(cls));
  }

  function resetAll() {
    selected.forEach(({ el, originalClasses }) => { el.className = originalClasses; });
    renderPanel();
    showToast('Reset');
  }

  // --- Render panel into rail content area ---
  let activeTab = null;

  function renderPanel() {
    const container = document.createElement('div');
    if (!selected.length) { hideRailPanel(); return; }

    const type = getMixedType(selected);
    const primary = selected[0].el;

    // Determine available tabs
    const tabs = [];
    if (type === 'text' || type === 'mixed' || type === 'interactive') tabs.push({ id: 'type', label: 'Type' });
    if (type === 'container' || type === 'mixed' || type === 'interactive') tabs.push({ id: 'layout', label: 'Layout' });
    if (type === 'media') tabs.push({ id: 'media', label: 'Media' });
    tabs.push({ id: 'style', label: 'Style' });
    tabs.push({ id: 'classes', label: 'Classes' });

    if (!activeTab || !tabs.find(t => t.id === activeTab)) activeTab = tabs[0].id;

    // Header row
    const header = document.createElement('div');
    Object.assign(header.style, { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' });
    const title = document.createElement('span');
    title.textContent = selected.length > 1 ? `${selected.length} elements` : `<${primary.tagName.toLowerCase()}>`;
    Object.assign(title.style, { fontWeight: '600', fontSize: '11px', color: '#666' });
    const resetBtn = makeBtn('Reset', () => resetAll());
    header.appendChild(title);
    header.appendChild(resetBtn);
    container.appendChild(header);

    // Tab bar
    const tabBar = document.createElement('div');
    Object.assign(tabBar.style, { display: 'flex', gap: '2px', marginBottom: '10px', borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: '6px' });
    tabs.forEach(tab => {
      const t = document.createElement('div');
      t.textContent = tab.label;
      const isActive = tab.id === activeTab;
      Object.assign(t.style, {
        padding: '3px 8px', borderRadius: '4px', cursor: 'pointer', fontSize: '10px', fontWeight: '600',
        color: isActive ? '#ec4899' : '#888',
        background: isActive ? 'rgba(236,72,153,0.12)' : 'transparent'
      });
      t.addEventListener('mouseenter', () => { if (!isActive) t.style.background = 'rgba(255,255,255,0.06)'; });
      t.addEventListener('mouseleave', () => { if (!isActive) t.style.background = 'transparent'; });
      t.addEventListener('click', (e) => { e.stopPropagation(); activeTab = tab.id; renderPanel(); });
      tabBar.appendChild(t);
    });
    container.appendChild(tabBar);

    // Tab content
    const tabContent = document.createElement('div');
    if (activeTab === 'type') renderTextControls(tabContent, primary);
    else if (activeTab === 'layout') renderLayoutControls(tabContent, primary);
    else if (activeTab === 'media') renderMediaControls(tabContent, primary);
    else if (activeTab === 'style') {
      renderSection(tabContent, 'Background', (sec) => renderColorSwatches(sec, BG_COLORS, primary));
      renderSection(tabContent, 'Border & Effects', (sec) => {
        sec.appendChild(makeSlider('Rounded', ['rounded-none','rounded-sm','rounded','rounded-md','rounded-lg','rounded-xl','rounded-2xl','rounded-full'], primary));
        sec.appendChild(makeSlider('Shadow', ['shadow-none','shadow-sm','shadow','shadow-md','shadow-lg','shadow-xl','shadow-2xl'], primary));
        sec.appendChild(makeSlider('Opacity', ['opacity-0','opacity-25','opacity-50','opacity-75','opacity-100'], primary));
      });
    }
    else if (activeTab === 'classes') renderClassEditor(tabContent, primary);
    container.appendChild(tabContent);

    showRailPanel(container);
  }

  // --- Exported: render Tailwind controls into a given container (used by annotations) ---
  function renderDesignControls(container, elements, onChangeCallback) {
    const origSelected = selected;
    selected = elements;
    const type = getMixedType(selected);
    const primary = selected[0].el;

    const tabs = [];
    if (type === 'text' || type === 'mixed' || type === 'interactive') tabs.push({ id: 'type', label: 'Type' });
    if (type === 'container' || type === 'mixed' || type === 'interactive') tabs.push({ id: 'layout', label: 'Layout' });
    if (type === 'media') tabs.push({ id: 'media', label: 'Media' });
    tabs.push({ id: 'style', label: 'Style' });
    tabs.push({ id: 'classes', label: 'Classes' });

    if (!activeTab || !tabs.find(t => t.id === activeTab)) activeTab = tabs[0].id;

    // Tab bar
    const tabBar = document.createElement('div');
    Object.assign(tabBar.style, { display: 'flex', gap: '2px', marginBottom: '10px', borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: '6px' });
    tabs.forEach(tab => {
      const t = document.createElement('div');
      t.textContent = tab.label;
      const isActive = tab.id === activeTab;
      Object.assign(t.style, {
        padding: '3px 8px', borderRadius: '4px', cursor: 'pointer', fontSize: '10px', fontWeight: '600',
        color: isActive ? '#ec4899' : '#888',
        background: isActive ? 'rgba(236,72,153,0.12)' : 'transparent'
      });
      t.addEventListener('mouseenter', () => { if (!isActive) t.style.background = 'rgba(255,255,255,0.06)'; });
      t.addEventListener('mouseleave', () => { if (!isActive) t.style.background = 'transparent'; });
      t.addEventListener('click', (e) => {
        e.stopPropagation();
        activeTab = tab.id;
        container.innerHTML = '';
        renderDesignControls(container, selected, onChangeCallback);
      });
      tabBar.appendChild(t);
    });
    container.appendChild(tabBar);

    // Tab content
    const tabContent = document.createElement('div');
    if (activeTab === 'type') renderTextControls(tabContent, primary);
    else if (activeTab === 'layout') renderLayoutControls(tabContent, primary);
    else if (activeTab === 'media') renderMediaControls(tabContent, primary);
    else if (activeTab === 'style') {
      renderSection(tabContent, 'Background', (sec) => renderColorSwatches(sec, BG_COLORS, primary));
      renderSection(tabContent, 'Border & Effects', (sec) => {
        sec.appendChild(makeSlider('Rounded', ['rounded-none','rounded-sm','rounded','rounded-md','rounded-lg','rounded-xl','rounded-2xl','rounded-full'], primary));
        sec.appendChild(makeSlider('Shadow', ['shadow-none','shadow-sm','shadow','shadow-md','shadow-lg','shadow-xl','shadow-2xl'], primary));
        sec.appendChild(makeSlider('Opacity', ['opacity-0','opacity-25','opacity-50','opacity-75','opacity-100'], primary));
      });
    }
    else if (activeTab === 'classes') renderClassEditor(tabContent, primary);
    container.appendChild(tabContent);

    selected = origSelected;
    if (onChangeCallback) onChangeCallback();
  }

  function renderSection(parent, label, renderFn) {
    const sec = document.createElement('div');
    Object.assign(sec.style, { marginBottom: '10px', paddingTop: '8px', borderTop: '1px solid rgba(255,255,255,0.06)' });
    const heading = document.createElement('div');
    heading.textContent = label;
    Object.assign(heading.style, { fontSize: '10px', fontWeight: '600', color: '#666', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.5px' });
    sec.appendChild(heading);
    parent.appendChild(sec);
    renderFn(sec);
  }

  // --- Text controls ---
  function renderTextControls(parent, el) {
    renderSection(parent, 'Typography', (sec) => {
      const fontRow = makeRow();
      ['font-franklin','font-cheltenham','font-karnak'].forEach(cls => {
        const name = cls.replace('font-', '');
        const btn = makePillBtn(name, el.classList.contains(cls), () => {
          applyToAll(cls, ['font-franklin','font-cheltenham','font-karnak']);
          renderPanel();
        });
        fontRow.appendChild(btn);
      });
      sec.appendChild(fontRow);

      TYPO_SLIDERS.forEach(s => sec.appendChild(makeSlider(s.label, s.options, el)));

      const toggleRow = makeRow();
      toggleRow.appendChild(makeToggle('B', 'font-bold', ['font-thin','font-light','font-normal','font-medium','font-semibold','font-bold','font-extrabold','font-black'], el));
      toggleRow.appendChild(makeToggle('I', 'italic', ['italic','not-italic'], el));
      toggleRow.appendChild(makeToggle('U', 'underline', ['underline','no-underline'], el));
      toggleRow.appendChild(makeToggle('TT', 'uppercase', ['uppercase','lowercase','capitalize','normal-case'], el));
      const spacer = document.createElement('div'); spacer.style.flex = '1'; toggleRow.appendChild(spacer);
      ALIGN_OPTIONS.forEach(cls => {
        const icon = cls === 'text-left' ? '\u2190' : cls === 'text-center' ? '\u2194' : cls === 'text-right' ? '\u2192' : '\u2261';
        toggleRow.appendChild(makeToggle(icon, cls, ALIGN_OPTIONS, el));
      });
      sec.appendChild(toggleRow);

      sec.appendChild(makeColorRow('Color', TEXT_COLORS, el));
    });
  }

  // --- Layout controls ---
  function renderLayoutControls(parent, el) {
    renderSection(parent, 'Layout', (sec) => {
      const dispRow = makeRow();
      DISPLAY_OPTIONS.forEach(cls => {
        dispRow.appendChild(makePillBtn(cls, el.classList.contains(cls), () => {
          applyToAll(cls, DISPLAY_OPTIONS);
          renderPanel();
        }));
      });
      sec.appendChild(dispRow);

      const cs = getComputedStyle(el);
      if (cs.display === 'flex' || cs.display === 'grid' || el.classList.contains('flex') || el.classList.contains('grid')) {
        const flexRow = makeRow();
        flexRow.appendChild(makeLabel('Justify'));
        JUSTIFY_OPTIONS.forEach(cls => {
          const short = cls.replace('justify-', '')[0].toUpperCase();
          flexRow.appendChild(makeToggle(short, cls, JUSTIFY_OPTIONS, el));
        });
        sec.appendChild(flexRow);

        const itemsRow = makeRow();
        itemsRow.appendChild(makeLabel('Items'));
        ITEMS_OPTIONS.forEach(cls => {
          const short = cls.replace('items-', '')[0].toUpperCase();
          itemsRow.appendChild(makeToggle(short, cls, ITEMS_OPTIONS, el));
        });
        sec.appendChild(itemsRow);
      }

      LAYOUT_SLIDERS.forEach(s => sec.appendChild(makeSlider(s.label, s.options, el)));
    });
  }

  // --- Media controls ---
  function renderMediaControls(parent, el) {
    renderSection(parent, 'Media', (sec) => {
      const fitRow = makeRow();
      fitRow.appendChild(makeLabel('Fit'));
      OBJECT_FIT_OPTIONS.forEach(cls => {
        fitRow.appendChild(makePillBtn(cls.replace('object-', ''), el.classList.contains(cls), () => {
          applyToAll(cls, OBJECT_FIT_OPTIONS);
          renderPanel();
        }));
      });
      sec.appendChild(fitRow);

      MEDIA_SLIDERS.forEach(s => sec.appendChild(makeSlider(s.label, s.options, el)));
    });
  }

  // --- Class editor ---
  function renderClassEditor(parent, el) {
    renderSection(parent, 'Classes', (sec) => {
      const chips = document.createElement('div');
      Object.assign(chips.style, { display: 'flex', flexWrap: 'wrap', gap: '3px', marginBottom: '8px', maxHeight: '80px', overflowY: 'auto' });
      const classes = el.className.trim().split(/\s+/).filter(Boolean);
      classes.forEach(cls => {
        const chip = document.createElement('span');
        Object.assign(chip.style, {
          display: 'inline-flex', alignItems: 'center', gap: '2px',
          background: 'rgba(255,255,255,0.08)', borderRadius: '3px', padding: '2px 5px',
          fontSize: '10px', fontFamily: 'SF Mono, SFMono-Regular, Menlo, monospace', color: '#ccc'
        });
        chip.textContent = cls;
        const x = document.createElement('span');
        x.textContent = '\u00d7';
        Object.assign(x.style, { cursor: 'pointer', color: '#888', marginLeft: '2px', fontSize: '12px' });
        x.addEventListener('click', () => { removeFromAll(cls); renderPanel(); });
        x.addEventListener('mouseenter', () => { x.style.color = '#fff'; });
        x.addEventListener('mouseleave', () => { x.style.color = '#888'; });
        chip.appendChild(x);
        chips.appendChild(chip);
      });
      sec.appendChild(chips);

      const inputWrap = document.createElement('div');
      Object.assign(inputWrap.style, { position: 'relative' });
      const input = document.createElement('input');
      input.placeholder = '+ Add class...';
      Object.assign(input.style, {
        width: '100%', padding: '5px 7px', borderRadius: '4px', border: '1px solid rgba(255,255,255,0.12)',
        background: 'rgba(255,255,255,0.06)', color: '#fff', fontSize: '11px', outline: 'none',
        fontFamily: 'SF Mono, SFMono-Regular, Menlo, monospace', boxSizing: 'border-box'
      });
      const dropdown = document.createElement('div');
      Object.assign(dropdown.style, {
        position: 'absolute', left: '0', right: '0', top: '100%', marginTop: '3px',
        background: 'rgba(35,35,35,0.98)', borderRadius: '5px', border: '1px solid rgba(255,255,255,0.1)',
        maxHeight: '120px', overflowY: 'auto', display: 'none', zIndex: '1'
      });
      input.addEventListener('input', () => {
        const q = input.value.trim().toLowerCase();
        if (!q) { dropdown.style.display = 'none'; return; }
        const matches = CLASSES.filter(c => c.startsWith(q)).concat(CLASSES.filter(c => !c.startsWith(q) && c.includes(q))).slice(0, 8);
        dropdown.innerHTML = '';
        matches.forEach(cls => {
          const item = document.createElement('div');
          item.textContent = cls;
          Object.assign(item.style, { padding: '4px 8px', cursor: 'pointer', fontSize: '10px', color: '#ccc', fontFamily: 'SF Mono, SFMono-Regular, Menlo, monospace' });
          item.addEventListener('mouseenter', () => { item.style.background = 'rgba(255,255,255,0.06)'; });
          item.addEventListener('mouseleave', () => { item.style.background = ''; });
          item.addEventListener('mousedown', (e) => { e.preventDefault(); applyToAll(cls, null); input.value = ''; dropdown.style.display = 'none'; renderPanel(); });
          dropdown.appendChild(item);
        });
        dropdown.style.display = matches.length ? 'block' : 'none';
      });
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && input.value.trim()) { e.preventDefault(); applyToAll(input.value.trim(), null); input.value = ''; dropdown.style.display = 'none'; renderPanel(); }
        if (e.key === 'Escape') { dropdown.style.display = 'none'; input.value = ''; }
      });
      inputWrap.appendChild(input);
      inputWrap.appendChild(dropdown);
      sec.appendChild(inputWrap);
    });
  }

  // --- UI helpers ---
  function makeRow() {
    const r = document.createElement('div');
    Object.assign(r.style, { display: 'flex', alignItems: 'center', gap: '3px', marginBottom: '5px', flexWrap: 'wrap' });
    return r;
  }

  function makeLabel(text) {
    const l = document.createElement('span');
    l.textContent = text;
    Object.assign(l.style, { fontSize: '10px', color: '#888', width: '40px', flexShrink: '0' });
    return l;
  }

  function makeBtn(text, onClick, primary) {
    const btn = document.createElement('button');
    btn.textContent = text;
    Object.assign(btn.style, {
      background: 'rgba(255,255,255,0.08)', border: 'none',
      color: '#ccc', padding: '3px 10px', borderRadius: '4px',
      fontSize: '10px', fontWeight: '600', cursor: 'pointer'
    });
    btn.addEventListener('click', onClick);
    return btn;
  }

  function makePillBtn(text, isActive, onClick) {
    const btn = document.createElement('div');
    btn.textContent = text;
    Object.assign(btn.style, {
      padding: '2px 6px', borderRadius: '3px', cursor: 'pointer', fontSize: '10px',
      fontFamily: 'SF Mono, SFMono-Regular, Menlo, monospace',
      background: isActive ? 'rgba(236,72,153,0.25)' : 'rgba(255,255,255,0.06)',
      color: isActive ? '#ec4899' : '#aaa', fontWeight: isActive ? '600' : '400'
    });
    btn.addEventListener('mouseenter', () => { if (!isActive) btn.style.background = 'rgba(255,255,255,0.1)'; });
    btn.addEventListener('mouseleave', () => { if (!isActive) btn.style.background = 'rgba(255,255,255,0.06)'; });
    btn.addEventListener('click', (e) => { e.stopPropagation(); onClick(); });
    return btn;
  }

  function makeToggle(label, activeClass, group, el) {
    const isActive = el.classList.contains(activeClass);
    const btn = document.createElement('div');
    btn.textContent = label;
    Object.assign(btn.style, {
      width: '22px', height: '22px', display: 'flex', alignItems: 'center', justifyContent: 'center',
      borderRadius: '3px', cursor: 'pointer', fontSize: label.length > 1 ? '8px' : '11px',
      fontWeight: '700', color: isActive ? '#ec4899' : '#999',
      background: isActive ? 'rgba(236,72,153,0.2)' : 'rgba(255,255,255,0.04)',
      fontStyle: label === 'I' ? 'italic' : 'normal',
      textDecoration: label === 'U' ? 'underline' : 'none'
    });
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const has = selected[0].el.classList.contains(activeClass);
      if (has) { applyToAll(null, [activeClass]); }
      else { applyToAll(activeClass, group); }
      renderPanel();
    });
    return btn;
  }

  function makeSlider(label, options, el) {
    const row = document.createElement('div');
    Object.assign(row.style, { display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' });

    const lbl = document.createElement('span');
    lbl.textContent = label;
    Object.assign(lbl.style, { fontSize: '10px', color: '#888', width: '48px', flexShrink: '0' });

    let currentIdx = 0;
    for (let i = 0; i < options.length; i++) {
      if (el.classList.contains(options[i])) { currentIdx = i; break; }
    }

    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = '0';
    slider.max = String(options.length - 1);
    slider.value = String(currentIdx);
    Object.assign(slider.style, { flex: '1', height: '4px', accentColor: '#ec4899', cursor: 'pointer' });

    const val = document.createElement('span');
    val.textContent = options[currentIdx];
    Object.assign(val.style, {
      fontSize: '9px', color: '#aaa', width: '56px', textAlign: 'right', flexShrink: '0',
      fontFamily: 'SF Mono, SFMono-Regular, Menlo, monospace', overflow: 'hidden',
      textOverflow: 'ellipsis', whiteSpace: 'nowrap'
    });

    slider.addEventListener('input', () => {
      const cls = options[parseInt(slider.value)];
      val.textContent = cls;
      applyToAll(cls, options);
    });

    row.appendChild(lbl);
    row.appendChild(slider);
    row.appendChild(val);
    return row;
  }

  const ALL_COLOR_CLASSES = CLASSES.filter(c => c.startsWith('text-') || c.startsWith('bg-') || c.startsWith('border-'));

  function makeColorRow(label, colors, el) {
    const wrap = document.createElement('div');
    Object.assign(wrap.style, { marginTop: '6px' });

    const row = document.createElement('div');
    Object.assign(row.style, { display: 'flex', alignItems: 'center', gap: '3px', flexWrap: 'wrap' });
    const lbl = document.createElement('span');
    lbl.textContent = label;
    Object.assign(lbl.style, { fontSize: '10px', color: '#888', width: '48px', flexShrink: '0' });
    row.appendChild(lbl);

    const allCls = colors.map(c => c.cls);
    colors.forEach(({ cls, color }) => {
      const isActive = el.classList.contains(cls);
      const swatch = document.createElement('div');
      Object.assign(swatch.style, {
        width: '14px', height: '14px', borderRadius: '50%', cursor: 'pointer',
        background: color === 'transparent' ? 'repeating-conic-gradient(#666 0% 25%, #444 0% 50%) 50%/8px 8px' : color,
        border: isActive ? '2px solid #ec4899' : '2px solid rgba(255,255,255,0.1)',
        boxSizing: 'border-box'
      });
      swatch.title = cls;
      swatch.addEventListener('click', (e) => {
        e.stopPropagation();
        applyToAll(cls, allCls);
        renderPanel();
      });
      row.appendChild(swatch);
    });
    wrap.appendChild(row);

    const inputWrap = document.createElement('div');
    Object.assign(inputWrap.style, { position: 'relative', marginTop: '5px', marginLeft: '48px' });
    const input = document.createElement('input');
    input.placeholder = label === 'Fill' ? 'bg-...' : 'text-...';
    Object.assign(input.style, {
      width: '100%', padding: '4px 6px', borderRadius: '4px', border: '1px solid rgba(255,255,255,0.1)',
      background: 'rgba(255,255,255,0.05)', color: '#fff', fontSize: '10px', outline: 'none',
      fontFamily: 'SF Mono, SFMono-Regular, Menlo, monospace', boxSizing: 'border-box'
    });
    const dropdown = document.createElement('div');
    Object.assign(dropdown.style, {
      position: 'absolute', left: '0', right: '0', top: '100%', marginTop: '2px',
      background: 'rgba(35,35,35,0.98)', borderRadius: '5px', border: '1px solid rgba(255,255,255,0.1)',
      maxHeight: '100px', overflowY: 'auto', display: 'none', zIndex: '1'
    });

    const prefix = label === 'Fill' ? 'bg-' : label === 'Color' ? 'text-' : 'border-';
    input.addEventListener('input', () => {
      const q = input.value.trim().toLowerCase();
      if (!q) { dropdown.style.display = 'none'; return; }
      const matches = ALL_COLOR_CLASSES.filter(c => c.startsWith(prefix) && c.includes(q)).slice(0, 8);
      dropdown.innerHTML = '';
      matches.forEach(cls => {
        const item = document.createElement('div');
        item.textContent = cls;
        Object.assign(item.style, { padding: '3px 7px', cursor: 'pointer', fontSize: '10px', color: '#ccc', fontFamily: 'SF Mono, SFMono-Regular, Menlo, monospace' });
        item.addEventListener('mouseenter', () => { item.style.background = 'rgba(255,255,255,0.06)'; });
        item.addEventListener('mouseleave', () => { item.style.background = ''; });
        item.addEventListener('mousedown', (e) => {
          e.preventDefault();
          applyToAll(cls, allCls);
          input.value = '';
          dropdown.style.display = 'none';
          renderPanel();
        });
        dropdown.appendChild(item);
      });
      dropdown.style.display = matches.length ? 'block' : 'none';
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && input.value.trim()) {
        e.preventDefault();
        applyToAll(input.value.trim(), allCls);
        input.value = '';
        dropdown.style.display = 'none';
        renderPanel();
      }
      if (e.key === 'Escape') { dropdown.style.display = 'none'; input.value = ''; }
    });
    inputWrap.appendChild(input);
    inputWrap.appendChild(dropdown);
    wrap.appendChild(inputWrap);

    return wrap;
  }

  function renderColorSwatches(parent, colors, el) {
    parent.appendChild(makeColorRow('Fill', colors, el));
  }

  // --- Selection + highlight ---
  const TEXT_TAGS = ['P','H1','H2','H3','H4','H5','H6','SPAN','A','LABEL','LI','BLOCKQUOTE','FIGCAPTION','DT','DD','EM','STRONG','SMALL'];

  function selectElement(el, additive) {
    if (!additive) {
      selected.forEach(s => {
        s.el.style.outline = s.origOutline;
        if (s.madeEditable) { s.el.contentEditable = 'false'; s.el.style.cursor = ''; }
      });
      selected = [];
    }
    const idx = selected.findIndex(s => s.el === el);
    if (idx !== -1) {
      el.style.outline = selected[idx].origOutline;
      if (selected[idx].madeEditable) { el.contentEditable = 'false'; el.style.cursor = ''; }
      selected.splice(idx, 1);
    } else {
      const isText = TEXT_TAGS.includes(el.tagName);
      const entry = { el, originalClasses: el.className, origOutline: el.style.outline, madeEditable: false };
      if (isText) {
        el.contentEditable = 'true';
        el.style.cursor = 'text';
        entry.madeEditable = true;
      }
      selected.push(entry);
      el.style.outline = '2px solid #ec4899';
    }
    renderPanel();
  }

  function clearSelection() {
    selected.forEach(s => {
      s.el.style.outline = s.origOutline;
      if (s.madeEditable) { s.el.contentEditable = 'false'; s.el.style.cursor = ''; }
    });
    selected = [];
    hideRailPanel();
  }

  // --- Hover highlight ---
  let hoveredEl$1 = null;

  function onMove$2(e) {
    if (!activeMode$1) return;
    const el = e.target;
    if (isInspectorUI(el) || el === document.body || el === document.documentElement) {
      clearHoverHighlight$1();
      return;
    }
    if (el === hoveredEl$1) return;
    clearHoverHighlight$1();
    if (selected.find(s => s.el === el)) return;
    hoveredEl$1 = el;
    hoveredEl$1._smHoverOutline = hoveredEl$1.style.outline;
    hoveredEl$1._smHoverBg = hoveredEl$1.style.backgroundColor;
    hoveredEl$1.style.outline = '2px solid rgba(236,72,153,0.5)';
    hoveredEl$1.style.backgroundColor = 'rgba(236,72,153,0.04)';
  }

  function clearHoverHighlight$1() {
    if (hoveredEl$1) {
      hoveredEl$1.style.outline = hoveredEl$1._smHoverOutline || '';
      hoveredEl$1.style.backgroundColor = hoveredEl$1._smHoverBg || '';
      delete hoveredEl$1._smHoverOutline;
      delete hoveredEl$1._smHoverBg;
      hoveredEl$1 = null;
    }
  }

  // --- Click handler ---
  function onClick$2(e) {
    if (!activeMode$1) return;
    const el = e.target;
    if (isInspectorUI(el)) return;
    if (el.closest && el.closest('.copy-box')) return;

    const alreadySelected = selected.find(s => s.el === el || s.el.contains(el));
    if (alreadySelected && alreadySelected.madeEditable) {
      e.stopPropagation();
      return;
    }

    e.preventDefault();
    e.stopPropagation();
    clearHoverHighlight$1();
    selectElement(el, e.shiftKey);
  }

  var styleModifier = {
    id: 'style-modifier',
    label: 'Design',
    enabledByDefault: true,

    button: {
      icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="#fff"><path d="M12 22C6.49 22 2 17.51 2 12S6.49 2 12 2s10 4.04 10 9c0 3.31-2.69 6-6 6h-1.77c-.28 0-.5.22-.5.5 0 .12.05.23.13.33.41.47.64 1.06.64 1.67A2.5 2.5 0 0112 22zm0-18c-4.41 0-8 3.59-8 8s3.59 8 8 8c.28 0 .5-.22.5-.5a.54.54 0 00-.14-.35c-.41-.46-.63-1.05-.63-1.65a2.5 2.5 0 012.5-2.5H16c2.21 0 4-1.79 4-4 0-3.86-3.59-7-8-7z"/><circle cx="6.5" cy="11.5" r="1.5"/><circle cx="9.5" cy="7.5" r="1.5"/><circle cx="14.5" cy="7.5" r="1.5"/><circle cx="17.5" cy="11.5" r="1.5"/></svg>',
      tooltip: 'Design',
      color: '#ec4899',
      order: 35,
    },

    shortcuts: [],

    init() {
      document.addEventListener('click', onClick$2, true);
      document.addEventListener('mousemove', onMove$2, true);
    },

    activate() {
      loadTailwind();
      activeMode$1 = true;
      state.styleModActive = true;
      showToast('Design — click to style, shift+click multi-select');
    },

    deactivate() {
      activeMode$1 = false;
      state.styleModActive = false;
      clearHoverHighlight$1();
      clearSelection();
    },

    toggle() {
      if (activeMode$1) { this.deactivate(); return false; }
      else { this.activate(); return true; }
    },

    enable() {},
    disable() { this.deactivate(); },
  };

  // --- Annotation store ---
  let annotations = []; // { id, el, selector, note, originalClasses, labelEl }
  let nextId = 1;
  let activeMode = false;
  let activeAnnotation = null; // currently editing

  function getAnnotations() { return annotations; }

  // --- Label anchored to element ---
  function createLabel(annotation, num) {
    const label = document.createElement('div');
    label.textContent = num;
    Object.assign(label.style, {
      position: 'absolute', top: '-4px', right: '-4px',
      width: '18px', height: '18px', borderRadius: '50%',
      background: '#f59e0b', color: '#000', fontSize: '10px', fontWeight: '700',
      fontFamily: 'system-ui, sans-serif',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      cursor: 'pointer', zIndex: String(Z.badge),
      boxShadow: '0 1px 4px rgba(0,0,0,0.3)', pointerEvents: 'auto',
      transition: 'transform 0.1s'
    });

    // Ensure element can hold absolute children
    const pos = getComputedStyle(annotation.el).position;
    if (pos === 'static') annotation.el.style.position = 'relative';

    label.addEventListener('mouseenter', () => { label.style.transform = 'scale(1.2)'; });
    label.addEventListener('mouseleave', () => { label.style.transform = 'scale(1)'; });
    label.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      openAnnotation(annotation);
    });

    annotation.el.appendChild(label);
    inspectorUI.add(label);
    return label;
  }

  function renumberLabels() {
    annotations.forEach((ann, i) => {
      if (ann.labelEl) ann.labelEl.textContent = i + 1;
    });
  }

  // --- Open annotation editor in rail panel ---
  function openAnnotation(annotation) {
    activeAnnotation = annotation;
    const container = document.createElement('div');

    // Header: element info
    const header = document.createElement('div');
    Object.assign(header.style, { marginBottom: '10px', paddingBottom: '8px', borderBottom: '1px solid rgba(255,255,255,0.08)' });
    const tag = document.createElement('div');
    tag.textContent = `<${annotation.el.tagName.toLowerCase()}>`;
    Object.assign(tag.style, { fontSize: '11px', fontWeight: '600', color: '#f59e0b', marginBottom: '2px' });
    const sel = document.createElement('div');
    sel.textContent = annotation.selector;
    Object.assign(sel.style, {
      fontSize: '9px', color: '#888', fontFamily: 'SF Mono, SFMono-Regular, Menlo, monospace',
      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'
    });
    header.appendChild(tag);
    header.appendChild(sel);
    container.appendChild(header);

    // Prose note textarea
    const noteLabel = document.createElement('div');
    noteLabel.textContent = 'NOTE';
    Object.assign(noteLabel.style, { fontSize: '9px', fontWeight: '700', color: '#666', marginBottom: '4px', letterSpacing: '0.5px' });
    container.appendChild(noteLabel);

    const textarea = document.createElement('textarea');
    textarea.value = annotation.note || '';
    textarea.placeholder = 'Describe what you want changed...';
    Object.assign(textarea.style, {
      width: '100%', minHeight: '60px', padding: '8px', borderRadius: '6px',
      border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.05)',
      color: '#fff', fontSize: '12px', fontFamily: 'system-ui, sans-serif',
      resize: 'vertical', outline: 'none', boxSizing: 'border-box', lineHeight: '1.4'
    });
    textarea.addEventListener('input', () => {
      annotation.note = textarea.value;
      updateBadgeCount();
    });
    textarea.addEventListener('mousedown', (e) => e.stopPropagation());
    textarea.addEventListener('keydown', (e) => e.stopPropagation());
    container.appendChild(textarea);

    // Divider
    const divider = document.createElement('div');
    Object.assign(divider.style, { height: '1px', background: 'rgba(255,255,255,0.08)', margin: '12px 0' });
    container.appendChild(divider);

    // Tailwind controls section
    const twLabel = document.createElement('div');
    twLabel.textContent = 'TAILWIND CLASSES';
    Object.assign(twLabel.style, { fontSize: '9px', fontWeight: '700', color: '#666', marginBottom: '8px', letterSpacing: '0.5px' });
    container.appendChild(twLabel);

    const controlsContainer = document.createElement('div');
    container.appendChild(controlsContainer);

    // Render Tailwind design controls for this annotation's element
    const elements = [{ el: annotation.el, originalClasses: annotation.originalClasses }];
    renderDesignControls(controlsContainer, elements, () => {
      updateBadgeCount();
    });

    // Delete annotation button
    const deleteSection = document.createElement('div');
    Object.assign(deleteSection.style, { marginTop: '14px', paddingTop: '10px', borderTop: '1px solid rgba(255,255,255,0.08)' });
    const deleteBtn = document.createElement('button');
    deleteBtn.textContent = 'Remove Annotation';
    Object.assign(deleteBtn.style, {
      background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.3)',
      color: '#ef4444', padding: '5px 12px', borderRadius: '4px',
      fontSize: '10px', fontWeight: '600', cursor: 'pointer', width: '100%'
    });
    deleteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      removeAnnotation(annotation);
    });
    deleteSection.appendChild(deleteBtn);
    container.appendChild(deleteSection);

    showRailPanel(container);

    // Highlight the annotated element
    annotation.el.style.outline = '2px solid #f59e0b';
  }

  function removeAnnotation(annotation) {
    // Remove label from DOM
    if (annotation.labelEl) {
      annotation.labelEl.remove();
    }
    // Restore element state
    annotation.el.style.outline = '';
    annotation.el.className = annotation.originalClasses;

    // Remove from store
    const idx = annotations.indexOf(annotation);
    if (idx !== -1) annotations.splice(idx, 1);

    renumberLabels();
    updateBadgeCount();
    activeAnnotation = null;
    hideRailPanel();
    showToast('Annotation removed');
  }

  function updateBadgeCount() {
    const count = annotations.filter(a => {
      const hasNote = a.note && a.note.trim().length > 0;
      const hasClassChanges = a.el.className !== a.originalClasses;
      return hasNote || hasClassChanges;
    }).length;
    updateCopyBadge(count);
  }

  // --- Hover highlight ---
  let hoveredEl = null;

  function onMove$1(e) {
    if (!activeMode) return;
    const el = e.target;
    if (isInspectorUI(el) || el === document.body || el === document.documentElement) {
      clearHoverHighlight();
      return;
    }
    if (el === hoveredEl) return;
    clearHoverHighlight();
    hoveredEl = el;
    hoveredEl._annHoverOutline = hoveredEl.style.outline;
    hoveredEl.style.outline = '2px solid rgba(245,158,11,0.5)';
  }

  function clearHoverHighlight() {
    if (hoveredEl) {
      hoveredEl.style.outline = hoveredEl._annHoverOutline || '';
      delete hoveredEl._annHoverOutline;
      hoveredEl = null;
    }
  }

  // --- Click handler ---
  function onClick$1(e) {
    if (!activeMode) return;
    const el = e.target;
    if (isInspectorUI(el)) return;

    e.preventDefault();
    e.stopPropagation();
    clearHoverHighlight();

    // If element already has an annotation, open it
    const existing = annotations.find(a => a.el === el);
    if (existing) {
      openAnnotation(existing);
      return;
    }

    // Create new annotation
    const annotation = {
      id: nextId++,
      el,
      selector: getSelector(el),
      note: '',
      originalClasses: el.className,
      labelEl: null
    };

    annotations.push(annotation);
    annotation.labelEl = createLabel(annotation, annotations.length);
    openAnnotation(annotation);
    updateBadgeCount();
  }

  var annotations$1 = {
    id: 'annotations',
    label: 'Annotate',
    enabledByDefault: true,

    button: {
      icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="#fff"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H5.17L4 17.17V4h16v12z"/></svg>',
      tooltip: 'Annotate',
      color: '#f59e0b',
      order: 25,
    },

    shortcuts: [],

    init() {
      document.addEventListener('click', onClick$1, true);
      document.addEventListener('mousemove', onMove$1, true);
    },

    activate() {
      loadTailwind();
      activeMode = true;
      showToast('Annotate — click elements to add notes + class changes');
    },

    deactivate() {
      activeMode = false;
      clearHoverHighlight();
      if (activeAnnotation) {
        activeAnnotation.el.style.outline = '';
        activeAnnotation = null;
      }
      hideRailPanel();
    },

    toggle() {
      if (activeMode) { this.deactivate(); return false; }
      else { this.activate(); return true; }
    },

    enable() {},
    disable() { this.deactivate(); },
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

    // From annotations
    const annotations = getAnnotations();
    annotations.forEach(ann => {
      annotatedEls.add(ann.el);
      const { added, removed } = getClassDiff(ann.el, ann.originalClasses);
      const hasNote = ann.note && ann.note.trim().length > 0;
      const hasChanges = added.length > 0 || removed.length > 0;

      if (!hasNote && !hasChanges) return;

      let section = `### ${ann.selector}`;
      if (hasNote) section += `\nNote: "${ann.note.trim()}"`;
      if (hasChanges) {
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
      btn.addEventListener('mouseenter', () => { btn.style.background = 'rgba(255,255,255,0.08)'; });
      btn.addEventListener('mouseleave', () => { btn.style.background = 'transparent'; });
    }
  }

  // Slot indicator line (created in init)
  let slotLine = null;

  function getSlotType(el, mouseX, mouseY) {
    const rect = el.getBoundingClientRect();
    const relX = (mouseX - rect.left) / rect.width;
    const relY = (mouseY - rect.top) / rect.height;
    const edge = 0.25;
    const inXCenter = relX >= edge && relX <= (1 - edge);
    const inYCenter = relY >= edge && relY <= (1 - edge);
    if (inXCenter && inYCenter) return 'inside';
    const dTop = relY, dBottom = 1 - relY, dLeft = relX, dRight = 1 - relX;
    const min = Math.min(dTop, dBottom, dLeft, dRight);
    if (min === dTop) return 'before';
    if (min === dBottom) return 'after';
    if (min === dLeft) return 'left';
    return 'right';
  }

  function updateSlotLine(el, type) {
    const rect = el.getBoundingClientRect();
    if (type === 'inside') { slotLine.style.display = 'none'; return; }
    if (type === 'before' || type === 'after') {
      const y = type === 'before' ? rect.top : rect.bottom;
      Object.assign(slotLine.style, { display: 'block', top: (y - 1) + 'px', left: rect.left + 'px', width: rect.width + 'px', height: '3px' });
    } else {
      const x = type === 'left' ? rect.left : rect.right;
      Object.assign(slotLine.style, { display: 'block', top: rect.top + 'px', left: (x - 1) + 'px', width: '3px', height: rect.height + 'px' });
    }
  }

  function getSlotDescription(el, type) {
    const sel = getSelector(el);
    const text = el.textContent.trim().substring(0, 60);
    const textPreview = text ? ' | "' + text + (el.textContent.trim().length > 60 ? '...' : '') + '"' : '';
    if (type === 'before') return 'Insert before: ' + sel + textPreview;
    if (type === 'after') return 'Insert after: ' + sel + textPreview;
    if (type === 'left') return 'Insert to the left of: ' + sel + textPreview;
    if (type === 'right') return 'Insert to the right of: ' + sel + textPreview;
    return 'Insert inside: ' + sel + ' (as child)' + textPreview;
  }

  function onMove(e) {
    if (!state.active || state.editMode || state.cameraMode || state.annotateMode || state.styleModActive) return;
    const el = e.target;
    if (isInspectorUI(el) || el === document.body || el === document.documentElement) return;
    if (el.closest && el.closest('.copy-box')) { clearHover(); return; }
    if (state.hovered && state.hovered !== el) clearHover();
    if (el !== state.hovered) {
      el._origOutline = el._origOutline ?? el.style.outline;
      el._origBg = el._origBg ?? el.style.backgroundColor;
    }
    if (state.altHeld) {
      state.slotType = getSlotType(el, e.clientX, e.clientY);
      el.style.outline = SLOT_OUTLINE;
      el.style.backgroundColor = state.slotType === 'inside' ? SLOT_BG : (el._origBg || '');
      updateSlotLine(el, state.slotType);
    } else {
      slotLine.style.display = 'none';
      el.style.outline = OUTLINE;
      el.style.backgroundColor = BG;
    }
    state.hovered = el;
  }

  function onClick(e) {
    if ((!state.active && !state.annotateMode) || state.editMode || state.styleModActive) return;
    const el = e.target;
    if (isInspectorUI(el)) return;
    if (el.closest && el.closest('.copy-box')) return;

    if (state.annotateMode) return;
    if (state.cameraMode) return;

    e.preventDefault();
    e.stopPropagation();
    nudge(el);

    if (e.altKey && state.slotType) {
      const slotDesc = getSlotDescription(el, state.slotType);
      slotLine.style.display = 'none';
      navigator.clipboard.writeText(slotDesc).then(() => {
        showToast('Slot copied: ' + slotDesc);
      }).catch(() => showToast(slotDesc));
    } else if (e.shiftKey) {
      const desc = getContext(el);
      const idx = state.selected.findIndex(s => s.el === el);
      if (idx !== -1) {
        el.style.outline = el._origOutline || '';
        el.style.backgroundColor = el._origBg || '';
        if (state.selected[idx].badge) state.selected[idx].badge.remove();
        state.selected.splice(idx, 1);
        refreshBadges();
      } else {
        el.style.outline = SEL_OUTLINE;
        el.style.backgroundColor = SEL_BG;
        const badge = addBadge(el, state.selected.length + 1);
        state.selected.push({ el, desc, badge });
      }
      if (state.selected.length) {
        const combined = state.selected.map((s, i) => `[${i + 1}] ${s.desc}`).join('\n');
        navigator.clipboard.writeText(combined).then(() => {
          showToast(`Copied ${state.selected.length} selection${state.selected.length > 1 ? 's' : ''}`);
        }).catch(() => showToast(combined));
      } else {
        showToast('Selection cleared');
      }
    } else {
      const desc = getContext(el);
      clearSelection$1();
      navigator.clipboard.writeText(desc).then(() => {
        showToast('Copied: ' + desc);
      }).catch(() => showToast(desc));
    }
  }

  var selector = {
    id: 'selector',
    label: 'Selector',
    enabledByDefault: true,

    button: {
      icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="#fff"><path d="M21 3L3 10.53v.98l6.84 2.65L12.48 21h.98L21 3z"/></svg>',
      tooltip: 'Selector',
      color: '#0066ff',
      order: 5,
    },

    shortcuts: [
      { key: 'K', meta: true, shift: true, action: 'toggle' }
    ],

    init() {
      slotLine = document.createElement('div');
      Object.assign(slotLine.style, {
        position: 'fixed', left: '0', top: '0', height: '3px', width: '0',
        background: '#00a651', zIndex: String(Z.tooltip), pointerEvents: 'none',
        display: 'none', borderRadius: '2px',
        boxShadow: '0 0 6px rgba(0, 166, 81, 0.5)'
      });
      document.body.appendChild(slotLine);
      inspectorUI.add(slotLine);

      document.addEventListener('mousemove', onMove, true);
      document.addEventListener('mouseleave', clearHover, true);
      document.addEventListener('click', onClick, true);
      document.addEventListener('mousedown', (e) => {
        if (!state.active) return;
        if (e.shiftKey || e.altKey) e.preventDefault();
      }, true);
    },

    activate() {
      state.active = true;
      document.body.style.cursor = 'crosshair';
      showToast('Inspector ON — click to copy, Shift multi-select, Alt for slots');
    },

    deactivate() {
      state.active = false;
      clearHover();
      clearSelection$1();
      slotLine.style.display = 'none';
    },

    toggle() {
      if (state.active && true && !state.cameraMode) {
        this.deactivate();
        document.body.style.cursor = 'crosshair';
        showToast('Inspector OFF');
        return false;
      } else {
        this.activate();
        return true;
      }
    },

    enable() {},
    disable() { this.deactivate(); },
  };

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
        clearHover();
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
            clearHover();
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
   * DOM-Tools
   * Drop <script src="dom-tools.js"></script> before </body> in any HTML file.
   * Activate by adding ?dom-tools to the page URL.
   * Toggle: click the floating button or press Cmd+Shift+K (Ctrl+Shift+K on Windows/Linux).
   */


  // Only activate when ?dom-tools is present in the URL
  if (new URLSearchParams(window.location.search).has('dom-tools')) {
    initHelpers();

    register(annotations$1);
    register(draw);
    register(styleModifier);
    register(camera);
    register(selector);

    renderRail();
    initSettings();
    boot();
    initCopyAll();
    initKeyboard();

    // ?dom-tools=design launches directly into Design mode
    const mode = new URLSearchParams(window.location.search).get('dom-tools');
    if (mode === 'design') {
      styleModifier.activate();
      setActiveButton('style-modifier');
    } else if (mode === 'annotate') {
      annotations$1.activate();
      setActiveButton('annotations');
    } else {
      selector.activate();
    }
  }

})();
