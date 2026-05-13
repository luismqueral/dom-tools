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

  // Register a module after boot (for plugins loaded late).
  // Calls init() immediately and notifies toolbar to add button.
  let _lateCallback = null;
  function onLateRegister(fn) { _lateCallback = fn; }

  function registerLate(mod, api) {
    modules.push(mod);
    if (isEnabled(mod.id) && mod.init) mod.init(api);
    if (_lateCallback) _lateCallback(mod);
  }

  const state = {
    active: true,
    enabled: true,     // global DOM-Tools on/off (toggled via double-Esc)
    hovered: null,
    selected: [],      // {el, desc, badge}[]
    altHeld: false,
    slotType: null,    // 'before' | 'after' | 'left' | 'right' | 'inside'
    editMode: false,
    cameraMode: false,
    annotateMode: false,
    annotateSub: 'sticky', // 'pen' | 'sticky'
    stickyMode: false,
    styleModActive: false,
    handToolActive: false,
  };

  // Set of all inspector UI elements (ignored by hover/click)
  const inspectorUI = new Set();

  // Colors
  const COLORS = {
    selector: '#0066ff',
    edit: '#e67e00',
    camera: '#cc3300',
    annotate: '#7c3aed',
    stickyBg: '#fef08a',
    stickyBorder: '#facc15',
    pen: '#dc2626',
  };

  '2px solid ' + COLORS.selector;
  const SEL_OUTLINE = '2px solid ' + COLORS.selector;
  const SEL_BG = 'rgba(0, 102, 255, 0.12)';
  const CAM_OUTLINE = '2px solid ' + COLORS.camera;
  const CAM_BG = 'rgba(204, 51, 0, 0.06)';

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

  }

  // Bounce animation used to confirm "we just did a thing" on an
  // element (right-click copy, click-to-select, etc). Implemented via
  // the Web Animations API rather than a CSS class — adding/removing a
  // class would (and used to) pollute getSelector() output and the
  // originalClasses snapshot that copy-all uses to compute class
  // diffs. Web Animations API doesn't touch className or inline style,
  // so the user-visible effect is the same and the selectors stay clean.
  function nudge(el) {
    if (!el || typeof el.animate !== 'function') return;
    el.animate(
      [
        { transform: 'translateY(0)' },
        { transform: 'translateY(3px)', offset: 0.3 },
        { transform: 'translateY(0)' },
      ],
      { duration: 200, easing: 'ease-out' }
    );
  }

  // --- Flash screen ---
  function flashElement$1(el) {
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

  // --- Clipboard ---
  // navigator.clipboard.writeText is the modern path but it rejects in
  // several real-world cases: insecure context (http://, file://), pages
  // that block the clipboard via Permissions-Policy, or some browsers
  // when the document isn't focused. Fall back to a hidden textarea +
  // document.execCommand('copy') so right-click on a plain http page
  // still works. Returns true on success.
  async function copyText(text) {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch (_) { /* fall through to legacy path */ }

    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      Object.assign(ta.style, {
        position: 'fixed',
        top: '0',
        left: '-9999px',
        opacity: '0',
        pointerEvents: 'none',
      });
      document.body.appendChild(ta);
      const prevActive = document.activeElement;
      ta.select();
      ta.setSelectionRange(0, ta.value.length);
      const ok = document.execCommand && document.execCommand('copy');
      document.body.removeChild(ta);
      if (prevActive && typeof prevActive.focus === 'function') {
        try { prevActive.focus(); } catch (_) {}
      }
      return !!ok;
    } catch (_) {
      return false;
    }
  }

  // --- Selector utilities ---
  // Build a CSS selector that's actually findable on the page. Strategy:
  //   1. If the element has an id, '#id' wins (and we stop).
  //   2. Walk up the DOM, building each segment as tag(.class)* and only
  //      adding :nth-of-type(N) when the parent has more than one same-tag
  //      child (otherwise the segment is already unique among siblings).
  //   3. Stop the moment we hit an ancestor with an id — that anchors the
  //      whole selector and there's no point walking further up.
  //   4. Skip <html> / <body>; they're implicit in any selector that
  //      reaches them and only add noise.
  function describeSegment(el) {
    let seg = el.tagName.toLowerCase();
    if (el.classList && el.classList.length) {
      // Up to two classes — enough for human readability without dragging
      // along a wall of utility classes (tw-, css module hashes, etc.).
      seg += '.' + Array.from(el.classList).slice(0, 2).join('.');
    }
    const parent = el.parentElement;
    if (parent) {
      const sameTag = Array.from(parent.children).filter(c => c.tagName === el.tagName);
      if (sameTag.length > 1) {
        seg += `:nth-of-type(${sameTag.indexOf(el) + 1})`;
      }
    }
    return seg;
  }

  function getSelector(el) {
    if (!el || el.nodeType !== 1) return '';
    if (el.id) return '#' + el.id;
    const path = [];
    let cur = el;
    while (cur && cur !== document.body && cur !== document.documentElement) {
      if (cur.id) {
        path.unshift('#' + cur.id);
        break;
      }
      path.unshift(describeSegment(cur));
      cur = cur.parentElement;
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

  // Elements dom-tools should leave alone. Two ways in:
  //   - inspectorUI Set: every internal widget (toolbar, bubble,
  //     toast…) is added programmatically.
  //   - data-dt-ignore attribute: pages embedding dom-tools can opt
  //     specific UI out (e.g. an install/Copy button on the demo page)
  //     without coordinating with the inspector's runtime state.
  // Either match anywhere up the ancestor chain wins.
  function isInspectorUI(el) {
    let node = el;
    while (node) {
      if (inspectorUI.has(node)) return true;
      if (node.nodeType === 1 && node.hasAttribute && node.hasAttribute('data-dt-ignore')) return true;
      // The canvas wrapper is a structural container — not selectable itself,
      // but its children are normal page content (don't propagate further).
      if (node.id === 'dt-canvas-wrapper' && node === el) return true;
      node = node.parentElement;
    }
    return false;
  }

  function clearHover$2() {
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
   * Selection color — single source of truth for the brand color that
   * drives selection borders, hover highlights, the persistent bubble
   * background, and the at-rest annotation scrim. Persisted to
   * localStorage so the user's choice survives reloads.
   *
   * Tools subscribe via onColorChange to repaint live UI when the color
   * is swapped from settings.
   */

  const KEY = 'dom-tools-selection-color';
  const DEFAULT = '#3b82f6'; // blue

  const COLOR_OPTIONS = [
    { id: 'blue',   value: '#3b82f6', label: 'Blue' },
    { id: 'pink',   value: '#ec4899', label: 'Pink' },
    { id: 'purple', value: '#a855f7', label: 'Purple' },
    { id: 'green',  value: '#10b981', label: 'Green' },
    { id: 'orange', value: '#f97316', label: 'Orange' },
  ];

  let current = DEFAULT;
  try {
    const stored = localStorage.getItem(KEY);
    if (stored && COLOR_OPTIONS.some(o => o.value === stored)) current = stored;
  } catch (e) {}

  const subscribers = new Set();

  function getSelectionColor() { return current; }

  // Hex → rgba helper. Tolerant of leading "#" and 3- or 6-digit hex.
  function withAlpha(hex, alpha) {
    let h = (hex || '').replace('#', '');
    if (h.length === 3) h = h.split('').map(c => c + c).join('');
    const r = parseInt(h.substring(0, 2), 16) || 0;
    const g = parseInt(h.substring(2, 4), 16) || 0;
    const b = parseInt(h.substring(4, 6), 16) || 0;
    return `rgba(${r},${g},${b},${alpha})`;
  }

  // CSS custom properties on :root so any injected stylesheet can pull
  // the live theme color without subscribing imperatively. Also keeps
  // the alpha variants (soft / scrim / faint) in sync, so things like
  // ::selection or the snap indicator can reference them directly.
  function syncCssVars(hex) {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    root.style.setProperty('--dt-color', hex);
    root.style.setProperty('--dt-color-soft',  withAlpha(hex, 0.4));
    root.style.setProperty('--dt-color-scrim', withAlpha(hex, 0.22));
    root.style.setProperty('--dt-color-faint', withAlpha(hex, 0.15));
    root.style.setProperty('--dt-color-mist',  withAlpha(hex, 0.10));
  }
  syncCssVars(current);

  function setSelectionColor(hex) {
    current = hex;
    try { localStorage.setItem(KEY, hex); } catch (e) {}
    syncCssVars(hex);
    subscribers.forEach(fn => { try { fn(hex); } catch (_) {} });
  }

  function onColorChange(fn) {
    subscribers.add(fn);
    return () => subscribers.delete(fn);
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
        if (stayed) {
          // Activating this tool — make sure no other tool is also live.
          // Tools have independent mode flags that their handlers check,
          // and without this they'd both fire on every click.
          getModules().forEach(m => {
            if (m.id !== mod.id && m.deactivate) m.deactivate();
          });
          setActiveButton(mod.id);
        } else {
          activateHome$1();
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

  function activateHome$1() {
    // activateModule deactivates all other tools and activates the home —
    // this is what guarantees only one tool's handlers run at a time.
    activateModule('style-modifier');
    setActiveButton('style-modifier');
  }

  function setActiveButton(activeId) {
    buttonMap.forEach((btn, id) => {
      const mod = getModules().find(m => m.id === id);
      if (id === activeId && mod && mod.button) btn.style.background = mod.button.color;
      else btn.style.background = '#222';
    });
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
      background: 'var(--dt-color)', color: '#fff', borderRadius: '7px', fontSize: '9px',
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
  function appendButton(mod) {
    if (!mod.button || !isEnabled(mod.id)) return;
    const btn = createButton(mod);
    if (copyBtn) toolbar.insertBefore(btn, copyBtn);
    else toolbar.appendChild(btn);
    inspectorUI.add(btn);
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

  const EXP_KEY = 'dom-tools-experiments';
  let experiments = {};
  try { experiments = JSON.parse(localStorage.getItem(EXP_KEY) || '{}'); } catch (e) {}

  const EXPERIMENT_DEFS = [
    { id: 'dock', label: 'Edge snap', description: 'Drag the toolbar near a screen edge to dock it.', default: true },
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
      default: true,
    },
  ];

  function isExperimentEnabled(id) {
    const def = EXPERIMENT_DEFS.find(e => e.id === id);
    if (id in experiments) return experiments[id];
    return def ? def.default : false;
  }

  function getExperimentOption(id, optionId) {
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

  function toggleSettings() {
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

  function closeSettings() {
    if (visible) {
      visible = false;
      hidePopover();
      if (_settingsBtn) _settingsBtn.style.background = '#222';
      activateModule('style-modifier');
      setActiveButton('style-modifier');
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

    // Live theme: keep the gear's "active" background in sync if the
    // user changes color while the popover is open.
    onColorChange((color) => {
      if (visible && _settingsBtn) _settingsBtn.style.background = color;
    });
  }

  /**
   * Pixelfraktur — small woff2 inlined as base64 so the bundle ships
   * with the font and works regardless of where dom-tools is hosted
   * (no relative path / CDN concerns). Used for the multi-select tag
   * labels in Comment mode.
   *
   * Source: ~/projects/studio-queral/public/fonts/pixelfraktur.woff2
   */


  // IBM Plex Mono via Google Fonts. We load it from the CDN (one
  // stylesheet + one woff2 ~30KB) instead of inlining as base64 because
  // the file is too big to bake into the bundle without bloat. Falls
  // back to the system mono stack while loading.
  function ensurePlexMono() {
    if (document.getElementById('dt-plex-mono')) return;
    const pre1 = document.createElement('link');
    pre1.rel = 'preconnect';
    pre1.href = 'https://fonts.googleapis.com';
    const pre2 = document.createElement('link');
    pre2.rel = 'preconnect';
    pre2.href = 'https://fonts.gstatic.com';
    pre2.crossOrigin = 'anonymous';
    const link = document.createElement('link');
    link.id = 'dt-plex-mono';
    link.rel = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@500&display=swap';
    document.head.append(pre1, pre2, link);
  }

  /**
   * Select tool — point-and-click element selection for leaving feedback.
   *
   * Click an element to select it; the note bubble that appears IS the
   * editor — type directly into it. Shift+click another element to add
   * it to the current selection (group annotation). Each selected element
   * gets its own outlined highlight while the group is active.
   *
   * This tool is read-only as far as page text is concerned — inline text
   * editing is exclusively the Edit Text tool's job.
   */



  let activeMode$1 = false;
  let selected = [];

  function getSelected() { return selected; }

  // --- One-time stylesheet: kills native text selection page-wide while
  //     Comment mode is active so click-drag doesn't grab text instead of
  //     dropping a comment. The bubble (and any element made
  //     contentEditable for inline text editing) re-enables selection so
  //     typing/editing still works. ---
  function ensureSelectionStyles() {
    if (document.getElementById('dt-comment-styles')) return;
    const inspectorUiSelector = ':where(' + [
      '[data-dt-toolbar]', '[data-dt-toolbar] *',
      '[data-dt-bubble]', '[data-dt-bubble] *',
      '[data-dt-tag-label]',
      '[data-dt-settings]', '[data-dt-settings] *',
    ].join(', ') + ')';
    const style = document.createElement('style');
    style.id = 'dt-comment-styles';
    style.textContent = `
    html.dt-comment-active body,
    html.dt-comment-active body *:not(${inspectorUiSelector}) {
      user-select: none !important;
      -webkit-user-select: none !important;
      cursor: pointer !important;
    }
    html.dt-comment-active [data-dt-allow-select],
    html.dt-comment-active [data-dt-allow-select] * {
      user-select: text !important;
      -webkit-user-select: text !important;
      cursor: text !important;
    }
    html.dt-comment-active.dt-inline-editing body *:not([data-dt-allow-select]):not([data-dt-allow-select] *) {
      cursor: default !important;
    }
    html.dt-comment-active [data-dt-bubble] textarea {
      cursor: text !important;
    }
    html.dt-comment-active [data-dt-bubble] [aria-label="Drag to move"] {
      cursor: grab !important;
    }
    [data-dt-bubble] textarea::selection,
    [data-dt-bubble] textarea::-moz-selection,
    html.dt-comment-active ::selection {
      background: var(--dt-color-scrim);
      color: inherit;
    }
  `;
    document.head.appendChild(style);
  }

  // --- Visual state --------------------------------------------------------
  // Border for currently selected elements; otherwise the shared annotations
  // module decides whether to apply the at-rest pink scrim (annotated) or
  // restore the original outline+background (clean).
  function applyOutline(el) {
    if (selected.some(s => s.el === el)) {
      el.style.outline = '2px solid ' + getSelectionColor();
      // Selection wins over scrim — drop the annotation tint while active.
      el.style.backgroundColor = getOrigBackground(el);
    } else {
      applyAnnotationStyle(el);
    }
  }

  // --- Selection -----------------------------------------------------------
  // Selection is purely visual + annotation-bound. We never mutate the
  // element's editability here — that lives in the Edit Text tool. Keeping
  // originalClasses lets copy-all surface live class diffs even before
  // the user deselects.
  function buildEntry(el) {
    ensureOrig(el);
    return { el, originalClasses: el.className };
  }

  function teardownEntry(_s) {
    // Nothing to tear down — Comment mode never flips contentEditable.
  }

  function deselectAll() {
    const old = selected;
    selected = [];
    old.forEach(teardownEntry);
    old.forEach(s => applyOutline(s.el));
  }

  // Push the current selection through to the annotations editor. Called
  // after every selection mutation so the active editor's els (and any
  // transient/persistent annotation behind it) always match what's
  // visually selected.
  function syncEditor() {
    if (selected.length) {
      setEditorTarget(selected.map(s => s.el));
    } else {
      closeEditor();
    }
    refreshTagLabels();
  }

  // --- Tag labels ---------------------------------------------------------
  // A small "div.card" / "h1.hero" pill is shown for every element the
  // user is currently engaged with — hovered, selected, or being
  // text-edited. Two fonts in rotation:
  //   - Headings (h1–h6) get Pixelfraktur — a touch of "old-book-style"
  //     identity so heading hover/select reads like a real heading.
  //   - Everything else gets IBM Plex Mono — clean monospace for tags,
  //     ids, classes.
  // Labels are absolute-positioned siblings of <body> and live in
  // inspectorUI so our own click/hover handlers ignore them.

  const tagLabels = new Map(); // el → { lbl, flipped }

  function elementLabelText(el) {
    const tag = el.tagName.toLowerCase();
    if (el.id) return `${tag}#${el.id}`;
    if (el.classList && el.classList.length) return `${tag}.${el.classList[0]}`;
    return tag;
  }

  function createTagLabel(el) {
    const lbl = document.createElement('div');
    lbl.setAttribute('data-dt-tag-label', '');
    Object.assign(lbl.style, {
      position: 'absolute',
      background: getSelectionColor(),
      color: '#fff',
      fontFamily: '"IBM Plex Mono", ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace',
      fontSize: '9px',
      fontWeight: '500',
      padding: '1px 4px',
      borderRadius: '2px',
      pointerEvents: 'none',
      zIndex: String(Z.badge - 2),
      whiteSpace: 'nowrap',
      transition: 'top 0.12s ease, opacity 0.12s ease',
      opacity: '1',
      letterSpacing: '0.2px',
      boxShadow: '0 1px 2px rgba(0,0,0,0.18)',
      userSelect: 'none',
      WebkitUserSelect: 'none',
    });
    document.body.appendChild(lbl);
    inspectorUI.add(lbl);
    return lbl;
  }

  // Position the label just above the element's top-left corner —
  // always OUTSIDE the element bounds so the label never overlaps page
  // content. flipped=true flips to just below the bottom-left (cursor
  // avoidance, sticky once flipped — see avoidLabelsUnderCursor).
  function positionTagLabel(lbl, el, flipped) {
    const r = el.getBoundingClientRect();
    const labelH = lbl.offsetHeight || 14;
    const left = r.left + window.scrollX;
    const top = flipped
      ? r.top + window.scrollY + r.height + 2  // outside below
      : r.top + window.scrollY - labelH - 2;   // outside above
    lbl.style.left = left + 'px';
    lbl.style.top = top + 'px';
  }

  function removeTagLabel(el) {
    const entry = tagLabels.get(el);
    if (!entry) return;
    inspectorUI.delete(entry.lbl);
    entry.lbl.remove();
    tagLabels.delete(el);
  }

  function hideTagLabels() {
    Array.from(tagLabels.keys()).forEach(removeTagLabel);
  }

  // Compute the set of elements that should currently be labeled —
  // anything the user is actively engaged with: the hovered element,
  // every selected element (group or single), and every element being
  // text-edited. Text-tag elements are included too (p, h1, span, …)
  // so every kind of element you can touch surfaces its tag.
  function desiredLabelEls() {
    const set = new Set();
    if (hoveredEl$1) set.add(hoveredEl$1);
    selected.forEach(s => set.add(s.el));
    return set;
  }

  function refreshTagLabels() {
    const want = desiredLabelEls();
    Array.from(tagLabels.keys()).forEach(el => {
      if (!want.has(el)) removeTagLabel(el);
    });
    const color = getSelectionColor();
    want.forEach(el => {
      let entry = tagLabels.get(el);
      if (!entry) {
        entry = { lbl: createTagLabel(), flipped: false };
        tagLabels.set(el, entry);
      }
      entry.lbl.textContent = elementLabelText(el);
      entry.lbl.style.background = color;
      positionTagLabel(entry.lbl, el, entry.flipped);
    });
  }

  function repositionAllTagLabels() {
    tagLabels.forEach((entry, el) => positionTagLabel(entry.lbl, el, entry.flipped));
  }

  // On every mousemove in Comment mode, check whether the cursor is
  // inside any label's bounding rect and shove it out of the way if so.
  // Sticky: once a label has flipped, it stays flipped for the lifetime
  // of the entry. Snapping it back as soon as the cursor cleared the
  // flipped position caused a springy ping-pong, since the cursor would
  // then overlap the original (top) position and trigger another flip.
  // A new label (created next time the element gains a label) starts
  // fresh at flipped=false.
  function avoidLabelsUnderCursor(mx, my) {
    tagLabels.forEach((entry, el) => {
      if (entry.flipped) return;
      const r = entry.lbl.getBoundingClientRect();
      const margin = 6;
      const overlap = mx >= r.left - margin && mx <= r.right + margin &&
                      my >= r.top  - margin && my <= r.bottom + margin;
      if (overlap) {
        entry.flipped = true;
        positionTagLabel(entry.lbl, el, true);
      }
    });
  }

  // Plain click → reset selection to just `el` (or expand to its whole
  // group if it's part of one). Shift+click → toggle `el` in/out of the
  // existing selection (group-annotation mode).
  function selectElement(el, additive) {
    if (additive) {
      const idx = selected.findIndex(s => s.el === el);
      if (idx !== -1) {
        // Toggle off — drop the el from the selection AND from the saved
        // group (when there's still a selection to commit against).
        const removed = selected[idx];
        selected.splice(idx, 1);
        applyOutline(removed.el);
        syncEditor();
        return;
      }
      // Toggle on — extend the group.
      selected.push(buildEntry(el));
      applyOutline(el);
      syncEditor();
      return;
    }

    // Plain click on an element that already belongs to a group annotation
    // re-opens the WHOLE group, not just this one. Otherwise typing would
    // immediately replace the group's annotation with a single-element
    // one and silently strip the note from the other members.
    const ann = findNoteAnnotationByEl(el);
    if (ann) {
      deselectAll();
      ann.els.forEach(groupEl => {
        selected.push(buildEntry(groupEl));
        applyOutline(groupEl);
      });
      syncEditor();
      return;
    }

    deselectAll();
    selected.push(buildEntry(el));
    applyOutline(el);
    syncEditor();
  }

  function clearSelection() {
    deselectAll();
    closeEditor();
  }

  // Public: re-select a previously-saved group from outside (annotation
  // bubble click). Delegates to selectElement which auto-expands to the
  // whole group when the clicked element is a member.
  function focusGroup(els) {
    if (!els || !els.length) return;
    if (!activeMode$1) {
      activateModule('style-modifier');
      setActiveButton('style-modifier');
    }
    selectElement(els[0], false);
    els[0].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  // --- Hover highlight -----------------------------------------------------
  // Two flavors:
  //   - block-ish (containers, images, etc): a soft tinted background +
  //     a barely-there scale-up so the element feels "lifted" before
  //     clicking.
  //   - text (P, H1–H6, SPAN, LI, …): a much lighter background tint
  //     (text is meant to be read, not painted over) + a more visible
  //     scale-up so it pops a touch when hovered.
  // We snapshot transform/transition before modifying so unhover
  // restores the element exactly (covers pages that rely on their own
  // inline transforms).
  let hoveredEl$1 = null;

  function clearHover$1() {
    if (!hoveredEl$1) return;
    applyOutline(hoveredEl$1);
    hoveredEl$1 = null;
    refreshTagLabels();
  }

  function onMove$1(e) {
    if (!activeMode$1) return;
    // Suppress hover while hand tool, inline editing, or modifier key (zoom) is active
    if (state.handToolActive || editingEl || e.metaKey || e.ctrlKey) {
      if (hoveredEl$1) clearHover$1();
      return;
    }
    // Tag labels react to the cursor regardless of which element is
    // currently the hover target — even hovering inside a non-selected
    // child of a labeled selection should still hide the corner pill.
    avoidLabelsUnderCursor(e.clientX, e.clientY);
    const el = e.target;
    if (isInspectorUI(el) || el === document.body || el === document.documentElement) {
      clearHover$1();
      return;
    }
    if (el === hoveredEl$1) return;
    clearHover$1();
    // Don't hover-paint elements that are already selected.
    if (selected.find(s => s.el === el)) return;
    hoveredEl$1 = el;
    ensureOrig(el);

    const color = getSelectionColor();
    el.style.outline = '2.5px solid ' + withAlpha(color, 0.55);
    el.style.backgroundColor = getOrigBackground(el);
    refreshTagLabels();
  }

  // --- Click handler -------------------------------------------------------
  function onClick$1(e) {
    if (!activeMode$1) return;
    if (state.handToolActive) return;
    const el = e.target;
    if (isInspectorUI(el)) return;

    // Don't interfere with inline editing
    if (editingEl && (el === editingEl || editingEl.contains(el))) return;

    if (el === document.body || el === document.documentElement) {
      if (isActiveNoteEmpty() && selected.length) {
        clearSelection();
      }
      return;
    }

    e.preventDefault();
    e.stopPropagation();
    clearHover$1();
    nudge(el);
    setClickOrigin(e.clientX, e.clientY);
    selectElement(el, e.shiftKey);
  }

  // --- Double-click to edit (experiment-gated) -----------------------------
  // Tags that should NOT be made contentEditable (structural/interactive)
  const NON_EDITABLE_TAGS = new Set([
    'HTML','BODY','SCRIPT','STYLE','LINK','META','HEAD',
    'IFRAME','OBJECT','EMBED','VIDEO','AUDIO','CANVAS',
    'INPUT','TEXTAREA','SELECT','BUTTON','FORM',
    'SVG','PATH','IMG','BR','HR',
  ]);

  let editingEl = null;

  function onDblClick(e) {
    if (!activeMode$1) return;
    if (!isExperimentEnabled('dblclick-edit')) return;
    if (state.handToolActive) return;
    const el = e.target;
    if (isInspectorUI(el)) return;
    if (!el || !el.tagName || NON_EDITABLE_TAGS.has(el.tagName)) return;
    if (!el.textContent || !el.textContent.trim()) return;

    e.preventDefault();
    e.stopPropagation();

    // Close the bubble that single-click opened — dblclick means "edit text"
    closeEditor();
    deselectAll();

    // Make element editable inline
    editingEl = el;
    ensureOrig(el);
    const originalText = el.innerText;
    const originalClasses = el.className;
    el.contentEditable = 'true';
    el.spellcheck = false;
    el.setAttribute('data-dt-allow-select', '');

    // Visual feedback — text cursor + highlight
    const color = getSelectionColor();
    el.style.outline = '2px solid ' + color;
    el.style.backgroundColor = withAlpha(color, 0.08);
    el.style.cursor = 'text';
    document.documentElement.classList.add('dt-inline-editing');

    // Focus, select all text, and place caret after a tick (let the bubble close first)
    setTimeout(() => {
      el.focus();
      // Select all text so the user sees what they're editing
      const sel = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(el);
      sel.removeAllRanges();
      sel.addRange(range);
    }, 0);

    // Track text changes for copy-all output (register once on first input,
    // then re-apply our editing outline since setElementText triggers
    // applyAnnotationStyle which would overwrite it).
    function onInput() {
      setElementText(el, originalText, originalClasses);
      // Restore editing visual — applyAnnotationStyle resets outline/bg
      el.style.outline = '2px solid ' + color;
      el.style.backgroundColor = withAlpha(color, 0.08);
    }
    el.addEventListener('input', onInput);

    // Exit edit on blur or Escape
    function exitEdit() {
      el.removeEventListener('blur', exitEdit);
      el.removeEventListener('keydown', onEditKey);
      el.removeEventListener('input', onInput);
      el.contentEditable = 'false';
      el.removeAttribute('data-dt-allow-select');
      el.style.cursor = '';
      document.documentElement.classList.remove('dt-inline-editing');
      editingEl = null;
      evaluateAnnotation(el);
      applyOutline(el);
    }
    function onEditKey(ev) {
      if (ev.key === 'Escape') {
        ev.preventDefault();
        ev.stopPropagation();
        el.blur();
      }
    }
    el.addEventListener('blur', exitEdit);
    el.addEventListener('keydown', onEditKey);
  }

  // --- Module spec ---------------------------------------------------------
  const moduleSpec = {
    id: 'style-modifier',
    label: 'Select',
    enabledByDefault: true,

    button: {
      icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="#fff"><path d="M21 3L3 10.53v.98l6.84 2.65L12.48 21h.98L21 3z"/></svg>',
      tooltip: 'Select (shift+click for group)',
      get color() { return getSelectionColor(); },
      order: 5,
    },

    shortcuts: [],

    init() {
      ensureSelectionStyles();
      ensurePlexMono();
      document.addEventListener('click', onClick$1, true);
      document.addEventListener('dblclick', onDblClick, true);
      document.addEventListener('mousemove', onMove$1, true);
      window.addEventListener('scroll', repositionAllTagLabels, true);
      window.addEventListener('resize', repositionAllTagLabels);

      // Live theme updates: re-paint selected outlines, editable-text
      // backgrounds, tag-label backgrounds, and the toolbar button
      // (when active) so a color swap from settings takes effect
      // everywhere.
      onColorChange((color) => {
        selected.forEach(s => applyOutline(s.el));
        tagLabels.forEach((entry) => { entry.lbl.style.background = color; });
        if (activeMode$1) setActiveButton('style-modifier');
      });
    },

    activate() {
      activeMode$1 = true;
      state.styleModActive = true;
      document.body.style.cursor = '';
      document.documentElement.classList.add('dt-comment-active');
      showToast('Click to select, shift+click to group');
    },

    deactivate() {
      activeMode$1 = false;
      state.styleModActive = false;
      document.body.style.cursor = '';
      document.documentElement.classList.remove('dt-comment-active');
      clearHover$1();
      clearSelection();
      hideTagLabels();
    },

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
   * Two kinds of tracked changes:
   *   1. Note annotations — a single note attached to one or many elements
   *      (a "group"). One note, one bubble. The bubble IS the editor: a
   *      pink rounded box containing a transparent <textarea>. When the
   *      Comment tool selects an element of the group, the textarea
   *      becomes editable and focused; when the selection moves
   *      elsewhere, the textarea goes read-only and the bubble looks
   *      identical to the saved-note state.
   *   2. Text edits — per-element original-text snapshots, no on-page UI;
   *      diffs surface in the copy-all output.
   *
   * Public API for tools (Comment / Edit Text):
   *   setEditorTarget(els)         → make these els the live editor target
   *   closeEditor()                → finalize current editor, drop transient
   *   getElementNote(el)           → '' if untracked, else the group's note
   *   findNoteAnnotationByEl(el)   → the group annotation containing el (or null)
   *   setElementText(el, originalText, originalClasses)
   *   evaluateAnnotation(el)
   *   ensureOrig / applyAnnotationStyle
   *   queueRepositionAll()
   *   getAnnotations()             → unified list for copy-all
   */


  // ---- Style state shared across tools ----
  const ORIG_OUTLINES = new WeakMap();
  const ORIG_BACKGROUNDS = new WeakMap();

  // At-rest tint for elements that have a saved note or text edit. Derived
  // from the live selection color so theme swaps propagate.
  function getScrim() { return withAlpha(getSelectionColor(), 0.15); }
  // Faded scrim used on OTHER annotated elements while a bubble is being
  // hovered — lighter so the hovered note's own elements visually pop.
  function getFadedScrim() { return withAlpha(getSelectionColor(), 0.04); }

  // While a bubble is hovered, this points at its annotation. Other
  // annotated elements switch to the faded scrim so the connection
  // between the hovered note and its own elements stands out.
  let hoveredAnnotation = null;

  function ensureOrig(el) {
    if (!ORIG_OUTLINES.has(el)) ORIG_OUTLINES.set(el, el.style.outline || '');
    if (!ORIG_BACKGROUNDS.has(el)) ORIG_BACKGROUNDS.set(el, el.style.backgroundColor || '');
  }

  function getOrigOutline(el) { return ORIG_OUTLINES.get(el) || ''; }
  function getOrigBackground(el) { return ORIG_BACKGROUNDS.get(el) || ''; }

  function applyAnnotationStyle(el) {
    // Text-mode editing elements are kept naked — skip all styling.
    if (el.hasAttribute('data-dt-text-editing')) return;
    if (isAnnotated(el)) {
      const inHoveredGroup = hoveredAnnotation && hoveredAnnotation.els.includes(el);
      const inActiveGroup = activeAnnotation && activeAnnotation.els.includes(el);
      // Solid border when:
      //   - the element belongs to the note currently being edited
      //     (active state — the border tells you "your typing is going to
      //      these elements"), or
      //   - the user is hovering this annotation's bubble.
      // Otherwise the at-rest scrim alone marks the element.
      if (inHoveredGroup || inActiveGroup) {
        el.style.outline = '2px solid ' + getSelectionColor();
      } else {
        el.style.outline = getOrigOutline(el);
      }
      // If we're in "bubble hover" mode and this element isn't part of
      // the hovered annotation, dim it. Otherwise, normal scrim.
      if (hoveredAnnotation && !inHoveredGroup) {
        el.style.backgroundColor = getFadedScrim();
      } else {
        el.style.backgroundColor = getScrim();
      }
    } else {
      el.style.outline = getOrigOutline(el);
      el.style.backgroundColor = getOrigBackground(el);
    }
  }

  // Repaint every annotated element so the hover state takes effect (or
  // is removed). Cheap because we only touch els we already track.
  function repaintAllAnnotated() {
    noteAnnotations.forEach(a => a.els.forEach(el => applyAnnotationStyle(el)));
    textEdits.forEach((_, el) => applyAnnotationStyle(el));
  }

  function setHoveredAnnotation(annotation) {
    if (hoveredAnnotation === annotation) return;
    hoveredAnnotation = annotation;
    repaintAllAnnotated();
  }

  // ---- Stores ----
  // Note annotations: 1+ elements share one note + one bubble.
  // `transient` annotations exist only while their bubble is the editor;
  // they vanish on closeEditor() if no note text was typed.
  const noteAnnotations = []; // { id, els, selectors, note, primaryEl, bubbleEl, customPosition, transient }
  const textEdits = new Map(); // el → { originalText, originalClasses }

  let nextId = 1;
  let activeAnnotation = null; // the bubble currently in edit mode

  function isAnnotated(el) {
    return findNoteAnnotationByEl(el) !== null || hasTextDiff(el);
  }

  function hasTextDiff(el) {
    const e = textEdits.get(el);
    return e != null && el.innerText !== e.originalText;
  }

  function findNoteAnnotationByEl(el) {
    return noteAnnotations.find(a => a.els.includes(el)) || null;
  }

  // True when the user has the editor open on a note that has no text
  // yet — used by the click router to decide whether a body click
  // should also drop the current selection.
  function isActiveNoteEmpty() {
    if (!activeAnnotation) return false;
    return !activeAnnotation.note || !activeAnnotation.note.trim();
  }

  // ---- One-time stylesheet for placeholder color (white-ish on pink) ----
  function ensureBubbleStyles() {
    if (document.getElementById('dt-bubble-styles')) return;
    const s = document.createElement('style');
    s.id = 'dt-bubble-styles';
    s.textContent = `
    [data-dt-bubble] textarea::placeholder { color: rgba(255, 255, 255, 0.65); }
    [data-dt-bubble] textarea::-webkit-input-placeholder { color: rgba(255, 255, 255, 0.65); }
  `;
    document.head.appendChild(s);
  }

  // ---- Bubble (the unified editor + display) ----
  // Pink rounded card containing a borderless transparent textarea. In
  // edit mode (readOnly=false, focused) the user types; in read mode
  // (readOnly=true) it reads as the saved note. Same DOM, same chrome —
  // the only visible difference is the blinking caret.
  function createBubble(annotation) {
    ensureBubbleStyles();

    const bubble = document.createElement('div');
    bubble.setAttribute('data-dt-bubble', '');
    bubble.setAttribute('data-dt-allow-select', '');
    Object.assign(bubble.style, {
      position: 'absolute',
      background: getSelectionColor(),
      border: 'none',
      borderRadius: '6px',
      padding: '6px 9px',
      boxShadow: '0 2px 8px rgba(0,0,0,0.25)',
      zIndex: String(Z.badge - 1),
      fontFamily: 'system-ui, sans-serif',
      color: '#fff',
      minWidth: '180px',
      maxWidth: '280px',
      pointerEvents: 'auto',
      transition: 'transform 0.1s',
      userSelect: 'none',
      WebkitUserSelect: 'none',
      boxSizing: 'border-box',
      display: 'flex',
      gap: '8px',
      alignItems: 'flex-start',
    });

    // Drag handle: a tiny grid of "grabby" dots on the left edge so the
    // bubble is movable even before any text is typed (where the textarea
    // would otherwise eat almost the entire mousedown target).
    const handle = document.createElement('div');
    handle.setAttribute('aria-label', 'Drag to move');
    handle.title = 'Drag to move';
    handle.innerHTML = '<svg width="6" height="16" viewBox="0 0 6 16" xmlns="http://www.w3.org/2000/svg" fill="rgba(255,255,255,0.7)" aria-hidden="true">'
      + '<circle cx="1.5" cy="3" r="1"/><circle cx="4.5" cy="3" r="1"/>'
      + '<circle cx="1.5" cy="8" r="1"/><circle cx="4.5" cy="8" r="1"/>'
      + '<circle cx="1.5" cy="13" r="1"/><circle cx="4.5" cy="13" r="1"/>'
      + '</svg>';
    Object.assign(handle.style, {
      flex: '0 0 auto',
      width: '8px',
      minHeight: '20px',
      cursor: 'grab',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      userSelect: 'none',
      WebkitUserSelect: 'none',
    });

    const ta = document.createElement('textarea');
    ta.setAttribute('data-dt-allow-select', '');
    ta.readOnly = true;
    Object.assign(ta.style, {
      flex: '1 1 auto',
      minWidth: '0',
      minHeight: '20px',
      padding: '0',
      margin: '0',
      border: 'none',
      background: 'transparent',
      color: '#fff',
      fontSize: '11px',
      lineHeight: '1.4',
      fontFamily: 'system-ui, sans-serif',
      resize: 'none',
      outline: 'none',
      boxSizing: 'border-box',
      display: 'block',
      overflow: 'hidden',
      cursor: 'grab',
    });

    function autoGrow() {
      ta.style.height = 'auto';
      ta.style.height = Math.max(ta.scrollHeight, 20) + 'px';
      if (annotation.bubbleEl) {
        positionBubble(annotation.bubbleEl, annotation.primaryEl, annotation.customPosition);
      }
    }

    ta.addEventListener('input', () => {
      annotation.note = ta.value;
      if (annotation.transient && ta.value.trim()) annotation.transient = false;
      autoGrow();
      updateBadgeCount();
    });
    ta.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') ta.blur();
      // Block held-spacebar repeat so it doesn't fill the field with spaces
      if (e.key === ' ' && e.repeat) e.preventDefault();
    });

    bubble.appendChild(handle);
    bubble.appendChild(ta);
    bubble._textarea = ta;
    bubble._handle = handle;
    bubble._autoGrow = autoGrow;

    // Drag-vs-click.
    //   - mousedown on the textarea while we're the editor → let the
    //     textarea focus normally (caret placement); no drag
    //   - mousedown on the textarea while we're read-only → drag, and on
    //     mouseup with no movement, focusGroup() flips us into the editor
    //   - mousedown anywhere else (handle, padding) → drag, ditto
    let dragging = false, didDrag = false, sx = 0, sy = 0;
    let startDx = 0, startDy = 0;

    bubble.addEventListener('mousedown', (e) => {
      const inTextarea = (e.target === ta);
      const isEditing = (activeAnnotation === annotation);
      if (inTextarea && isEditing) return;

      e.preventDefault();
      e.stopPropagation();
      dragging = true;
      didDrag = false;
      bubble._dragging = true;
      sx = e.clientX; sy = e.clientY;
      startDx = annotation.customPosition ? annotation.customPosition.dx : 0;
      startDy = annotation.customPosition ? annotation.customPosition.dy : 0;
      handle.style.cursor = 'grabbing';
    });

    function onMove(e) {
      if (!dragging) return;
      const dx = e.clientX - sx;
      const dy = e.clientY - sy;
      if (!didDrag && Math.abs(dx) + Math.abs(dy) > 3) didDrag = true;
      if (didDrag) {
        annotation.customPosition = { dx: startDx + dx, dy: startDy + dy };
        positionBubble(bubble, annotation.primaryEl, annotation.customPosition);
      }
    }

    function onUp() {
      if (!dragging) return;
      dragging = false;
      bubble._dragging = false;
      handle.style.cursor = 'grab';
      if (didDrag) return;
      if (activeAnnotation === annotation) return; // already editing, no-op
      // Defer past the synthetic click so Comment's capture click handler
      // still sees the bubble as inspector UI.
      requestAnimationFrame(() => focusGroup(annotation.els));
    }

    document.addEventListener('mousemove', onMove, true);
    document.addEventListener('mouseup', onUp, true);
    bubble._cleanupDrag = () => {
      document.removeEventListener('mousemove', onMove, true);
      document.removeEventListener('mouseup', onUp, true);
    };

    // Hovering the bubble dims every OTHER annotated element so the
    // visual line between this note and ITS attached element(s) stands
    // out. Restored on mouseleave.
    bubble.addEventListener('mouseenter', () => setHoveredAnnotation(annotation));
    bubble.addEventListener('mouseleave', () => setHoveredAnnotation(null));

    document.body.appendChild(bubble);
    inspectorUI.add(bubble);
    return bubble;
  }

  // Default placement: primary element's top-left, bubble sitting just
  // above. If there isn't enough room above (element near viewport top),
  // flip below the element so the bubble never clips off-screen or
  // overlaps the tag label. customPosition (set by drag) is added on top
  // so the bubble follows its element through scrolls but keeps any
  // user-chosen offset.
  // Last click coordinates — set via setClickOrigin() from the Comment
  // tool so the bubble appears near where the user clicked.
  let _clickX = null;
  let _clickY = null;
  function setClickOrigin(x, y) { _clickX = x; _clickY = y; }

  function positionBubble(bubble, el, custom) {
    if (!el) return;
    const r = el.getBoundingClientRect();
    const bubbleH = bubble.offsetHeight || 32;
    const bubbleW = bubble.offsetWidth || 180;
    let left, top;

    // Consume click origin into a custom position on first use
    if (!custom && _clickX !== null) {
      const cx = _clickX;
      const cy = _clickY;
      _clickX = null;
      _clickY = null;

      left = cx + window.scrollX + 8;
      top = cy + window.scrollY - bubbleH - 8;
      // If it would go above viewport, flip below the click
      if (cy - bubbleH - 8 < 0) {
        top = cy + window.scrollY + 16;
      }
      // Clamp to viewport right edge
      const maxLeft = window.scrollX + document.documentElement.clientWidth - bubbleW - 8;
      if (left > maxLeft) left = maxLeft;

      // Store as custom offset so repositions keep the bubble here
      const ann = noteAnnotations.find(a => a.bubbleEl === bubble);
      if (ann) {
        ann.customPosition = {
          dx: left - (r.left + window.scrollX),
          dy: top - (r.top + window.scrollY - bubbleH - 6),
        };
      }
    } else if (custom) {
      // User dragged — respect their position unconditionally
      left = r.left + window.scrollX + custom.dx;
      top = r.top + window.scrollY - bubbleH - 6 + custom.dy;
    } else if (r.top < bubbleH + 6 + 16) {
      // Not enough room above — flip below the element
      top = r.top + window.scrollY + r.height + 6;
      left = r.left + window.scrollX;
    } else {
      top = r.top + window.scrollY - bubbleH - 6;
      left = r.left + window.scrollX;
    }
    bubble.style.left = left + 'px';
    bubble.style.top = top + 'px';
  }

  let _repositionQueued = false;
  function queueRepositionAll() {
    if (_repositionQueued) return;
    _repositionQueued = true;
    requestAnimationFrame(() => {
      _repositionQueued = false;
      noteAnnotations.forEach(a => {
        if (a.bubbleEl) positionBubble(a.bubbleEl, a.primaryEl, a.customPosition);
      });
      noteAnnotations.forEach(a => a.els.forEach(el => applyAnnotationStyle(el)));
      textEdits.forEach((_, el) => applyAnnotationStyle(el));
    });
  }

  function removeBubble(annotation) {
    if (!annotation.bubbleEl) return;
    if (annotation.bubbleEl._cleanupDrag) annotation.bubbleEl._cleanupDrag();
    inspectorUI.delete(annotation.bubbleEl);
    annotation.bubbleEl.remove();
    annotation.bubbleEl = null;
  }

  // Show/refresh the bubble. `editing` decides whether the textarea is
  // readonly. The bubble is hidden when there's no note AND the
  // annotation isn't the active editor (keeps stale empties off-screen).
  function syncBubble(annotation, editing) {
    const hasNote = annotation.note && annotation.note.trim().length > 0;
    if (!hasNote && !editing) {
      removeBubble(annotation);
      return;
    }
    if (!annotation.bubbleEl) annotation.bubbleEl = createBubble(annotation);

    const ta = annotation.bubbleEl._textarea;
    ta.readOnly = !editing;
    ta.style.cursor = editing ? 'text' : 'grab';
    ta.placeholder = editing
      ? (annotation.els.length > 1
        ? `Group note for ${annotation.els.length} elements…`
        : 'Describe the change…')
      : '';
    if (ta.value !== annotation.note) ta.value = annotation.note;
    annotation.bubbleEl._autoGrow();
    positionBubble(annotation.bubbleEl, annotation.primaryEl, annotation.customPosition);

    if (editing) {
      setTimeout(() => {
        if (!annotation.bubbleEl) return;
        ta.focus();
        const end = ta.value.length;
        try { ta.setSelectionRange(end, end); } catch (_) {}
      }, 0);
    }
  }

  function removeNoteAnnotation(annotation) {
    if (hoveredAnnotation === annotation) hoveredAnnotation = null;
    removeBubble(annotation);
    const idx = noteAnnotations.indexOf(annotation);
    if (idx !== -1) noteAnnotations.splice(idx, 1);
    annotation.els.forEach(el => applyAnnotationStyle(el));
    updateBadgeCount();
  }

  // ---- Editor lifecycle (the Comment tool drives this) ----
  //
  // setEditorTarget(els) is called whenever the Comment tool's selection
  // changes (or it opens for the first time). It promotes any matching
  // existing annotation to be the active editor, or spins up a transient
  // one if no annotation involves any of `els`.  Other annotations
  // touching any of these elements are merged into the editor — group
  // boundaries reflect what's currently selected.

  function setEditorTarget(els) {
    if (!els || !els.length) {
      closeEditor();
      return;
    }

    // Find an existing annotation involving any selected el.
    let ann = noteAnnotations.find(a => a.els.some(el => els.includes(el)));

    // Switching editor target — finalize the current one (commit or drop).
    // Null activeAnnotation BEFORE finalizing so the repaint inside
    // finalize sees the old els as inactive and drops their border.
    if (activeAnnotation && activeAnnotation !== ann) {
      const prev = activeAnnotation;
      activeAnnotation = null;
      finalizeAnnotation(prev);
    }

    if (!ann) {
      // Transient: a placeholder editor so the user can start typing.
      // If they don't, closeEditor will throw it away.
      ann = {
        id: nextId++,
        els: [],
        selectors: [],
        note: '',
        primaryEl: null,
        bubbleEl: null,
        customPosition: null,
        transient: true,
      };
      noteAnnotations.push(ann);
    }

    // Update group composition to match the current selection.
    ann.els = els.slice();
    ann.selectors = els.map(getSelector);
    ann.primaryEl = els[0];

    // Consolidate: any OTHER annotation that overlaps with this group is
    // absorbed (its note text wins if our editor is empty).
    for (let i = noteAnnotations.length - 1; i >= 0; i--) {
      const other = noteAnnotations[i];
      if (other === ann) continue;
      if (!other.els.some(el => els.includes(el))) continue;
      if ((!ann.note || !ann.note.trim()) && other.note) {
        ann.note = other.note;
      }
      if (!ann.customPosition && other.customPosition && other.primaryEl === ann.primaryEl) {
        ann.customPosition = other.customPosition;
      }
      removeNoteAnnotation(other);
    }

    activeAnnotation = ann;
    syncBubble(ann, true);
    els.forEach(el => applyAnnotationStyle(el));
    updateBadgeCount();
  }

  function finalizeAnnotation(ann) {
    if (ann.transient && (!ann.note || !ann.note.trim())) {
      removeNoteAnnotation(ann);
      return;
    }
    ann.transient = false;
    syncBubble(ann, false);
    ann.els.forEach(el => applyAnnotationStyle(el));
  }

  function closeEditor() {
    if (!activeAnnotation) return;
    const a = activeAnnotation;
    activeAnnotation = null;
    finalizeAnnotation(a);
    updateBadgeCount();
  }

  // Drop everything tracked by this module — bubbles, notes, text edits.
  // Element styles return to their pristine pre-tool look. The text the
  // user typed inline is intentionally NOT reverted; clearing the
  // trackers shouldn't undo their content.
  function clearAnnotations() {
    activeAnnotation = null;
    for (let i = noteAnnotations.length - 1; i >= 0; i--) {
      removeNoteAnnotation(noteAnnotations[i]);
    }
    const trackedEls = Array.from(textEdits.keys());
    textEdits.clear();
    trackedEls.forEach(el => applyAnnotationStyle(el));
    updateBadgeCount();
  }

  // ---- Text edits ----
  function setElementText(el, originalText, originalClasses) {
    if (!textEdits.has(el)) {
      textEdits.set(el, { originalText, originalClasses });
    }
    applyAnnotationStyle(el);
    updateBadgeCount();
  }

  function evaluateAnnotation(el) {
    const e = textEdits.get(el);
    if (e && el.innerText === e.originalText && el.className === e.originalClasses) {
      textEdits.delete(el);
    }
    applyAnnotationStyle(el);
    updateBadgeCount();
  }

  // ---- Badge ----
  function updateBadgeCount() {
    // Each non-transient note + each text edit counts as one change.
    let count = 0;
    noteAnnotations.forEach(a => {
      if (!a.transient && a.note && a.note.trim()) count++;
    });
    textEdits.forEach((e, el) => {
      if (el.innerText !== e.originalText || el.className !== e.originalClasses) count++;
    });
    updateCopyBadge(count);
  }

  // ---- Unified list for copy-all ----
  function getAnnotations() {
    const items = [];
    noteAnnotations.forEach(a => {
      if (a.transient || !a.note || !a.note.trim()) return;
      items.push({
        kind: 'note',
        els: a.els,
        selectors: a.selectors,
        note: a.note,
      });
    });
    textEdits.forEach((e, el) => {
      if (el.innerText === e.originalText && el.className === e.originalClasses) return;
      // Skip structural containers (canvas wrapper) — only track leaf edits
      if (el.id === 'dt-canvas-wrapper') return;
      items.push({
        kind: 'text',
        el,
        selector: getSelector(el),
        originalText: e.originalText,
        originalClasses: e.originalClasses,
      });
    });
    return items;
  }

  // Live-update bubbles + tracked element scrims when the selection
  // color is swapped from settings.
  onColorChange((color) => {
    noteAnnotations.forEach(a => {
      if (a.bubbleEl) a.bubbleEl.style.background = color;
      a.els.forEach(el => applyAnnotationStyle(el));
    });
    textEdits.forEach((_, el) => applyAnnotationStyle(el));
  });

  // ---- Module shell ----
  var annotations = {
    id: 'annotations',
    enabledByDefault: true,

    init() {
      window.addEventListener('scroll', queueRepositionAll, true);
      window.addEventListener('resize', queueRepositionAll);
    },
  };

  /**
   * Copy-all-changes serializer.
   *
   * Produces a Markdown summary of every tracked change on the page,
   * structured so it pastes cleanly into Slack / Linear / a PR comment.
   * Two top-level shapes:
   *   - Group note: one note attached to 2+ elements. Lists every
   *     selector under a "Group of N" header.
   *   - Per-element block: one heading per element, with all of that
   *     element's changes (note, text diff, class diff) merged
   *     together so the reader sees a single coherent edit per item
   *     instead of the same selector duplicated three times.
   *
   * The same builder also powers right-click "copy element" — passing
   * a single-element filter renders just that element's section (and
   * any group note it participates in) in the same format.
   */


  // --- Diff helpers --------------------------------------------------------

  function classDiff(currentClasses, originalClasses) {
    const origSet = new Set((originalClasses || '').trim().split(/\s+/).filter(Boolean));
    const currSet = new Set((currentClasses || '').trim().split(/\s+/).filter(Boolean));
    const added = [...currSet].filter(c => !origSet.has(c));
    const removed = [...origSet].filter(c => !currSet.has(c));
    return { added, removed };
  }

  // Decide between an inline diff ("a" → "b") and a multi-line block
  // based on whether either side has a newline or is long enough that
  // inline becomes unreadable.
  function isShortText(s) {
    return !s.includes('\n') && s.length <= 80;
  }

  function formatTextDiff(before, after) {
    if (isShortText(before) && isShortText(after)) {
      return `Text: "${before}" → "${after}"`;
    }
    const indent = (s) => s.split('\n').map(l => '  ' + l).join('\n');
    return `Text:\n  Before:\n${indent(before)}\n  After:\n${indent(after)}`;
  }

  function formatClassDiff(added, removed) {
    const lines = ['Classes:'];
    if (added.length) lines.push('  + ' + added.join(' '));
    if (removed.length) lines.push('  - ' + removed.join(' '));
    return lines.join('\n');
  }

  // --- Core builder --------------------------------------------------------
  //
  // `filterEls`: optional iterable of elements to scope the output to.
  //   - undefined → include everything (used by copy-all)
  //   - non-empty → include only annotations that involve at least one
  //     of those els (used by right-click copy on a specific element)
  function buildSections(filterEls) {
    const filter = filterEls ? new Set(filterEls) : null;
    const overlaps = (els) => !filter || els.some(el => filter.has(el));

    const annotations = getAnnotations();
    const selected = getSelected();

    const perEl = new Map();   // el → { selector, note?, textDiff?, classDiff? }
    const groupNotes = [];     // { selectors, note }

    function ensureEntry(el) {
      let e = perEl.get(el);
      if (!e) {
        e = { el, selector: getSelector(el) };
        perEl.set(el, e);
      }
      return e;
    }

    annotations.forEach(item => {
      if (item.kind === 'note') {
        const note = (item.note || '').trim();
        if (!note) return;
        if (!overlaps(item.els)) return;
        if (item.els.length > 1) {
          groupNotes.push({ selectors: item.selectors, note });
        } else {
          ensureEntry(item.els[0]).note = note;
        }
      } else if (item.kind === 'text') {
        if (!overlaps([item.el])) return;
        const el = item.el;
        const before = item.originalText;
        const after = el.innerText;
        const textChanged = after !== before;
        const { added, removed } = classDiff(el.className, item.originalClasses);
        const classesChanged = added.length || removed.length;
        if (!textChanged && !classesChanged) return;
        const entry = ensureEntry(el);
        if (textChanged) entry.textDiff = { before, after };
        if (classesChanged) entry.classDiff = { added, removed };
      }
    });

    // Live class diffs from the current selection.
    selected.forEach(({ el, originalClasses }) => {
      if (!overlaps([el])) return;
      if (el.className === originalClasses) return;
      const { added, removed } = classDiff(el.className, originalClasses);
      if (!added.length && !removed.length) return;
      const entry = ensureEntry(el);
      if (!entry.classDiff) entry.classDiff = { added, removed };
    });

    const sections = [];

    groupNotes.forEach(g => {
      const lines = [`### Group of ${g.selectors.length}`];
      g.selectors.forEach(s => lines.push(`- ${s}`));
      lines.push(`Note: ${g.note}`);
      sections.push(lines.join('\n'));
    });

    perEl.forEach(entry => {
      const lines = [`### ${entry.selector || '(no selector)'}`];
      if (entry.note) lines.push(`Note: ${entry.note}`);
      if (entry.textDiff) lines.push(formatTextDiff(entry.textDiff.before, entry.textDiff.after));
      if (entry.classDiff) lines.push(formatClassDiff(entry.classDiff.added, entry.classDiff.removed));
      if (lines.length === 1) return;
      sections.push(lines.join('\n'));
    });

    return sections;
  }

  // --- Public render functions --------------------------------------------

  function renderDocument(sections) {
    if (!sections.length) return null;
    return '## DOM Changes\n\n' + sections.join('\n\n');
  }

  // Render the full page changes as a Markdown document.
  function buildAllChanges() {
    return renderDocument(buildSections());
  }

  // Render just the changes that involve `el` (its own annotations + any
  // group note it belongs to). Returns null when nothing tracked
  // involves `el`.
  function buildChangesForElement(el) {
    return renderDocument(buildSections([el]));
  }

  // --- Copy-all entry points -----------------------------------------------

  async function copyAllChanges() {
    const output = buildAllChanges();
    if (!output) {
      showToast('No changes to copy');
      return;
    }
    const ok = await copyText(output);
    showToast(ok ? 'All changes copied' : 'Could not copy changes');
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

  /**
   * Global enable/disable + clear-all for DOM-Tools.
   *
   * Disabled hides the toolbar and any persistent bubbles via a single
   * class on <html> — annotation data is preserved, just visually gone,
   * so re-enabling brings everything back. Tools are deactivated to
   * stop intercepting page interaction.
   *
   * Toggled by double-tapping Escape; clear-all is bound to Shift+Esc.
   */


  const HOME_ID = 'style-modifier';

  function ensureDisabledStyles() {
    if (document.getElementById('dt-disabled-styles')) return;
    const style = document.createElement('style');
    style.id = 'dt-disabled-styles';
    style.textContent = `
    html.dt-disabled [data-dt-bubble],
    html.dt-disabled [data-dt-toolbar] { display: none !important; }
  `;
    document.head.appendChild(style);
  }

  function isToolsEnabled() { return state.enabled !== false; }

  function setToolsEnabled(on) {
    ensureDisabledStyles();
    state.enabled = !!on;
    if (state.enabled) {
      document.documentElement.classList.remove('dt-disabled');
      activateModule(HOME_ID);
      setActiveButton(HOME_ID);
      showToast('DOM-Tools on');
    } else {
      closeEditor();
      getModules().forEach(m => { if (m.deactivate) m.deactivate(); });
      document.documentElement.classList.add('dt-disabled');
      showToast('DOM-Tools off');
    }
  }

  function toggleToolsEnabled() {
    setToolsEnabled(!isToolsEnabled());
  }

  function clearAllChanges() {
    clearAnnotations();
    // Clear freehand drawings too — "everything" includes the canvas.
    const drawMod = getModules().find(m => m.id === 'draw');
    if (drawMod && drawMod.clear) drawMod.clear();
    showToast('Cleared all changes');
  }

  const HOME_MOD_ID = 'style-modifier';

  function activateHome() {
    activateModule(HOME_MOD_ID);
    setActiveButton(HOME_MOD_ID);
  }

  // Skip global letter shortcuts (Shift+T etc.) while the user is typing
  // into a real text field; they still want to type a literal "T". Esc
  // bypasses this so they can always exit a tool / disable.
  function isTypingTarget$1(el) {
    if (!el) return false;
    const tag = el.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
    if (el.isContentEditable) return true;
    return false;
  }

  function activateModuleById(id) {
    const mod = getModules().find(m => m.id === id);
    if (!mod) return;
    if (mod.toggle) {
      const stayed = mod.toggle();
      if (stayed) {
        getModules().forEach(m => {
          if (m.id !== id && m.deactivate) m.deactivate();
        });
        setActiveButton(id);
      } else {
        activateHome();
      }
    } else {
      activateModule(id);
      setActiveButton(id);
    }
  }

  let lastEsc = 0;

  function initKeyboard() {
    // Capture-phase so global keys (Escape especially) are seen BEFORE
    // any typing widget — note bubbles, sticky notes, the terminal —
    // calls e.stopPropagation() on its own keydown. Without this, Esc+Esc
    // typed inside a focused textarea would never reach the toggler.
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Alt') {
        e.preventDefault();
        state.altHeld = true;
        return;
      }

      // --- Escape family ---------------------------------------------------
      // Always-available regardless of typing target or enabled state.
      //   Shift+Esc   → clear every tracked change (notes, text, drawings)
      //   Esc        → first tap drops back to home; double-tap toggles
      //                DOM-Tools entirely on/off.
      if (e.key === 'Escape') {
        if (e.shiftKey) {
          e.preventDefault();
          clearAllChanges();
          lastEsc = 0;
          return;
        }

        e.preventDefault();
        const now = Date.now();
        if (now - lastEsc < 400) {
          toggleToolsEnabled();
          lastEsc = 0;
          return;
        }
        lastEsc = now;

        // Single tap: if a non-home tool is active, fall back to home.
        if (!isToolsEnabled()) return;
        if (state.annotateMode) {
          getModules().filter(m => m.id === 'draw').forEach(m => m.deactivate?.());
          state.annotateMode = false;
          activateHome();
        } else if (state.editMode || state.cameraMode) {
          activateHome();
        }
        return;
      }

      // Tool/action shortcuts below this line don't fire while typing or
      // while DOM-Tools is fully disabled.
      if (!isToolsEnabled()) return;
      if (isTypingTarget$1(e.target) || isTypingTarget$1(document.activeElement)) return;

      // --- Top-level keyboard map -----------------------------------------
      //   Shift+T → Edit Text tool
      //   Shift+C → Copy all changes
      if (e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const k = e.key.toLowerCase();
        if (k === 't') {
          e.preventDefault();
          activateModuleById('edit-mode');
          return;
        }
        if (k === 'c') {
          e.preventDefault();
          copyAllChanges();
          return;
        }
      }

      // --- Per-module shortcuts (e.g. camera's Cmd+Shift+S) ---------------
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
                modules.forEach(m => {
                  if (m.id !== mod.id && m.deactivate) m.deactivate();
                });
                setActiveButton(mod.id);
              } else {
                activateHome();
              }
            } else if (sc.action && mod[sc.action]) {
              mod[sc.action]();
            }
            return;
          }
        }
      }
    }, true);

    document.addEventListener('keyup', (e) => {
      if (e.key === 'Alt') {
        state.altHeld = false;
        state.slotType = null;
      }
    });
  }

  /**
   * Plugin API — the public surface plugins receive in their init(api) call.
   * Plugins are standalone scripts with no module imports, so this object
   * gives them access to the internals they need without bundler coupling.
   */


  /**
   * createPanel — reusable draggable floating panel factory.
   * Used by draw.js internally and available to plugins.
   */
  function createPanel({ title = '', position = { top: '16px', right: '16px' }, width = 'auto' } = {}) {
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
    grip.textContent = '\u2837';
    Object.assign(grip.style, { color: 'rgba(255,255,255,0.35)', fontSize: '12px' });

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

  const pluginAPI = {
    state,
    inspectorUI,
    activateModule,
    isEnabled,
    showToast,
    addTooltip,
    nudge,
    flashElement: flashElement$1,
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
    flashElement$1(el || document.documentElement);
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
        clearHover$2();
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
            clearHover$2();
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
      // Restore body cursor (set to crosshair in activate).
      document.body.style.cursor = '';
    },

    captureFullPage,

    enable() {},
    disable() { this.deactivate(); },
  };

  // Pencil cursor — same icon as the toolbar button, white fill, 20x20 with hotspot at bottom-left tip
  const PENCIL_CURSOR = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='20' height='20' viewBox='0 0 24 24'%3E%3Cpath d='M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 000-1.41l-2.34-2.34a1 1 0 00-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z' fill='%23fff' stroke='%23000' stroke-width='0.5'/%3E%3C/svg%3E") 2 18, crosshair`;

  let drawCanvas = null;
  let isDrawing = false;
  let drawPanel = null;

  // --- Draw settings (user-selectable via panel) ---
  const DRAW_COLORS = [
    { id: 'theme', value: null, label: 'Theme' },  // uses getSelectionColor()
    { id: 'black', value: '#1e1e1e', label: 'Black' },
    { id: 'red', value: '#e03131', label: 'Red' },
    { id: 'orange', value: '#f76707', label: 'Orange' },
    { id: 'green', value: '#2f9e44', label: 'Green' },
    { id: 'blue', value: '#1971c2', label: 'Blue' },
    { id: 'violet', value: '#7048e8', label: 'Violet' },
  ];
  const DRAW_SIZES = [
    { id: 'S', width: 1.5 },
    { id: 'M', width: 3 },
    { id: 'L', width: 5 },
    { id: 'XL', width: 8 },
  ];
  let activeColorId = 'theme';
  let activeSizeId = 'M';

  function getDrawColor() {
    const opt = DRAW_COLORS.find(c => c.id === activeColorId);
    return (opt && opt.value) || getSelectionColor();
  }
  function getDrawWidth() {
    return (DRAW_SIZES.find(s => s.id === activeSizeId) || DRAW_SIZES[1]).width;
  }

  function applyPenStyle() {
    if (!drawCanvas) return;
    const ctx = drawCanvas.getContext('2d');
    ctx.strokeStyle = getDrawColor();
    ctx.lineWidth = getDrawWidth();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
  }

  // --- Floating draw panel (draggable window) ---
  function createDrawPanel() {
    const panel = document.createElement('div');
    panel.setAttribute('data-dt-ignore', '');
    Object.assign(panel.style, {
      position: 'fixed', top: '16px', right: '16px',
      zIndex: String(Z.toolbar + 1),
      background: 'rgba(30,30,30,0.85)', borderRadius: '10px', padding: '10px 14px',
      backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)',
      boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
      fontFamily: 'system-ui, sans-serif',
      fontSize: '11px', userSelect: 'none', WebkitUserSelect: 'none',
      display: 'none',
    });
    inspectorUI.add(panel);

    // --- Drag handle header ---
    const header = document.createElement('div');
    Object.assign(header.style, {
      display: 'flex', alignItems: 'center', gap: '6px',
      marginBottom: '8px', cursor: 'grab',
    });
    const grip = document.createElement('span');
    grip.textContent = '\u2837';
    Object.assign(grip.style, {
      color: 'rgba(255,255,255,0.35)', fontSize: '14px', lineHeight: '1',
    });
    const label = document.createElement('span');
    label.textContent = 'Brush';
    Object.assign(label.style, {
      color: 'rgba(255,255,255,0.5)', fontSize: '11px', fontWeight: '600',
      letterSpacing: '0.5px', textTransform: 'uppercase',
    });
    header.appendChild(grip);
    header.appendChild(label);
    panel.appendChild(header);

    // Drag logic
    let dragging = false, dx = 0, dy = 0;
    header.addEventListener('mousedown', (e) => {
      dragging = true;
      const rect = panel.getBoundingClientRect();
      dx = e.clientX - rect.left;
      dy = e.clientY - rect.top;
      header.style.cursor = 'grabbing';
      e.preventDefault();
    });
    document.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      let x = e.clientX - dx;
      let y = e.clientY - dy;
      // Clamp to viewport
      const pw = panel.offsetWidth, ph = panel.offsetHeight;
      x = Math.max(0, Math.min(window.innerWidth - pw, x));
      y = Math.max(0, Math.min(window.innerHeight - ph, y));
      panel.style.left = x + 'px';
      panel.style.top = y + 'px';
      panel.style.right = 'auto';
    });
    document.addEventListener('mouseup', () => {
      if (!dragging) return;
      dragging = false;
      header.style.cursor = 'grab';
    });

    // Color swatches
    const colorRow = document.createElement('div');
    Object.assign(colorRow.style, { display: 'flex', gap: '6px', alignItems: 'center' });
    panel.appendChild(colorRow);

    DRAW_COLORS.forEach(c => {
      const swatch = document.createElement('button');
      swatch.dataset.colorId = c.id;
      const fill = c.value || getSelectionColor();
      Object.assign(swatch.style, {
        width: '22px', height: '22px', borderRadius: '50%', border: '2px solid transparent',
        background: fill, cursor: 'pointer', padding: '0', transition: 'border-color 0.1s, transform 0.1s',
      });
      if (c.id === 'theme') {
        // Gradient ring to indicate "theme" swatch
        swatch.style.background = getSelectionColor();
      }
      swatch.addEventListener('click', () => {
        activeColorId = c.id;
        applyPenStyle();
        renderPanelState();
      });
      colorRow.appendChild(swatch);
    });

    // Divider
    const divider = document.createElement('div');
    Object.assign(divider.style, { width: '1px', height: '20px', background: 'rgba(255,255,255,0.12)', margin: '0 4px' });
    colorRow.appendChild(divider);

    // Size options (inline with colors, separated by divider)
    const sizeRow = colorRow; // same row

    DRAW_SIZES.forEach(s => {
      const btn = document.createElement('button');
      btn.dataset.sizeId = s.id;
      const dotSize = Math.max(4, s.width * 2);
      Object.assign(btn.style, {
        width: '26px', height: '26px', borderRadius: '50%', border: '2px solid transparent',
        background: 'rgba(255,255,255,0.08)', cursor: 'pointer', padding: '0',
        display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'border-color 0.12s',
      });
      const dot = document.createElement('span');
      Object.assign(dot.style, {
        width: dotSize + 'px', height: dotSize + 'px', borderRadius: '50%', background: '#fff', display: 'block',
      });
      btn.appendChild(dot);
      btn.addEventListener('click', () => {
        activeSizeId = s.id;
        applyPenStyle();
        renderPanelState();
      });
      sizeRow.appendChild(btn);
    });

    document.body.appendChild(panel);
    return panel;
  }

  function renderPanelState() {
    if (!drawPanel) return;
    // Update color swatches
    drawPanel.querySelectorAll('[data-color-id]').forEach(swatch => {
      const isActive = swatch.dataset.colorId === activeColorId;
      swatch.style.borderColor = isActive ? getSelectionColor() : 'transparent';
      swatch.style.transform = isActive ? 'scale(1.15)' : 'scale(1)';
      // Keep theme swatch synced with current theme color
      if (swatch.dataset.colorId === 'theme') {
        swatch.style.background = getSelectionColor();
      }
    });
    // Update size buttons
    drawPanel.querySelectorAll('[data-size-id]').forEach(btn => {
      const isActive = btn.dataset.sizeId === activeSizeId;
      btn.style.borderColor = isActive ? 'rgba(255,255,255,0.5)' : 'transparent';
      btn.style.background = isActive ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.08)';
    });
  }

  // Convert a mouse event to canvas-local coordinates, accounting for
  // any CSS transform on the parent wrapper (canvas-zoom).
  function canvasCoords(e) {
    const rect = drawCanvas.getBoundingClientRect();
    const scaleX = drawCanvas.clientWidth / rect.width;
    const scaleY = drawCanvas.clientHeight / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  }

  function resizeDrawCanvas() {
    const dpr = window.devicePixelRatio || 1;
    const container = drawCanvas.parentElement || document.body;
    const pageW = Math.max(container.scrollWidth, document.documentElement.scrollWidth);
    const pageH = Math.max(container.scrollHeight, document.documentElement.scrollHeight);
    const oldData = drawCanvas.width > 0 ? drawCanvas.getContext('2d').getImageData(0, 0, drawCanvas.width, drawCanvas.height) : null;
    drawCanvas.width = pageW * dpr;
    drawCanvas.height = pageH * dpr;
    drawCanvas.style.width = pageW + 'px';
    drawCanvas.style.height = pageH + 'px';
    const ctx = drawCanvas.getContext('2d');
    ctx.scale(dpr, dpr);
    if (oldData) ctx.putImageData(oldData, 0, 0);
    applyPenStyle();
  }

  var draw = {
    id: 'draw',
    label: 'Draw',
    enabledByDefault: true,

    button: {
      icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="#fff"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 000-1.41l-2.34-2.34a1 1 0 00-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>',
      tooltip: 'Draw',
      color: '#3b82f6',
      order: 10,
    },

    shortcuts: [],

    init() {
      drawCanvas = document.createElement('canvas');
      drawCanvas.setAttribute('data-dt-ignore', '');
      Object.assign(drawCanvas.style, {
        position: 'absolute', top: '0', left: '0', zIndex: String(Z.overlay), pointerEvents: 'none'
      });
      document.body.appendChild(drawCanvas);
      // NOTE: drawCanvas is intentionally NOT added to inspectorUI so that
      // canvas-zoom's ensureWrapper() moves it into #dt-canvas-wrapper.
      // This makes drawings scale with the page when zooming.
      resizeDrawCanvas();
      window.addEventListener('resize', resizeDrawCanvas);
      // Theme swap → re-arm the context so the next stroke uses the new
      // color. (Existing strokes stay as-is; we don't keep a vector log.)
      onColorChange(() => { applyPenStyle(); renderPanelState(); });

      // Eraser cursor (follows mouse during right-click erase)
      const ERASER_SIZE = 20;
      const eraserCursor = document.createElement('div');
      Object.assign(eraserCursor.style, {
        position: 'fixed', width: ERASER_SIZE + 'px', height: ERASER_SIZE + 'px',
        border: '2px solid #666', borderRadius: '50%', pointerEvents: 'none',
        display: 'none', zIndex: '100003', background: 'rgba(255,255,255,0.3)'
      });
      document.body.appendChild(eraserCursor);
      inspectorUI.add(eraserCursor);
      let isErasing = false;

      // Prevent context menu on canvas
      drawCanvas.addEventListener('contextmenu', (e) => {
        if (state.annotateMode && state.annotateSub === 'pen') e.preventDefault();
      });

      drawCanvas.addEventListener('mousedown', (e) => {
        if (!state.annotateMode || state.annotateSub !== 'pen') return;
        const pos = canvasCoords(e);
        if (e.button === 2) {
          // Right-click: erase mode
          isErasing = true;
          eraserCursor.style.display = 'block';
          const ctx = drawCanvas.getContext('2d');
          ctx.save();
          ctx.globalCompositeOperation = 'destination-out';
          ctx.beginPath();
          ctx.arc(pos.x, pos.y, ERASER_SIZE / 2, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
          eraserCursor.style.left = (e.clientX - ERASER_SIZE / 2) + 'px';
          eraserCursor.style.top = (e.clientY - ERASER_SIZE / 2) + 'px';
          return;
        }
        isDrawing = true;
        const ctx = drawCanvas.getContext('2d');
        ctx.beginPath();
        ctx.moveTo(pos.x, pos.y);
      });
      drawCanvas.addEventListener('mousemove', (e) => {
        if (isErasing) {
          eraserCursor.style.left = (e.clientX - ERASER_SIZE / 2) + 'px';
          eraserCursor.style.top = (e.clientY - ERASER_SIZE / 2) + 'px';
          const pos = canvasCoords(e);
          const ctx = drawCanvas.getContext('2d');
          ctx.save();
          ctx.globalCompositeOperation = 'destination-out';
          ctx.beginPath();
          ctx.arc(pos.x, pos.y, ERASER_SIZE / 2, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
          return;
        }
        if (!isDrawing) return;
        const pos = canvasCoords(e);
        const ctx = drawCanvas.getContext('2d');
        ctx.lineTo(pos.x, pos.y);
        ctx.stroke();
      });
      drawCanvas.addEventListener('mouseup', () => { isDrawing = false; isErasing = false; eraserCursor.style.display = 'none'; });
      drawCanvas.addEventListener('mouseleave', () => { isDrawing = false; isErasing = false; eraserCursor.style.display = 'none'; });
    },

    activate() {
      state.annotateMode = true;
      state.annotateSub = 'pen';
      drawCanvas.style.pointerEvents = 'auto';
      document.body.style.cursor = PENCIL_CURSOR;
      drawCanvas.style.cursor = PENCIL_CURSOR;
      if (!drawPanel) drawPanel = createDrawPanel();
      drawPanel.style.display = 'block';
      renderPanelState();
      showToast('Draw mode');
    },

    deactivate() {
      if (state.annotateSub === 'pen') {
        state.annotateMode = false;
      }
      isDrawing = false;
      if (drawCanvas) {
        drawCanvas.style.pointerEvents = 'none';
        drawCanvas.style.cursor = '';
      }
      if (drawPanel) drawPanel.style.display = 'none';
      document.body.style.cursor = '';
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
   * Text tool — minimal, distraction-free inline text editor.
   *
   * Hover a text element to see a dashed border + "click to edit" label.
   * Click to drop a caret — the element goes completely naked (no border,
   * no label, no wash). Edits are tracked through the annotation system
   * and roll into the "copy all changes" output silently.
   */


  const BLUE = COLORS.selector;
  const TEXT_TAGS = [
    'P','H1','H2','H3','H4','H5','H6','SPAN','A','LABEL','LI',
    'BLOCKQUOTE','FIGCAPTION','DT','DD','EM','STRONG','SMALL','TD','TH',
    'DIV',
  ];

  let activeMode = false;
  let hoveredEl = null;
  const editableEls = new Set();
  const inputHandlers = new WeakMap();

  // Shared hover label element
  let hoverLabel = null;

  function isTextElement(el) {
    if (!el || el.nodeType !== 1) return false;
    if (TEXT_TAGS.includes(el.tagName)) return true;
    // Also allow divs/other elements that contain direct text
    if (el.tagName === 'DIV' && el.textContent && el.textContent.trim()) return true;
    return false;
  }

  // --- Hover label -----------------------------------------------------------

  function ensureHoverLabel() {
    if (hoverLabel) return;
    hoverLabel = document.createElement('div');
    hoverLabel.textContent = 'click to edit';
    Object.assign(hoverLabel.style, {
      position: 'fixed',
      zIndex: String(Z.tooltip),
      background: 'rgba(0,0,0,0.45)',
      color: 'rgba(255,255,255,0.8)',
      fontSize: '9px',
      fontFamily: 'system-ui, sans-serif',
      fontWeight: '400',
      padding: '2px 6px',
      borderRadius: '3px',
      pointerEvents: 'none',
      whiteSpace: 'nowrap',
      opacity: '0',
      transition: 'opacity 0.12s',
      letterSpacing: '0.1px',
    });
    document.body.appendChild(hoverLabel);
    inspectorUI.add(hoverLabel);
  }

  function positionLabel(el) {
    if (!hoverLabel) return;
    const rect = el.getBoundingClientRect();
    hoverLabel.style.top = (rect.top - 22) + 'px';
    hoverLabel.style.left = (rect.right - hoverLabel.offsetWidth) + 'px';
    // If label would go offscreen top, put it below
    if (rect.top - 22 < 4) {
      hoverLabel.style.top = (rect.bottom + 4) + 'px';
    }
    // Clamp left
    const labelRect = hoverLabel.getBoundingClientRect();
    if (labelRect.left < 4) hoverLabel.style.left = '4px';
    hoverLabel.style.opacity = '1';
  }

  function hideLabel() {
    if (hoverLabel) hoverLabel.style.opacity = '0';
  }

  function destroyLabel() {
    if (hoverLabel) {
      inspectorUI.delete(hoverLabel);
      hoverLabel.remove();
      hoverLabel = null;
    }
  }

  // --- Hover border ----------------------------------------------------------

  function applyHoverBorder(el) {
    ensureOrig(el);
    el.style.outline = '1px dashed rgba(150,150,150,0.5)';
    el.style.outlineOffset = '2px';
  }

  function clearHoverBorder(el) {
    if (!el) return;
    if (editableEls.has(el)) {
      el.style.outline = '';
      el.style.outlineOffset = '';
    } else {
      applyAnnotationStyle(el);
      el.style.outlineOffset = '';
    }
  }

  // --- Hover logic -----------------------------------------------------------

  function clearHover() {
    if (!hoveredEl) return;
    clearHoverBorder(hoveredEl);
    hideLabel();
    hoveredEl = null;
  }

  function onMove(e) {
    if (!activeMode) return;
    // Suppress all hover states while actively editing
    if (editableEls.size > 0) { clearHover(); return; }
    const el = e.target;
    if (isInspectorUI(el) || !isTextElement(el)) {
      clearHover();
      return;
    }
    if (el === hoveredEl) return;
    clearHover();
    hoveredEl = el;
    applyHoverBorder(el);
    ensureHoverLabel();
    positionLabel(el);
  }

  // --- Caret placement -------------------------------------------------------

  function placeCaretFromPoint(clientX, clientY) {
    let range = null;
    if (document.caretPositionFromPoint) {
      const pos = document.caretPositionFromPoint(clientX, clientY);
      if (pos) {
        range = document.createRange();
        range.setStart(pos.offsetNode, pos.offset);
        range.collapse(true);
      }
    } else if (document.caretRangeFromPoint) {
      range = document.caretRangeFromPoint(clientX, clientY);
    }
    if (range) {
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    }
  }

  // --- Editable lifecycle ----------------------------------------------------

  function makeEditable(el) {
    if (editableEls.has(el)) return;
    editableEls.add(el);
    ensureOrig(el);
    el.contentEditable = 'true';
    el.spellcheck = false;
    el.setAttribute('data-gramm', 'false');
    el.setAttribute('data-gramm_editor', 'false');
    el.setAttribute('data-enable-grammarly', 'false');
    el.setAttribute('data-lt-tmp-id', '');
    el.setAttribute('data-dt-text-editing', '');
    el.style.cursor = 'text';
    // Naked — no border, no wash, just plain text + caret
    el.style.outline = 'none';
    el.style.outlineOffset = '';
    el.style.backgroundColor = getOrigBackground(el);

    const originalText = el.innerText;
    const originalClasses = el.className;
    const handler = () => {
      setElementText(el, originalText, originalClasses);
      evaluateAnnotation(el);
      queueRepositionAll();
    };
    el.addEventListener('input', handler);
    inputHandlers.set(el, handler);
  }

  function unmakeEditable(el) {
    if (!editableEls.has(el)) return;
    el.removeAttribute('data-dt-text-editing');
    el.contentEditable = 'false';
    el.style.cursor = '';
    el.style.outline = '';
    el.style.outlineOffset = '';
    const h = inputHandlers.get(el);
    if (h) {
      el.removeEventListener('input', h);
      inputHandlers.delete(el);
    }
    editableEls.delete(el);
    applyAnnotationStyle(el);
  }

  // --- Click handler ---------------------------------------------------------

  function onClick(e) {
    if (!activeMode) return;
    const el = e.target;
    if (isInspectorUI(el) || !isTextElement(el)) return;
    if (editableEls.has(el)) return;

    e.preventDefault();
    e.stopPropagation();
    clearHover();

    makeEditable(el);

    const x = e.clientX, y = e.clientY;
    setTimeout(() => {
      el.focus();
      placeCaretFromPoint(x, y);
    }, 0);
  }

  // --- Module spec -----------------------------------------------------------

  var editMode = {
    id: 'edit-mode',
    label: 'Edit Text',
    enabledByDefault: true,

    button: {
      icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="#fff"><path d="M5 4v3h5.5v12h3V7H19V4H5z"/></svg>',
      tooltip: 'Edit Text',
      color: BLUE,
      order: 8,
    },

    shortcuts: [],

    init() {
      document.addEventListener('click', onClick, true);
      document.addEventListener('mousemove', onMove, true);
    },

    activate() {
      activeMode = true;
      state.editMode = true;
      showToast('Edit Text — click any text to edit it inline');
    },

    deactivate() {
      activeMode = false;
      state.editMode = false;
      clearHover();
      destroyLabel();
      Array.from(editableEls).forEach(unmakeEditable);
    },

    toggle() {
      if (activeMode) { this.deactivate(); return false; }
      this.activate();
      return true;
    },

    enable() {},
    disable() { this.deactivate(); },
  };

  /**
   * Move elements experiment.
   *
   * Hold Cmd (Meta) to put the page into "grab" mode. Click-drag any
   * element to move it. Two modes (toggle in Settings → Experiments →
   * Move elements → Type):
   *
   *   - DOM reorder: a colored insertion line shows between siblings
   *     while dragging. Drop = the element is `insertBefore`'d at that
   *     position. Result is a clean structural rearrangement.
   *
   *   - Free position: ghost follows the cursor freely. Drop = the
   *     element gets `position: relative` + `top`/`left` offsets so it
   *     stays put visually without altering DOM order.
   *
   * Cmd up or Esc during drag = cancel and restore. Inspector UI (the
   * toolbar, bubbles, tag labels, terminal, etc.) is never grabbable.
   */


  let active$2 = false;     // module enabled (registered)
  let cmdHeld = false;
  let dragging$1 = false;
  let dragEl = null;
  let ghostEl$1 = null;
  let indicator$1 = null;
  let dropTarget$1 = null;  // { parent, before } for DOM-reorder mode
  let startX$1 = 0, startY$1 = 0;
  let startOffsetDx = 0, startOffsetDy = 0;

  // Page-wide cursor override via an `!important` stylesheet rule. We
  // can't just set `document.body.style.cursor = 'grab'` because the
  // Comment tool injects a `cursor: pointer !important` rule on
  // `html.dt-comment-active body *`, which beats inline styles. A class
  // on <html> + a matching !important rule wins on specificity.
  function ensureCursorStyles$2() {
    if (document.getElementById('dt-move-cursor-styles')) return;
    const style = document.createElement('style');
    style.id = 'dt-move-cursor-styles';
    style.textContent = `
    html.dt-grab-active, html.dt-grab-active body, html.dt-grab-active body * {
      cursor: grab !important;
    }
    html.dt-grabbing, html.dt-grabbing body, html.dt-grabbing body * {
      cursor: grabbing !important;
    }
  `;
    document.head.appendChild(style);
  }

  function setGrabState(state) {
    const html = document.documentElement;
    html.classList.remove('dt-grab-active', 'dt-grabbing');
    if (state === 'grab') html.classList.add('dt-grab-active');
    else if (state === 'grabbing') html.classList.add('dt-grabbing');
  }

  // Per-element saved offsets so repeated free-position drags accumulate
  // instead of resetting each time the user grabs.
  const offsets = new WeakMap(); // el → { dx, dy, origPosition, origTop, origLeft }

  function getMode() {
    return getExperimentOption('move', 'moveType') || 'dom-reorder';
  }

  function isGrabbable(el) {
    if (!el || el.nodeType !== 1) return false;
    if (el === document.body || el === document.documentElement) return false;
    if (isInspectorUI(el)) return false;
    return true;
  }

  // Bright dashed outline + soft tint so the user knows what they're
  // about to grab when Cmd is held and the cursor is over an element.
  let hoverPreview$1 = null;
  function setHoverPreview$1(el) {
    if (hoverPreview$1 === el) return;
    clearHoverPreview$1();
    if (!el) return;
    hoverPreview$1 = el;
    hoverPreview$1._dt_move_origOutline = el.style.outline || '';
    hoverPreview$1._dt_move_origOutlineOffset = el.style.outlineOffset || '';
    el.style.outline = '2px dashed ' + getSelectionColor();
    el.style.outlineOffset = '2px';
  }
  function clearHoverPreview$1() {
    if (!hoverPreview$1) return;
    hoverPreview$1.style.outline = hoverPreview$1._dt_move_origOutline || '';
    hoverPreview$1.style.outlineOffset = hoverPreview$1._dt_move_origOutlineOffset || '';
    delete hoverPreview$1._dt_move_origOutline;
    delete hoverPreview$1._dt_move_origOutlineOffset;
    hoverPreview$1 = null;
  }


  function createGhost$1(el) {
    const r = el.getBoundingClientRect();
    const clone = el.cloneNode(true);
    // Strip ids on the clone so we don't duplicate id="x" in the DOM
    clone.removeAttribute('id');
    Object.assign(clone.style, {
      position: 'fixed',
      left: r.left + 'px',
      top: r.top + 'px',
      width: r.width + 'px',
      height: r.height + 'px',
      margin: '0',
      pointerEvents: 'none',
      opacity: '0.55',
      zIndex: String(Z.toolbar + 5),
      boxShadow: '0 8px 24px rgba(0,0,0,0.25)',
      outline: '2px solid ' + getSelectionColor(),
      transition: 'none',
    });
    document.body.appendChild(clone);
    inspectorUI.add(clone);
    return clone;
  }

  function destroyGhost$1() {
    if (!ghostEl$1) return;
    inspectorUI.delete(ghostEl$1);
    ghostEl$1.remove();
    ghostEl$1 = null;
  }

  function createIndicator$1() {
    const el = document.createElement('div');
    Object.assign(el.style, {
      position: 'absolute',
      background: getSelectionColor(),
      boxShadow: '0 0 0 2px ' + withAlpha(getSelectionColor(), 0.3),
      borderRadius: '2px',
      zIndex: String(Z.toolbar + 4),
      pointerEvents: 'none',
      display: 'none',
    });
    document.body.appendChild(el);
    inspectorUI.add(el);
    return el;
  }

  function destroyIndicator$1() {
    if (!indicator$1) return;
    inspectorUI.delete(indicator$1);
    indicator$1.remove();
    indicator$1 = null;
  }

  // Find the candidate sibling under the cursor and decide whether to
  // insert the dragged element BEFORE that sibling or after it (i.e.,
  // before its nextSibling). Also figures out flex-row-ish layouts so
  // the indicator is horizontal vs. vertical.
  function pickDropTarget$1(clientX, clientY) {
    // Briefly hide the ghost so elementFromPoint hits real elements.
    if (ghostEl$1) ghostEl$1.style.display = 'none';
    const under = document.elementFromPoint(clientX, clientY);
    if (ghostEl$1) ghostEl$1.style.display = '';

    if (!under || isInspectorUI(under)) return null;
    // Don't allow dropping into the dragged element's own subtree.
    if (under === dragEl || (dragEl && dragEl.contains(under))) return null;

    // Walk up to find a sibling of dragEl, OR a child of a container
    // that's a valid drop site. Simple heuristic: the candidate sibling
    // is the topmost descendant of `under`'s parent that contains the
    // cursor.
    let candidate = under;
    while (candidate && candidate.parentElement) {
      if (candidate === dragEl) return null;
      if (candidate.parentElement === dragEl.parentElement) break;
      candidate = candidate.parentElement;
    }
    if (!candidate || candidate.parentElement !== dragEl.parentElement) {
      // Different parent → allow moving INTO that parent at the
      // candidate's position.
      candidate = under;
      while (candidate && candidate.parentElement && candidate.parentElement.contains(dragEl)) {
        candidate = candidate.parentElement;
      }
      if (!candidate || !candidate.parentElement) return null;
      if (candidate === dragEl || candidate.contains(dragEl)) return null;
    }

    const parent = candidate.parentElement;
    const r = candidate.getBoundingClientRect();
    const parentStyle = getComputedStyle(parent);
    const horizontal = parentStyle.display.includes('flex')
      && (parentStyle.flexDirection === 'row' || parentStyle.flexDirection === 'row-reverse');

    let before;
    if (horizontal) {
      const mid = r.left + r.width / 2;
      before = clientX < mid ? candidate : candidate.nextSibling;
    } else {
      const mid = r.top + r.height / 2;
      before = clientY < mid ? candidate : candidate.nextSibling;
    }

    return { parent, before, refRect: r, horizontal };
  }

  function showIndicator$1(target) {
    if (!indicator$1) indicator$1 = createIndicator$1();
    if (!target) {
      indicator$1.style.display = 'none';
      return;
    }
    const r = target.refRect;
    const before = target.before;
    // Insertion line position: at the leading edge of `before` (or
    // trailing edge of refRect if before is null/refRect's nextSibling).
    if (target.horizontal) {
      const x = (before === null || before !== document.body.childNodes[0])
        ? (target.parent.lastElementChild === null
            ? r.right
            : (before ? before.getBoundingClientRect().left : r.right))
        : r.left;
      indicator$1.style.left = (x + window.scrollX - 1) + 'px';
      indicator$1.style.top = (r.top + window.scrollY) + 'px';
      indicator$1.style.width = '2px';
      indicator$1.style.height = r.height + 'px';
    } else {
      const y = before
        ? before.getBoundingClientRect().top
        : (r.bottom);
      indicator$1.style.left = (r.left + window.scrollX) + 'px';
      indicator$1.style.top = (y + window.scrollY - 1) + 'px';
      indicator$1.style.width = r.width + 'px';
      indicator$1.style.height = '2px';
    }
    indicator$1.style.display = 'block';
  }

  function startDrag$1(e) {
    const el = e.target;
    if (!isGrabbable(el)) return;

    dragging$1 = true;
    dragEl = el;
    startX$1 = e.clientX;
    startY$1 = e.clientY;

    const saved = offsets.get(el);
    startOffsetDx = saved ? saved.dx : 0;
    startOffsetDy = saved ? saved.dy : 0;

    ghostEl$1 = createGhost$1(el);
    setGrabState('grabbing');
    // Dim the original so the ghost reads as "the moved one".
    el._dt_move_savedOpacity = el.style.opacity || '';
    el.style.opacity = '0.3';

    e.preventDefault();
    e.stopPropagation();
  }

  function updateDrag$1(e) {
    if (!dragging$1 || !ghostEl$1) return;
    const dx = e.clientX - startX$1;
    const dy = e.clientY - startY$1;

    // Keep the ghost following the cursor.
    dragEl.getBoundingClientRect();
    // We snapshotted ghost's left/top at drag start; just translate.
    ghostEl$1.style.transform = `translate(${dx}px, ${dy}px)`;

    if (getMode() === 'dom-reorder') {
      dropTarget$1 = pickDropTarget$1(e.clientX, e.clientY);
      showIndicator$1(dropTarget$1);
    }
  }

  function commitDrag$1(e) {
    if (!dragging$1) return;
    dragging$1 = false;

    const mode = getMode();
    const dx = e.clientX - startX$1;
    const dy = e.clientY - startY$1;

    if (mode === 'dom-reorder') {
      if (dropTarget$1 && dropTarget$1.parent && dropTarget$1.parent !== dragEl) {
        try {
          dropTarget$1.parent.insertBefore(dragEl, dropTarget$1.before);
          showToast('Element moved');
        } catch (_) {}
      }
    } else {
      // free-position: accumulate offset
      const newDx = startOffsetDx + dx;
      const newDy = startOffsetDy + dy;
      let saved = offsets.get(dragEl);
      if (!saved) {
        saved = {
          dx: 0,
          dy: 0,
          origPosition: dragEl.style.position || '',
          origTop: dragEl.style.top || '',
          origLeft: dragEl.style.left || '',
        };
        offsets.set(dragEl, saved);
      }
      saved.dx = newDx;
      saved.dy = newDy;
      if (getComputedStyle(dragEl).position === 'static') {
        dragEl.style.position = 'relative';
      }
      dragEl.style.left = newDx + 'px';
      dragEl.style.top = newDy + 'px';
      showToast('Element repositioned');
    }

    finishDrag$1();
  }

  function cancelDrag$1() {
    if (!dragging$1) return;
    dragging$1 = false;
    finishDrag$1();
  }

  function finishDrag$1() {
    if (dragEl) {
      dragEl.style.opacity = dragEl._dt_move_savedOpacity || '';
      delete dragEl._dt_move_savedOpacity;
    }
    destroyGhost$1();
    destroyIndicator$1();
    dropTarget$1 = null;
    dragEl = null;
    setGrabState(cmdHeld ? 'grab' : null);
  }

  function onKeyDown$2(e) {
    if (!active$2) return;
    if (e.key === 'Meta' || e.key === 'Control') {
      cmdHeld = true;
      if (!dragging$1) setGrabState('grab');
    } else if (e.key === 'Escape' && dragging$1) {
      cancelDrag$1();
    }
  }

  function onKeyUp$2(e) {
    if (!active$2) return;
    if (e.key === 'Meta' || e.key === 'Control') {
      cmdHeld = false;
      if (dragging$1) {
        cancelDrag$1();
      } else {
        setGrabState(null);
        clearHoverPreview$1();
      }
    }
  }

  function onMouseMove$2(e) {
    if (!active$2) return;
    if (dragging$1) {
      updateDrag$1(e);
      return;
    }
    if (!cmdHeld) return;
    const el = e.target;
    if (isGrabbable(el)) {
      setHoverPreview$1(el);
      setGrabState('grab');
    } else {
      clearHoverPreview$1();
    }
  }

  function onMouseDown$2(e) {
    if (!active$2 || !cmdHeld) return;
    // Only respond to primary button.
    if (e.button !== 0) return;
    if (!isGrabbable(e.target)) return;
    clearHoverPreview$1();
    startDrag$1(e);
  }

  function onMouseUp$2(e) {
    if (!active$2) return;
    if (dragging$1) commitDrag$1(e);
  }

  function onWindowBlur$2() {
    cmdHeld = false;
    if (dragging$1) cancelDrag$1();
    else { setGrabState(null); clearHoverPreview$1(); }
  }

  var move = {
    id: 'move',
    label: 'Move',
    experiment: true,
    enabledByDefault: true,

    init() {
      active$2 = true;
      ensureCursorStyles$2();
      document.addEventListener('keydown', onKeyDown$2, true);
      document.addEventListener('keyup', onKeyUp$2, true);
      document.addEventListener('mousemove', onMouseMove$2, true);
      document.addEventListener('mousedown', onMouseDown$2, true);
      document.addEventListener('mouseup', onMouseUp$2, true);
      window.addEventListener('blur', onWindowBlur$2);
    },

    enable() { active$2 = true; },
    disable() {
      active$2 = false;
      cancelDrag$1();
      clearHoverPreview$1();
      setGrabState(null);
    },
  };

  /**
   * Duplicate element experiment.
   *
   * Hold Shift and click-drag any element to spawn a clone that follows
   * the cursor. On mouseup the clone gets dropped into the DOM:
   *   - DOM reorder mode (if Move is also enabled): clone is inserted at
   *     the nearest sibling boundary under the cursor, just like Move.
   *   - Otherwise: clone is appended to the original's parent at the end.
   *
   * Keep it independent of Move so you can run either or both. Shift is
   * the modifier so it doesn't collide with Cmd (Move) or right-click
   * (copy selector).
   */


  let active$1 = false;
  let shiftHeld = false;
  let dragging = false;
  let sourceEl = null;     // the original element being duplicated
  let cloneEl = null;      // the live DOM clone we're dropping
  let ghostEl = null;      // the floating preview that follows the cursor
  let indicator = null;
  let dropTarget = null;
  let startX = 0, startY = 0;

  function ensureCursorStyles$1() {
    if (document.getElementById('dt-dup-cursor-styles')) return;
    const style = document.createElement('style');
    style.id = 'dt-dup-cursor-styles';
    style.textContent = `
    html.dt-dup-active, html.dt-dup-active body, html.dt-dup-active body * {
      cursor: copy !important;
    }
    html.dt-dup-dragging, html.dt-dup-dragging body, html.dt-dup-dragging body * {
      cursor: copy !important;
    }
  `;
    document.head.appendChild(style);
  }

  function setDupState(state) {
    const html = document.documentElement;
    html.classList.remove('dt-dup-active', 'dt-dup-dragging');
    if (state === 'active') html.classList.add('dt-dup-active');
    else if (state === 'dragging') html.classList.add('dt-dup-dragging');
  }

  function isDuplicable(el) {
    if (!el || el.nodeType !== 1) return false;
    if (el === document.body || el === document.documentElement) return false;
    if (isInspectorUI(el)) return false;
    return true;
  }

  let hoverPreview = null;
  function setHoverPreview(el) {
    if (hoverPreview === el) return;
    clearHoverPreview();
    if (!el) return;
    hoverPreview = el;
    hoverPreview._dt_dup_origOutline = el.style.outline || '';
    hoverPreview._dt_dup_origOutlineOffset = el.style.outlineOffset || '';
    el.style.outline = '2px dashed ' + getSelectionColor();
    el.style.outlineOffset = '2px';
  }
  function clearHoverPreview() {
    if (!hoverPreview) return;
    hoverPreview.style.outline = hoverPreview._dt_dup_origOutline || '';
    hoverPreview.style.outlineOffset = hoverPreview._dt_dup_origOutlineOffset || '';
    delete hoverPreview._dt_dup_origOutline;
    delete hoverPreview._dt_dup_origOutlineOffset;
    hoverPreview = null;
  }

  function createGhost(el) {
    const r = el.getBoundingClientRect();
    const clone = el.cloneNode(true);
    clone.removeAttribute('id');
    Object.assign(clone.style, {
      position: 'fixed',
      left: r.left + 'px',
      top: r.top + 'px',
      width: r.width + 'px',
      height: r.height + 'px',
      margin: '0',
      pointerEvents: 'none',
      opacity: '0.7',
      zIndex: String(Z.toolbar + 5),
      boxShadow: '0 8px 24px rgba(0,0,0,0.25)',
      outline: '2px solid ' + getSelectionColor(),
      transition: 'none',
    });
    document.body.appendChild(clone);
    inspectorUI.add(clone);
    return clone;
  }

  function destroyGhost() {
    if (!ghostEl) return;
    inspectorUI.delete(ghostEl);
    ghostEl.remove();
    ghostEl = null;
  }

  function createIndicator() {
    const el = document.createElement('div');
    Object.assign(el.style, {
      position: 'absolute',
      background: getSelectionColor(),
      boxShadow: '0 0 0 2px ' + withAlpha(getSelectionColor(), 0.3),
      borderRadius: '2px',
      zIndex: String(Z.toolbar + 4),
      pointerEvents: 'none',
      display: 'none',
    });
    document.body.appendChild(el);
    inspectorUI.add(el);
    return el;
  }

  function destroyIndicator() {
    if (!indicator) return;
    inspectorUI.delete(indicator);
    indicator.remove();
    indicator = null;
  }

  // Pick a sibling-of-source landing spot under the cursor. Mirrors the
  // approach used in move.js but operates relative to `sourceEl` so the
  // clone naturally appears near the original by default.
  function pickDropTarget(clientX, clientY) {
    if (ghostEl) ghostEl.style.display = 'none';
    const under = document.elementFromPoint(clientX, clientY);
    if (ghostEl) ghostEl.style.display = '';

    if (!under || isInspectorUI(under)) return null;
    if (under === sourceEl || (sourceEl && sourceEl.contains(under))) {
      // Hovering over the original — drop right after it.
      return { parent: sourceEl.parentElement, before: sourceEl.nextSibling, refRect: sourceEl.getBoundingClientRect(), horizontal: false };
    }

    let candidate = under;
    while (candidate && candidate.parentElement) {
      if (candidate.parentElement === sourceEl.parentElement) break;
      candidate = candidate.parentElement;
    }
    if (!candidate || candidate.parentElement !== sourceEl.parentElement) {
      candidate = under;
      while (candidate && candidate.parentElement) {
        if (!candidate.parentElement.contains(sourceEl)) break;
        candidate = candidate.parentElement;
      }
      if (!candidate || !candidate.parentElement) return null;
    }

    const parent = candidate.parentElement;
    const r = candidate.getBoundingClientRect();
    const parentStyle = getComputedStyle(parent);
    const horizontal = parentStyle.display.includes('flex')
      && (parentStyle.flexDirection === 'row' || parentStyle.flexDirection === 'row-reverse');

    let before;
    if (horizontal) {
      const mid = r.left + r.width / 2;
      before = clientX < mid ? candidate : candidate.nextSibling;
    } else {
      const mid = r.top + r.height / 2;
      before = clientY < mid ? candidate : candidate.nextSibling;
    }

    return { parent, before, refRect: r, horizontal };
  }

  function showIndicator(target) {
    if (!indicator) indicator = createIndicator();
    if (!target) {
      indicator.style.display = 'none';
      return;
    }
    const r = target.refRect;
    const before = target.before;
    if (target.horizontal) {
      const x = before ? before.getBoundingClientRect().left : r.right;
      indicator.style.left = (x + window.scrollX - 1) + 'px';
      indicator.style.top = (r.top + window.scrollY) + 'px';
      indicator.style.width = '2px';
      indicator.style.height = r.height + 'px';
    } else {
      const y = before ? before.getBoundingClientRect().top : r.bottom;
      indicator.style.left = (r.left + window.scrollX) + 'px';
      indicator.style.top = (y + window.scrollY - 1) + 'px';
      indicator.style.width = r.width + 'px';
      indicator.style.height = '2px';
    }
    indicator.style.display = 'block';
  }

  function startDrag(e) {
    const el = e.target;
    if (!isDuplicable(el)) return;
    dragging = true;
    sourceEl = el;
    startX = e.clientX;
    startY = e.clientY;
    ghostEl = createGhost(el);
    setDupState('dragging');
    e.preventDefault();
    e.stopPropagation();
  }

  function updateDrag(e) {
    if (!dragging || !ghostEl) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    ghostEl.style.transform = `translate(${dx}px, ${dy}px)`;
    dropTarget = pickDropTarget(e.clientX, e.clientY);
    showIndicator(dropTarget);
  }

  function commitDrag() {
    if (!dragging) return;
    dragging = false;

    if (sourceEl) {
      cloneEl = sourceEl.cloneNode(true);
      // Strip ids on the clone so we don't end up with two same-id els.
      if (cloneEl.id) cloneEl.removeAttribute('id');
      cloneEl.querySelectorAll('[id]').forEach(n => n.removeAttribute('id'));

      let placed = false;
      if (dropTarget && dropTarget.parent) {
        try {
          dropTarget.parent.insertBefore(cloneEl, dropTarget.before);
          placed = true;
        } catch (_) {}
      }
      if (!placed) {
        // Fallback: drop the clone right after the original.
        sourceEl.parentNode.insertBefore(cloneEl, sourceEl.nextSibling);
      }
      // Brief flash on the new clone so the user sees where it landed.
      flashElement(cloneEl);
      showToast('Element duplicated');
    }
    finishDrag();
  }

  function flashElement(el) {
    const orig = el.style.outline || '';
    el.style.outline = '2px solid ' + getSelectionColor();
    setTimeout(() => { el.style.outline = orig; }, 600);
  }

  function cancelDrag() {
    if (!dragging) return;
    dragging = false;
    finishDrag();
  }

  function finishDrag() {
    destroyGhost();
    destroyIndicator();
    dropTarget = null;
    sourceEl = null;
    setDupState(shiftHeld ? 'active' : null);
  }

  function onKeyDown$1(e) {
    if (!active$1) return;
    if (e.key === 'Shift') {
      shiftHeld = true;
      if (!dragging) setDupState('active');
    } else if (e.key === 'Escape' && dragging) {
      cancelDrag();
    }
  }

  function onKeyUp$1(e) {
    if (!active$1) return;
    if (e.key === 'Shift') {
      shiftHeld = false;
      if (dragging) cancelDrag();
      else { setDupState(null); clearHoverPreview(); }
    }
  }

  function onMouseMove$1(e) {
    if (!active$1) return;
    if (dragging) { updateDrag(e); return; }
    if (!shiftHeld) return;
    const el = e.target;
    if (isDuplicable(el)) {
      setHoverPreview(el);
      setDupState('active');
    } else {
      clearHoverPreview();
    }
  }

  function onMouseDown$1(e) {
    if (!active$1 || !shiftHeld) return;
    if (e.button !== 0) return;
    if (!isDuplicable(e.target)) return;
    clearHoverPreview();
    startDrag(e);
  }

  function onMouseUp$1(e) {
    if (!active$1) return;
    if (dragging) commitDrag();
  }

  function onWindowBlur$1() {
    shiftHeld = false;
    if (dragging) cancelDrag();
    else { setDupState(null); clearHoverPreview(); }
  }

  var duplicate = {
    id: 'duplicate',
    label: 'Duplicate',
    experiment: true,
    enabledByDefault: true,

    init() {
      active$1 = true;
      ensureCursorStyles$1();
      document.addEventListener('keydown', onKeyDown$1, true);
      document.addEventListener('keyup', onKeyUp$1, true);
      document.addEventListener('mousemove', onMouseMove$1, true);
      document.addEventListener('mousedown', onMouseDown$1, true);
      document.addEventListener('mouseup', onMouseUp$1, true);
      window.addEventListener('blur', onWindowBlur$1);
    },

    enable() { active$1 = true; },
    disable() {
      active$1 = false;
      cancelDrag();
      clearHoverPreview();
      setDupState(null);
    },
  };

  /**
   * Right-click → copy element selector.
   *
   * Lightweight global handler: right-click on any page element copies a
   * CSS selector for it to the clipboard, with a small "nudge" animation
   * on the element to confirm the copy. Suppresses the native context
   * menu when the click hits a real page element.
   *
   * Skipped when:
   *   - the click is on inspector UI (toolbar, bubble, settings panel…)
   *   - the Draw tool is in pen mode (it uses right-click for erase)
   */


  function ellipsize(s, n) {
    return s.length > n ? s.slice(0, n - 1) + '…' : s;
  }

  async function onContextMenu(e) {
    // Draw tool owns right-click while in pen mode (it erases).
    if (state.annotateMode && state.annotateSub === 'pen') return;

    // Suppress the native right-click menu page-wide while dom-tools is
    // active — the right-click is now our "copy element" gesture.
    e.preventDefault();
    e.stopPropagation();

    const el = e.target;
    if (!el || el.nodeType !== 1) return;
    if (isInspectorUI(el)) return;
    if (el === document.body || el === document.documentElement) return;

    // If the element has any tracked changes (own note, text edit,
    // class diff, or group-note membership), copy the same Markdown
    // section copy-all would emit for it. Otherwise fall back to the
    // bare selector — that's what right-click on an unannotated
    // element has always meant.
    const richBlock = buildChangesForElement(el);
    const selector = getSelector(el);
    const payload = richBlock || selector;

    const ok = await copyText(payload);
    if (!ok) {
      showToast('Could not copy');
      return;
    }
    nudge(el);
    if (richBlock) {
      showToast(`Copied element + changes (${ellipsize(selector, 50)})`);
    } else {
      showToast(`Copied: ${ellipsize(selector, 60)}`);
    }
  }

  var copySelector = {
    id: 'copy-selector',
    enabledByDefault: true,

    init() {
      document.addEventListener('contextmenu', onContextMenu, true);
    },
  };

  /**
   * Canvas Zoom & Pan — Figma-style navigation.
   *
   * - Cmd + Scroll: zoom in/out via transform scale (not browser zoom)
   * - Spacebar + Drag: pan the canvas via transform translate
   *
   * Transforms are applied to a wrapper div that contains all page
   * content. Inspector UI (toolbar, overlays) lives outside the wrapper
   * so it stays fixed and usable at any zoom level.
   */


  let active = false;
  let wrapper = null;

  // Transform state
  let scale = 1;
  let panX = 0;
  let panY = 0;

  // Interaction state
  let spaceHeld = false;
  let panning = false;
  let panStartX = 0;
  let panStartY = 0;
  let panStartPanX = 0;
  let panStartPanY = 0;

  // Hold-threshold: if spacebar is held longer than this, activate hand
  // tool even inside text inputs. Mimics Figma behavior.
  const SPACE_HOLD_MS = 200;
  let spaceHoldTimer = null;
  let spaceWasInInput = false;

  const MIN_SCALE = 0.25;
  const MAX_SCALE = 4;
  const ZOOM_SPEED = 0.002;

  // --- Zoom level indicator (tldraw-style) ---
  let zoomIndicator = null;
  let hideTimeout = null;

  function ensureZoomIndicator() {
    if (zoomIndicator) return;
    zoomIndicator = document.createElement('div');
    Object.assign(zoomIndicator.style, {
      position: 'fixed',
      bottom: '72px',
      left: '50%',
      transform: 'translateX(-50%)',
      background: 'rgba(30,30,30,0.85)',
      color: '#fff',
      fontSize: '12px',
      fontWeight: '600',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      padding: '4px 10px',
      borderRadius: '6px',
      zIndex: String(Z.toolbar + 1),
      pointerEvents: 'none',
      opacity: '0',
      transition: 'opacity 0.15s ease',
      backdropFilter: 'blur(8px)',
      WebkitBackdropFilter: 'blur(8px)',
    });
    document.body.appendChild(zoomIndicator);
    inspectorUI.add(zoomIndicator);
  }

  function showZoomLevel() {
    ensureZoomIndicator();
    zoomIndicator.textContent = Math.round(scale * 100) + '%';
    zoomIndicator.style.opacity = '1';
    clearTimeout(hideTimeout);
    hideTimeout = setTimeout(() => {
      if (zoomIndicator) zoomIndicator.style.opacity = '0';
    }, 1200);
  }

  // --- Minimap (bottom-right viewport overview with page thumbnail) ---
  let minimap = null;
  let minimapCanvas = null;
  let minimapViewport = null;
  let minimapCtx = null;
  let thumbnailDirty = true;

  const MAP_W = 160;
  const MAP_H = 120;
  const MAP_PAD = 6;

  function ensureMinimap() {
    if (minimap) return;
    minimap = document.createElement('div');
    Object.assign(minimap.style, {
      position: 'fixed',
      bottom: '72px',
      right: '16px',
      width: MAP_W + 'px',
      height: MAP_H + 'px',
      background: 'rgba(30,30,30,0.9)',
      border: '1px solid rgba(255,255,255,0.12)',
      borderRadius: '8px',
      zIndex: String(Z.toolbar + 1),
      pointerEvents: 'auto',
      cursor: 'crosshair',
      opacity: '0',
      transition: 'opacity 0.2s ease',
      overflow: 'hidden',
      backdropFilter: 'blur(8px)',
      WebkitBackdropFilter: 'blur(8px)',
    });

    // Canvas for page thumbnail
    minimapCanvas = document.createElement('canvas');
    minimapCanvas.width = MAP_W * 2; // retina
    minimapCanvas.height = MAP_H * 2;
    Object.assign(minimapCanvas.style, {
      position: 'absolute',
      inset: '0',
      width: '100%',
      height: '100%',
    });
    minimapCtx = minimapCanvas.getContext('2d');
    minimap.appendChild(minimapCanvas);

    // Viewport rectangle overlay
    minimapViewport = document.createElement('div');
    Object.assign(minimapViewport.style, {
      position: 'absolute',
      border: '1.5px solid #60a5fa',
      borderRadius: '2px',
      background: 'rgba(96,165,250,0.1)',
    });
    minimap.appendChild(minimapViewport);

    // Click/drag to navigate
    minimap.addEventListener('mousedown', onMinimapDown);
    minimap.addEventListener('click', (e) => e.stopPropagation());

    document.body.appendChild(minimap);
    inspectorUI.add(minimap);

    // Update viewport on scroll
    window.addEventListener('scroll', () => { if (minimap) updateMinimap(); }, true);
  }

  // --- Minimap click-to-navigate ---
  // Convert a click position on the minimap to document coordinates and pan there.
  function minimapClickToPan(e) {
    if (!wrapper) return;
    const rect = minimap.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    const pad = MAP_PAD;
    const innerW = MAP_W - pad * 2;
    const innerH = MAP_H - pad * 2;
    const docW = wrapper.scrollWidth;
    const docH = wrapper.scrollHeight;

    const docAspect = docW / docH;
    const mapAspect = innerW / innerH;
    let drawW, drawH;
    if (docAspect > mapAspect) {
      drawW = innerW;
      drawH = innerW / docAspect;
    } else {
      drawH = innerH;
      drawW = innerH * docAspect;
    }
    const offsetX = pad + (innerW - drawW) / 2;
    const offsetY = pad + (innerH - drawH) / 2;
    const s = drawW / docW;

    // Target document position (center of viewport on this point)
    const docX = (mx - offsetX) / s;
    const docY = (my - offsetY) / s;

    // Pan so this point is centered in the viewport
    const vpW = window.innerWidth / scale;
    const vpH = window.innerHeight / scale;
    panX = -(docX - vpW / 2) * scale;
    panY = -(docY - vpH / 2) * scale;

    applyTransform();
  }

  function onMinimapDown(e) {
    e.preventDefault();
    e.stopPropagation();
    minimapClickToPan(e);

    function onMove(ev) { minimapClickToPan(ev); }
    function onUp() {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  // Render a lightweight thumbnail of the page by sampling visible elements
  // and drawing colored blocks. Not pixel-perfect, but gives spatial context.
  function renderThumbnail() {
    if (!minimapCtx || !wrapper) return;
    thumbnailDirty = false;

    const ctx = minimapCtx;
    const dpr = 2;
    const cW = MAP_W * dpr;
    const cH = MAP_H * dpr;
    const pad = MAP_PAD * dpr;
    const innerW = cW - pad * 2;
    const innerH = cH - pad * 2;

    const docW = wrapper.scrollWidth;
    const docH = wrapper.scrollHeight;

    // Fit document proportionally
    const docAspect = docW / docH;
    const mapAspect = innerW / innerH;
    let drawW, drawH;
    if (docAspect > mapAspect) {
      drawW = innerW;
      drawH = innerW / docAspect;
    } else {
      drawH = innerH;
      drawW = innerH * docAspect;
    }
    const offsetX = pad + (innerW - drawW) / 2;
    const offsetY = pad + (innerH - drawH) / 2;
    const s = drawW / docW;

    // Clear
    ctx.clearRect(0, 0, cW, cH);

    // Document background
    ctx.fillStyle = '#fff';
    ctx.fillRect(offsetX, offsetY, drawW, drawH);

    // Sample visible elements and draw blocks
    const els = wrapper.querySelectorAll('*');
    const wrapperRect = wrapper.getBoundingClientRect();

    for (let i = 0; i < els.length && i < 300; i++) {
      const el = els[i];
      if (inspectorUI.has(el)) continue;
      if (el.offsetWidth === 0 || el.offsetHeight === 0) continue;

      const r = el.getBoundingClientRect();
      // Position relative to wrapper's content origin
      const x = (r.left - wrapperRect.left + wrapper.scrollLeft) * s;
      const y = (r.top - wrapperRect.top + wrapper.scrollTop) * s;
      const w = r.width * s;
      const h = r.height * s;

      if (w < 1 || h < 1) continue;

      // Sample the element's color
      const computed = window.getComputedStyle(el);
      const bg = computed.backgroundColor;
      if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') {
        ctx.fillStyle = bg;
        ctx.fillRect(offsetX + x, offsetY + y, w, h);
      }

      // Draw text-like elements as grey lines
      const tag = el.tagName;
      if (['P','H1','H2','H3','H4','H5','H6','SPAN','A','LI','LABEL'].includes(tag)) {
        ctx.fillStyle = 'rgba(60,60,60,0.25)';
        const lineH = Math.max(1.5, h * 0.4);
        ctx.fillRect(offsetX + x, offsetY + y + (h - lineH) / 2, w * 0.85, lineH);
      }

      // Images get a subtle grey fill
      if (tag === 'IMG' || tag === 'VIDEO' || tag === 'SVG') {
        ctx.fillStyle = 'rgba(120,120,120,0.2)';
        ctx.fillRect(offsetX + x, offsetY + y, w, h);
      }
    }
  }

  function updateMinimap() {
    if (!minimap || !wrapper) return;

    const show = scale !== 1 || panX !== 0 || panY !== 0;
    minimap.style.opacity = show ? '1' : '0';
    if (!show) return;

    // Render thumbnail once and keep it static — only the viewport rect moves
    if (thumbnailDirty) renderThumbnail();
    const pad = MAP_PAD;
    const innerW = MAP_W - pad * 2;
    const innerH = MAP_H - pad * 2;

    const docW = wrapper.scrollWidth;
    const docH = wrapper.scrollHeight;

    const docAspect = docW / docH;
    const mapAspect = innerW / innerH;
    let drawW, drawH;
    if (docAspect > mapAspect) {
      drawW = innerW;
      drawH = innerW / docAspect;
    } else {
      drawH = innerH;
      drawW = innerH * docAspect;
    }
    const offsetX = pad + (innerW - drawW) / 2;
    const offsetY = pad + (innerH - drawH) / 2;
    const s = drawW / docW;

    // Viewport in document coordinates (pan + scroll)
    const vpW = window.innerWidth / scale;
    const vpH = window.innerHeight / scale;
    const vpX = -panX / scale + window.scrollX;
    const vpY = -panY / scale + window.scrollY;

    Object.assign(minimapViewport.style, {
      left: (offsetX + vpX * s) + 'px',
      top: (offsetY + vpY * s) + 'px',
      width: Math.min(vpW * s, drawW) + 'px',
      height: Math.min(vpH * s, drawH) + 'px',
    });
  }

  // --- Content wrapper ---
  // Wraps all page content so transforms don't affect inspector UI.

  function ensureWrapper() {
    if (wrapper) return;
    wrapper = document.createElement('div');
    wrapper.id = 'dt-canvas-wrapper';
    wrapper.style.transformOrigin = '0 0';
    wrapper.style.minHeight = '100vh';

    // Move all existing body children into the wrapper, except
    // elements that belong to the inspector UI.
    const children = Array.from(document.body.childNodes);
    for (const child of children) {
      if (child.nodeType === 1 && inspectorUI.has(child)) continue;
      wrapper.appendChild(child);
    }
    // Insert wrapper as first child of body (before any inspector UI nodes)
    document.body.insertBefore(wrapper, document.body.firstChild);
  }

  // --- Canvas background with contrast ---
  // Parse an rgb/rgba string into [r, g, b]. Returns null if unparseable.
  function parseRgb(str) {
    if (!str) return null;
    const m = str.match(/rgba?\(\s*(\d+),\s*(\d+),\s*(\d+)/);
    return m ? [+m[1], +m[2], +m[3]] : null;
  }

  // Perceived luminance (0–255 scale, rough)
  function luminance(r, g, b) {
    return 0.299 * r + 0.587 * g + 0.114 * b;
  }

  // Pick a canvas bg that contrasts with the document's background.
  // Light documents get a medium grey canvas; dark documents get a lighter one.
  // Mid-tone documents (greys) get a darker canvas for separation.
  function computeCanvasBg(docBgStr) {
    const rgb = parseRgb(docBgStr);
    if (!rgb) return '#e5e5e5';
    const lum = luminance(...rgb);
    if (lum > 200) return '#d4d4d4';      // white/light → medium grey
    if (lum > 140) return '#9ca3af';      // mid-light (grey sites) → darker grey
    if (lum > 80)  return '#4b5563';      // mid-dark → dark grey
    return '#374151';                      // dark → slightly lighter dark
  }

  // --- Transform application ---

  // Snapshot the page's original background before we ever touch it.
  let originalDocBg = null;

  function snapshotDocBg() {
    if (originalDocBg !== null) return;
    const isTransparent = (c) => {
      if (!c || c === 'transparent') return true;
      const m = c.match(/rgba?\(\s*[\d.]+,\s*[\d.]+,\s*[\d.]+(?:,\s*([\d.]+))?\)/);
      if (m && m[1] !== undefined && parseFloat(m[1]) === 0) return true;
      if (c === 'rgba(0, 0, 0, 0)') return true;
      return false;
    };
    const bodyBg = window.getComputedStyle(document.body).backgroundColor;
    const htmlBg = window.getComputedStyle(document.documentElement).backgroundColor;
    originalDocBg = !isTransparent(bodyBg) ? bodyBg : !isTransparent(htmlBg) ? htmlBg : '#fff';
  }

  function applyTransform() {
    if (!wrapper) return;
    wrapper.style.transform = `translate(${panX}px, ${panY}px) scale(${scale})`;
    ensureMinimap();
    updateMinimap();

    const zoomed = scale !== 1;
    if (zoomed) {
      if (!wrapper.dataset.dtBgSet) {
        snapshotDocBg();
        wrapper.style.background = originalDocBg;
        wrapper.style.borderRadius = '4px';
        wrapper.style.boxShadow = '0 0 0 16px ' + originalDocBg + ', 0 0 0 17px #d1d5db, 0 4px 24px rgba(0,0,0,0.12)';
        wrapper.dataset.dtBgSet = '1';
      }
      const canvasBg = computeCanvasBg(originalDocBg);
      document.body.style.background = canvasBg;
      document.documentElement.style.background = canvasBg;
    } else {
      document.body.style.background = '';
      document.documentElement.style.background = '';
      wrapper.style.background = '';
      wrapper.style.borderRadius = '';
      wrapper.style.boxShadow = '';
      delete wrapper.dataset.dtBgSet;
    }
    showZoomLevel();
  }

  function resetTransform() {
    scale = 1;
    panX = 0;
    panY = 0;
    if (wrapper) {
      wrapper.style.transform = '';
      wrapper.style.background = '';
      wrapper.style.borderRadius = '';
      wrapper.style.boxShadow = '';
      delete wrapper.dataset.dtBgSet;
    }
    document.body.style.background = '';
    document.documentElement.style.background = '';
    updateMinimap();
    showZoomLevel();
  }

  // --- Cursor styles ---

  function ensureCursorStyles() {
    if (document.getElementById('dt-zoom-cursor-styles')) return;
    const style = document.createElement('style');
    style.id = 'dt-zoom-cursor-styles';
    style.textContent = `
    html.dt-space-grab, html.dt-space-grab body,
    html.dt-space-grab body *,
    html.dt-comment-active.dt-space-grab body,
    html.dt-comment-active.dt-space-grab body * {
      cursor: grab !important;
    }
    html.dt-space-grabbing, html.dt-space-grabbing body,
    html.dt-space-grabbing body *,
    html.dt-comment-active.dt-space-grabbing body,
    html.dt-comment-active.dt-space-grabbing body * {
      cursor: grabbing !important;
    }
    /* Hide all markings and selection outlines while hand tool is active */
    html.dt-space-grab [data-dt-tag-label],
    html.dt-space-grab [data-dt-bubble],
    html.dt-space-grabbing [data-dt-tag-label],
    html.dt-space-grabbing [data-dt-bubble] {
      opacity: 0 !important;
      pointer-events: none !important;
    }
    html.dt-space-grab #dt-canvas-wrapper *,
    html.dt-space-grabbing #dt-canvas-wrapper * {
      outline: transparent !important;
    }
  `;
    document.head.appendChild(style);
    inspectorUI.add(style);
  }

  function setCursorState(cursorState) {
    const html = document.documentElement;
    html.classList.remove('dt-space-grab', 'dt-space-grabbing');
    if (cursorState === 'grab') html.classList.add('dt-space-grab');
    else if (cursorState === 'grabbing') html.classList.add('dt-space-grabbing');
  }

  // --- Zoom (Cmd + Scroll) — only when experiment is enabled ---

  function onWheel(e) {
    if (!active) return;
    if (!e.metaKey && !e.ctrlKey) return;
    if (!isExperimentEnabled('canvas-zoom')) return;

    e.preventDefault();

    // With CSS zoom, getBoundingClientRect() returns the zoomed rect.
    // The cursor position in unzoomed content space:
    const rect = wrapper.getBoundingClientRect();
    const cursorX = (e.clientX - rect.left) / scale;
    const cursorY = (e.clientY - rect.top) / scale;

    const delta = -e.deltaY * ZOOM_SPEED;
    const newScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale * (1 + delta)));

    // Keep the point under the cursor fixed after scale change.
    panX += cursorX * (scale - newScale);
    panY += cursorY * (scale - newScale);
    scale = newScale;

    applyTransform();
  }

  // --- Pan (Spacebar + Drag) ---

  function activateHandTool() {
    spaceHeld = true;
    state.handToolActive = true;
    document.documentElement.style.userSelect = 'none';
    document.documentElement.style.webkitUserSelect = 'none';
    if (!panning) setCursorState('grab');
    // If we took over from a text input, remove the space character that
    // may have been typed before the threshold fired.
    if (spaceWasInInput) {
      const el = document.activeElement;
      if (el && (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') && el.value.endsWith(' ')) {
        el.value = el.value.slice(0, -1);
      }
      el && el.blur && el.blur();
    }
  }

  function onKeyDown(e) {
    if (!active) return;
    // Cmd+Esc or Cmd+0 resets zoom & pan to 100%
    if (((e.key === 'Escape' || e.key === '0') && (e.metaKey || e.ctrlKey)) && scale !== 1) {
      e.preventDefault();
      e.stopPropagation();
      resetTransform();
      return;
    }
    // Cmd+- / Cmd+= : reset canvas transform and let browser zoom through
    if ((e.key === '-' || e.key === '=' || e.key === '+') && (e.metaKey || e.ctrlKey) && scale !== 1) {
      resetTransform();
      // Don't preventDefault — let the browser handle its native zoom
      return;
    }
    if (e.key !== ' ') return;
    // Hand tool is gated behind the canvas-zoom experiment
    if (!isExperimentEnabled('canvas-zoom')) return;
    if (e.repeat) {
      // If already in hand mode from threshold, suppress repeats
      if (spaceHeld) { e.preventDefault(); e.stopImmediatePropagation(); }
      return;
    }

    const inInput = isTypingTarget(e.target) || (e.target.closest && e.target.closest('[data-dt-bubble]') && !e.target.readOnly);
    spaceWasInInput = inInput;

    if (!inInput) {
      // Not in a text field — activate immediately
      e.preventDefault();
      e.stopImmediatePropagation();
      activateHandTool();
    } else {
      spaceHoldTimer = setTimeout(() => {
        spaceHoldTimer = null;
        activateHandTool();
      }, SPACE_HOLD_MS);
    }
  }

  function onKeyUp(e) {
    if (!active) return;
    if (e.key !== ' ') return;

    // Clear hold timer if it hasn't fired yet (was a quick tap in input)
    if (spaceHoldTimer) {
      clearTimeout(spaceHoldTimer);
      spaceHoldTimer = null;
      // Let the space character stay — it was just a normal keystroke
      return;
    }

    if (!spaceHeld) return;

    e.preventDefault();
    e.stopImmediatePropagation();
    spaceHeld = false;
    state.handToolActive = false;
    spaceWasInInput = false;
    document.documentElement.style.userSelect = '';
    document.documentElement.style.webkitUserSelect = '';
    if (panning) {
      endPan();
    }
    setCursorState(null);
  }

  function onMouseDown(e) {
    if (!active || !spaceHeld) return;
    if (e.button !== 0) return;

    e.preventDefault();
    e.stopPropagation();

    panning = true;
    panStartX = e.clientX;
    panStartY = e.clientY;
    panStartPanX = panX;
    panStartPanY = panY;
    setCursorState('grabbing');
  }

  function onMouseMove(e) {
    if (!active || !panning) return;

    e.preventDefault();
    e.stopPropagation();

    const dx = e.clientX - panStartX;
    const dy = e.clientY - panStartY;

    if (scale === 1) {
      // At 1x zoom, scroll the page (hand-tool feel)
      window.scrollBy(panStartX - e.clientX, panStartY - e.clientY);
      panStartX = e.clientX;
      panStartY = e.clientY;
    } else {
      // When zoomed, pan the canvas via translate
      panX = panStartPanX + dx;
      panY = panStartPanY + dy;
      applyTransform();
    }
  }

  function onMouseUp(e) {
    if (!active || !panning) return;
    e.preventDefault();
    e.stopPropagation();
    endPan();
  }

  function endPan() {
    panning = false;
    setCursorState(spaceHeld ? 'grab' : null);
  }

  function onKeyPress(e) {
    if (!active) return;
    if (spaceHeld && e.key === ' ') {
      e.preventDefault();
      e.stopImmediatePropagation();
    }
  }

  function onWindowBlur() {
    spaceHeld = false;
    state.handToolActive = false;
    document.documentElement.style.userSelect = '';
    document.documentElement.style.webkitUserSelect = '';
    if (panning) endPan();
    setCursorState(null);
  }

  // Don't hijack spacebar when the user is typing
  function isTypingTarget(el) {
    if (!el) return false;
    const tag = el.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
    if (el.isContentEditable) return true;
    return false;
  }

  var canvasZoom = {
    id: 'canvas-zoom',
    label: 'Canvas Zoom',
    enabledByDefault: true,

    init() {
      active = true;
      ensureCursorStyles();
      if (isExperimentEnabled('canvas-zoom')) ensureWrapper();

      // Wheel must be passive:false to allow preventDefault on Cmd+Scroll
      document.addEventListener('wheel', onWheel, { passive: false, capture: true });
      document.addEventListener('keydown', onKeyDown, true);
      document.addEventListener('keypress', onKeyPress, true);
      document.addEventListener('keyup', onKeyUp, true);
      document.addEventListener('mousedown', onMouseDown, true);
      document.addEventListener('mousemove', onMouseMove, true);
      document.addEventListener('mouseup', onMouseUp, true);
      window.addEventListener('blur', onWindowBlur);

      // Re-center content when window resizes while zoomed
      window.addEventListener('resize', () => {
        if (!wrapper || scale === 1) return;
        const contentW = wrapper.scrollWidth * scale;
        if (contentW < window.innerWidth) {
          panX = (window.innerWidth - contentW) / 2;
        }
        applyTransform();
      });
    },

    enable() { active = true; },
    disable() {
      active = false;
      resetTransform();
      setCursorState(null);
      spaceHeld = false;
      panning = false;
    },

    // Expose for other modules if needed
    getScale() { return scale; },
    reset() { resetTransform(); },
  };

  /**
   * DOM-Tools (minimal)
   * Drop <script src="dom-tools.js"></script> before </body> in any HTML file.
   * Activate by adding ?dom-tools to the page URL, OR by double-tapping Esc.
   */


  // --- Plugin namespace (available before boot for early-loading plugins) ---
  window.DomTools = window.DomTools || { _pendingPlugins: [] };

  let booted = false;

  function bootDomTools() {
    if (booted) return;
    booted = true;

    initHelpers();

    register(annotations);
    register(draw);
    register(moduleSpec);
    register(editMode);
    if (isExperimentEnabled('camera')) register(camera);
    register(copySelector);
    register(canvasZoom);
    if (isExperimentEnabled('move')) register(move);
    if (isExperimentEnabled('duplicate')) register(duplicate);

    renderToolbar();
    initSettings();
    boot();
    initCopyAll();
    initKeyboard();

    moduleSpec.activate();
    setActiveButton('style-modifier');

    // Wire up late-register callback (for plugins loaded after boot)
    onLateRegister((mod) => appendButton(mod));

    // Drain any plugins that loaded before boot
    drainPluginQueue();
  }

  function drainPluginQueue() {
    const pending = window.DomTools._pendingPlugins || [];
    pending.forEach(plugin => registerLate(plugin, pluginAPI));
    window.DomTools._pendingPlugins = [];
  }

  // Public plugin registration (works before or after boot)
  window.DomTools.registerPlugin = function(plugin) {
    if (booted) {
      registerLate(plugin, pluginAPI);
    } else {
      window.DomTools._pendingPlugins.push(plugin);
    }
  };

  // Expose API for plugins that want to access it after registration
  window.DomTools.api = pluginAPI;

  // Expose for SPA integration (call window.bootDomTools() from JS)
  window.bootDomTools = bootDomTools;

  if (new URLSearchParams(window.location.search).has('dom-tools')) {
    bootDomTools();
  } else {
    // Pre-boot keyboard listener: until DOM-Tools is alive, watch for a
    // double-tap of Escape and bring it up. Capture-phase so page-level
    // Escape handlers (modals, editors) can't swallow the event before us.
    // Removes itself once boot completes — keyboard.js takes over from there.
    let lastEsc = 0;
    function preBootEsc(e) {
      if (e.key !== 'Escape' || e.shiftKey) return;
      const now = Date.now();
      if (now - lastEsc < 400) {
        e.preventDefault();
        document.removeEventListener('keydown', preBootEsc, true);
        bootDomTools();
        lastEsc = 0;
        return;
      }
      lastEsc = now;
    }
    document.addEventListener('keydown', preBootEsc, true);
  }

})();
