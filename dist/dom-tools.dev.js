/**
 * DOM-Tools v1.1.0
 * Built: 2026-07-29T17:55:49.002Z
 * Drop-in design toolbar for any webpage.
 * https://github.com/luismqueral/dom-tools
 */
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
    // Stash api so activate() can access it on subsequent calls
    mod._api = api;
    modules.push(mod);
    if (isEnabled(mod.id)) {
      if (mod.init) mod.init(api);
    }
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
    toast.innerHTML = msg.replace(/\[([^\]]+)\]/g,
      '<kbd style="display:inline-block;padding:2px 6px;margin:0 2px;background:#444;border:1px solid #555;border-radius:4px;font-size:11px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-weight:600;line-height:1.3">$1</kbd>');
    toast.style.display = 'block';
    toast.style.opacity = '1';
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { toast.style.opacity = '0'; setTimeout(() => toast.style.display = 'none', 200); }, 6000);
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
      background: 'rgba(30,30,30,0.95)', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)', color: '#fff', padding: '8px 16px', borderRadius: '6px',
      fontSize: '13px', fontFamily: 'system-ui, -apple-system, sans-serif', zIndex: String(Z.toolbar), display: 'none',
      transition: 'opacity 0.2s', whiteSpace: 'nowrap', maxWidth: '90vw'
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
  tbHandle.innerHTML = '\u283F';
  Object.assign(tbHandle.style, {
    color: 'rgba(255,255,255,0.35)', fontSize: '18px', cursor: 'grab',
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
    copyBtn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M7.5 3H14.6C16.8402 3 17.9603 3 18.816 3.43597C19.5686 3.81947 20.1805 4.43139 20.564 5.18404C21 6.03969 21 7.15979 21 9.4V16.5M6.2 21H14.3C15.4201 21 15.9802 21 16.408 20.782C16.7843 20.5903 17.0903 20.2843 17.282 19.908C17.5 19.4802 17.5 18.9201 17.5 17.8V9.7C17.5 8.57989 17.5 8.01984 17.282 7.59202C17.0903 7.21569 16.7843 6.90973 16.408 6.71799C15.9802 6.5 15.4201 6.5 14.3 6.5H6.2C5.0799 6.5 4.51984 6.5 4.09202 6.71799C3.71569 6.90973 3.40973 7.21569 3.21799 7.59202C3 8.01984 3 8.57989 3 9.7V17.8C3 18.9201 3 19.4802 3.21799 19.908C3.40973 20.2843 3.71569 20.5903 4.09202 20.782C4.51984 21 5.0799 21 6.2 21Z" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
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
    document.body.appendChild(snapIndicator);
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

  /**
   * Live Markdown rendering for Text Edit mode.
   *
   * Obsidian-style "live preview": Markdown is always parsed and rendered,
   * but the token around the cursor reveals its raw syntax for editing.
   * No toggle, no animations — instant transitions.
   *
   * Supported syntax: **bold**, *italic*, ~~strike~~, `code`, [text](url)
   */

  const mdStates = new WeakMap();

  // --- State management --------------------------------------------------------

  function initMarkdownState(el, initialText) {
    const state = {
      source: initialText,
      tokens: [],
      renderedHTML: '',
      cursorOffset: initialText.length,
    };
    state.tokens = parse(state.source);
    mdStates.set(el, state);
    return state;
  }

  function getMarkdownState(el) {
    return mdStates.get(el);
  }

  function clearMarkdownState(el) {
    mdStates.delete(el);
  }

  function getCurrentText(el) {
    const s = mdStates.get(el);
    return s ? s.source : el.innerText;
  }

  // --- Parser ------------------------------------------------------------------
  // Single-pass inline tokenizer. Priority: code > bold > italic > strike > link > text

  function parse(source) {
    const tokens = [];
    let i = 0;
    let textStart = 0;

    function pushText() {
      if (i > textStart) {
        tokens.push({ type: 'text', raw: source.slice(textStart, i), content: source.slice(textStart, i), start: textStart, end: i });
      }
    }

    while (i < source.length) {
      // Inline code: `...`
      if (source[i] === '`') {
        const close = source.indexOf('`', i + 1);
        if (close !== -1) {
          pushText();
          const raw = source.slice(i, close + 1);
          tokens.push({ type: 'code', raw, content: source.slice(i + 1, close), start: i, end: close + 1 });
          i = close + 1;
          textStart = i;
          continue;
        }
      }

      // Bold: **...**
      if (source[i] === '*' && source[i + 1] === '*') {
        const close = source.indexOf('**', i + 2);
        if (close !== -1) {
          pushText();
          const raw = source.slice(i, close + 2);
          tokens.push({ type: 'bold', raw, content: source.slice(i + 2, close), start: i, end: close + 2 });
          i = close + 2;
          textStart = i;
          continue;
        }
      }

      // Strikethrough: ~~...~~
      if (source[i] === '~' && source[i + 1] === '~') {
        const close = source.indexOf('~~', i + 2);
        if (close !== -1) {
          pushText();
          const raw = source.slice(i, close + 2);
          tokens.push({ type: 'strike', raw, content: source.slice(i + 2, close), start: i, end: close + 2 });
          i = close + 2;
          textStart = i;
          continue;
        }
      }

      // Italic: *...* (but not **)
      if (source[i] === '*' && source[i + 1] !== '*') {
        const close = source.indexOf('*', i + 1);
        if (close !== -1 && source[close + 1] !== '*') {
          pushText();
          const raw = source.slice(i, close + 1);
          tokens.push({ type: 'italic', raw, content: source.slice(i + 1, close), start: i, end: close + 1 });
          i = close + 1;
          textStart = i;
          continue;
        }
      }

      // Link: [text](url)
      if (source[i] === '[') {
        const closeBracket = source.indexOf(']', i + 1);
        if (closeBracket !== -1 && source[closeBracket + 1] === '(') {
          const closeParen = source.indexOf(')', closeBracket + 2);
          if (closeParen !== -1) {
            pushText();
            const raw = source.slice(i, closeParen + 1);
            const content = source.slice(i + 1, closeBracket);
            const href = source.slice(closeBracket + 2, closeParen);
            tokens.push({ type: 'link', raw, content, href, start: i, end: closeParen + 1 });
            i = closeParen + 1;
            textStart = i;
            continue;
          }
        }
      }

      i++;
    }

    // Trailing text
    pushText();
    return tokens;
  }

  // --- Renderer ----------------------------------------------------------------

  function escapeHTML(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
  }

  const SYN = 'color:rgba(130,140,155,0.7);font-weight:normal;font-style:normal';

  function renderToken(t, index) {
    const c = escapeHTML(t.content);
    const attr = ` data-md-idx="${index}"`;
    switch (t.type) {
      case 'bold': return `<strong${attr}>${c}</strong>`;
      case 'italic': return `<em${attr}>${c}</em>`;
      case 'strike': return `<s${attr}>${c}</s>`;
      case 'code': return `<code${attr} style="background:rgba(0,0,0,0.06);padding:1px 4px;border-radius:3px;font-family:monospace;font-size:0.9em">${c}</code>`;
      case 'link': return `<a${attr} href="${escapeHTML(t.href)}" style="color:inherit;text-decoration:underline">${c}</a>`;
      default: return escapeHTML(t.raw);
    }
  }

  // Render a revealed token with dimmed syntax delimiters
  function renderRevealed(t) {
    const s = `<span style="${SYN}">`;
    const e = '</span>';
    const c = escapeHTML(t.content);
    switch (t.type) {
      case 'bold': return `${s}**${e}${c}${s}**${e}`;
      case 'italic': return `${s}*${e}${c}${s}*${e}`;
      case 'strike': return `${s}~~${e}${c}${s}~~${e}`;
      case 'code': return `${s}\`${e}${c}${s}\`${e}`;
      case 'link': return `${s}[${e}${c}${s}](${e}${escapeHTML(t.href)}${s})${e}`;
      default: return escapeHTML(t.raw);
    }
  }

  function render(tokens, cursorOffset) {
    let html = '';
    let cursorTokenIndex = -1;

    // Find which token contains the cursor
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i];
      if (cursorOffset >= t.start && cursorOffset < t.end) {
        cursorTokenIndex = i;
        break;
      }
    }
    // If cursor is at end and last token ends there, reveal it
    if (cursorTokenIndex === -1 && tokens.length > 0) {
      const last = tokens[tokens.length - 1];
      if (cursorOffset === last.end && last.type !== 'text') {
        cursorTokenIndex = tokens.length - 1;
      }
    }

    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i];
      if (t.type === 'text') {
        html += escapeHTML(t.raw);
      } else if (i === cursorTokenIndex) {
        html += renderRevealed(t);
      } else {
        html += renderToken(t, i);
      }
    }

    return { html, cursorTokenIndex };
  }

  // --- Cursor mapping ----------------------------------------------------------

  // Convert DOM cursor position to source offset.
  // Strategy: get a flat "DOM text offset" by walking text nodes, then
  // convert it to source offset using the token map (rendered tokens
  // contribute content.length in DOM but raw.length in source).
  function sourceOffsetFromDOM(el) {
    const sel = window.getSelection();
    if (!sel.rangeCount) return 0;
    const range = sel.getRangeAt(0);
    const node = range.startContainer;
    const nodeOffset = range.startOffset;

    const mdState = mdStates.get(el);
    if (!mdState) return 0;

    // Step 1: compute flat DOM text offset (counting <br> as 1 char each)
    let domOffset = 0;

    if (node === el) {
      // Selection on element itself — child index
      for (let i = 0; i < nodeOffset && i < el.childNodes.length; i++) {
        const child = el.childNodes[i];
        if (child.nodeName === 'BR') domOffset += 1;
        else domOffset += (child.textContent || '').length;
      }
    } else {
      // Walk all nodes (text + elements) in tree order to count offset
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_ALL, null);
      let current = walker.nextNode();
      while (current) {
        if (current === node) {
          domOffset += nodeOffset;
          break;
        }
        if (current.nodeName === 'BR') {
          domOffset += 1;
        } else if (current.nodeType === 3) {
          domOffset += current.textContent.length;
        }
        // Skip element nodes themselves (only count their text children)
        if (current.nodeType === 1 && current.nodeName !== 'BR') ;
        current = walker.nextNode();
      }
    }

    // Step 2: convert DOM offset to source offset using tokens
    return domOffsetToSource(domOffset, mdState.tokens, mdState.cursorOffset);
  }

  // Map a flat DOM text offset to a source offset.
  // In the rendered DOM:
  //   - Revealed token (cursor inside): shows raw text → maps 1:1
  //   - Rendered token: shows only content → occupies content.length in DOM
  //     but raw.length in source
  //   - Text tokens: map 1:1
  function domOffsetToSource(domOffset, tokens, cursorOffset) {
    let domPos = 0;
    let sourcePos = 0;

    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i];
      // Must match render() reveal logic: cursorOffset >= start && < end
      const isRevealed = t.type !== 'text' &&
        cursorOffset >= t.start && cursorOffset < t.end;
      // DOM length of this token
      const domLen = (t.type === 'text' || isRevealed) ? t.raw.length : t.content.length;

      if (domOffset < domPos + domLen) {
        // Cursor is within this token
        const localOffset = domOffset - domPos;
        if (t.type === 'text' || isRevealed) {
          return t.start + localOffset;
        } else {
          // Inside rendered content — map to after opening delimiter
          const delimLen = t.raw.indexOf(t.content);
          return t.start + delimLen + localOffset;
        }
      }

      domPos += domLen;
      sourcePos = t.end;
    }

    return sourcePos;
  }

  // Place cursor at a given source offset, accounting for rendered HTML
  function placeCursorAtSourceOffset(el, sourceOffset, tokens) {
    // Convert source offset to DOM text offset
    const targetDOMOffset = sourceToDomOffset(sourceOffset, tokens);

    // Walk all nodes (text + BR) to place the cursor
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_ALL, null);
    let accumulated = 0;
    let current = walker.nextNode();
    while (current) {
      if (current.nodeName === 'BR') {
        if (accumulated === targetDOMOffset) {
          // Place cursor right before the BR
          const sel = window.getSelection();
          const range = document.createRange();
          const parent = current.parentNode;
          const idx = Array.from(parent.childNodes).indexOf(current);
          range.setStart(parent, idx + 1);
          range.collapse(true);
          sel.removeAllRanges();
          sel.addRange(range);
          return;
        }
        accumulated += 1;
      } else if (current.nodeType === 3) {
        const len = current.textContent.length;
        if (accumulated + len >= targetDOMOffset) {
          const sel = window.getSelection();
          const range = document.createRange();
          range.setStart(current, targetDOMOffset - accumulated);
          range.collapse(true);
          sel.removeAllRanges();
          sel.addRange(range);
          return;
        }
        accumulated += len;
      }
      current = walker.nextNode();
    }

    // Fallback: place at end
    const sel = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    sel.removeAllRanges();
    sel.addRange(range);
  }

  // Convert source offset to the flat DOM text offset.
  // The render was done with `sourceOffset` as the cursorOffset,
  // so the token containing sourceOffset is revealed (shown raw in DOM).
  // Must match the render function's reveal logic: cursorOffset >= start && < end.
  function sourceToDomOffset(sourceOffset, tokens) {
    let domOffset = 0;

    for (const t of tokens) {
      // Is this token revealed? Must match render() logic exactly.
      const isRevealed = t.type !== 'text' &&
        sourceOffset >= t.start && sourceOffset < t.end;

      if (sourceOffset >= t.start && sourceOffset < t.end) {
        // Cursor is within this token — add local offset
        domOffset += (sourceOffset - t.start);
        return domOffset;
      }

      // Past this token — add its full DOM contribution
      const domLen = (t.type === 'text' || isRevealed) ? t.raw.length : t.content.length;
      domOffset += domLen;
    }

    return domOffset;
  }

  // --- Source mutation from InputEvent ------------------------------------------

  function applyInputToSource(state, inputType, data, cursorOffset, event, selLength = 0) {
    const src = state.source;
    // End of selection range — for insert operations, selected text gets replaced
    const selEnd = cursorOffset + selLength;

    switch (inputType) {
      case 'insertText':
        state.source = src.slice(0, cursorOffset) + (data || '') + src.slice(selEnd);
        state.cursorOffset = cursorOffset + (data || '').length;
        break;
      case 'insertParagraph':
      case 'insertLineBreak':
        state.source = src.slice(0, cursorOffset) + '\n' + src.slice(selEnd);
        state.cursorOffset = cursorOffset + 1;
        break;
      case 'deleteContentBackward':
        if (selLength > 0) {
          state.source = src.slice(0, cursorOffset) + src.slice(selEnd);
          state.cursorOffset = cursorOffset;
        } else if (cursorOffset > 0) {
          state.source = src.slice(0, cursorOffset - 1) + src.slice(cursorOffset);
          state.cursorOffset = cursorOffset - 1;
        }
        break;
      case 'deleteContentForward':
        if (selLength > 0) {
          state.source = src.slice(0, cursorOffset) + src.slice(selEnd);
          state.cursorOffset = cursorOffset;
        } else if (cursorOffset < src.length) {
          state.source = src.slice(0, cursorOffset) + src.slice(cursorOffset + 1);
          state.cursorOffset = cursorOffset;
        }
        break;
      case 'deleteWordBackward': {
        if (selLength > 0) {
          state.source = src.slice(0, cursorOffset) + src.slice(selEnd);
          state.cursorOffset = cursorOffset;
        } else {
          let pos = cursorOffset - 1;
          while (pos > 0 && src[pos - 1] === ' ') pos--;
          while (pos > 0 && src[pos - 1] !== ' ') pos--;
          state.source = src.slice(0, pos) + src.slice(cursorOffset);
          state.cursorOffset = pos;
        }
        break;
      }
      case 'deleteWordForward': {
        if (selLength > 0) {
          state.source = src.slice(0, cursorOffset) + src.slice(selEnd);
          state.cursorOffset = cursorOffset;
        } else {
          let pos = cursorOffset;
          while (pos < src.length && src[pos] !== ' ') pos++;
          while (pos < src.length && src[pos] === ' ') pos++;
          state.source = src.slice(0, cursorOffset) + src.slice(pos);
          state.cursorOffset = cursorOffset;
        }
        break;
      }
      case 'insertFromPaste':
      case 'insertFromDrop': {
        const text = event && event.dataTransfer
          ? event.dataTransfer.getData('text/plain')
          : (data || '');
        state.source = src.slice(0, cursorOffset) + text + src.slice(selEnd);
        state.cursorOffset = cursorOffset + text.length;
        break;
      }
      case 'deleteByCut': {
        // For cut with selection, we need the selection bounds.
        // The cursorOffset represents the start; we estimate end from
        // the selected text length via the event's target ranges.
        const sel = window.getSelection();
        if (sel.rangeCount && !sel.isCollapsed) {
          const selText = sel.toString();
          // Find the selection in source near the cursor
          const idx = src.indexOf(selText, Math.max(0, cursorOffset - selText.length));
          if (idx !== -1) {
            state.source = src.slice(0, idx) + src.slice(idx + selText.length);
            state.cursorOffset = idx;
            break;
          }
        }
        state.cursorOffset = cursorOffset;
        break;
      }
      case 'historyUndo':
      case 'historyRedo':
        // Let browser handle or ignore — we don't support undo yet
        state.cursorOffset = cursorOffset;
        break;
      default:
        state.cursorOffset = cursorOffset;
        break;
    }
  }

  /**
   * Settings panel — full-screen modal with tabbed sections.
   *
   * Tabs: General | Tools | Plugins | About
   * Each experiment has a `category` that determines which tab it appears in.
   * Click the gear → modal with tabs. Esc or backdrop click closes.
   */


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
    { id: 'markdown-edit', label: 'Markdown editing', category: 'general', description: 'Live Markdown preview when editing text (bold, italic, strike, code, links).', default: false },
    { id: 'element-labels', label: 'Element labels', category: 'general', description: 'Show tag name labels above hovered and selected elements.', default: true },
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
    {
      id: 'camera',
      label: 'Screenshot resolution',
      category: 'general',
      description: 'Quality for screenshots (Cmd+Shift+S and camera tool).',
      default: true,
      noToggle: true,
      options: {
        id: 'resolution',
        label: 'Scale',
        choices: [
          { value: '1', label: '1x (fast, small file)' },
          { value: '2', label: '2x' },
          { value: '3', label: '3x (high-res)' },
          { value: 'auto', label: 'Auto (device pixel ratio)' },
        ],
        default: '3',
      },
    },
    // Plugins
    { id: 'hd-capture', label: 'HD Capture', category: 'plugins', description: 'Tiled rendering for sharp full-page screenshots on very tall pages.', default: true },
    { id: 'dev-panel', label: 'Dev Panel', category: 'plugins', description: 'Floating instrumentation panel showing live state, key events, and animations.', default: false },
    { id: 'inspector-panel', label: 'Inspector Panel', category: 'plugins', description: 'Shows computed styles and CSS tokens for the selected element.', default: false },
    { id: 'inspector-panel-nyt', label: 'Inspector (NYT)', category: 'plugins', description: 'NYT-CSS token audit inspector with hardcoded token families.', default: false },
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

  // --- UI Helpers ---
  function el(tag, styles, text) {
    const e = document.createElement(tag);
    if (styles) Object.assign(e.style, styles);
    if (text) e.textContent = text;
    return e;
  }

  let _refreshHint = null;
  function showRefreshHint() {
    if (_refreshHint) return;
    _refreshHint = document.createElement('button');
    _refreshHint.type = 'button';
    Object.assign(_refreshHint.style, {
      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
      width: '100%', padding: '8px 12px', marginBottom: '14px',
      background: 'rgba(251,191,36,0.12)',
      border: '1px solid rgba(251,191,36,0.3)',
      borderRadius: '6px', fontSize: '11px', color: '#fbbf24',
      cursor: 'pointer', transition: 'background 0.1s',
      fontFamily: 'inherit',
    });
    _refreshHint.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 2v6h-6"/><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M3 22v-6h6"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/></svg>Refresh page for changes to take effect';
    _refreshHint.addEventListener('mouseenter', () => { _refreshHint.style.background = 'rgba(251,191,36,0.2)'; });
    _refreshHint.addEventListener('mouseleave', () => { _refreshHint.style.background = 'rgba(251,191,36,0.12)'; });
    _refreshHint.addEventListener('click', () => { location.reload(); });
    // Insert at top of card, after header
    const card = _popover && _popover.firstElementChild;
    if (card && card.children[1]) {
      card.insertBefore(_refreshHint, card.children[1]);
    }
  }

  // --- Experiment toggle row (reused across tabs) ---
  function buildExperimentRow(exp) {
    const wrap = el('div', { marginBottom: '10px' });

    // noToggle: just show label + options, no checkbox
    if (exp.noToggle) {
      const labelWrap = el('div', { padding: '6px 0' });
      const labelRow = el('span', { display: 'flex', alignItems: 'center', gap: '6px', fontWeight: '500', color: '#ddd', fontSize: '13px' });
      labelRow.textContent = exp.label;
      labelWrap.appendChild(labelRow);
      labelWrap.appendChild(el('span', { display: 'block', fontSize: '11px', color: '#888', marginTop: '3px' }, exp.description));
      wrap.appendChild(labelWrap);
      if (exp.options) wrap.appendChild(buildExperimentOptions(exp));
      return wrap;
    }

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
    const labelRow = el('span', { display: 'flex', alignItems: 'center', gap: '6px', fontWeight: '500' });
    labelRow.textContent = exp.label;
    if (exp.beta) {
      const badge = el('span', {
        fontSize: '9px', fontWeight: '700', textTransform: 'uppercase',
        letterSpacing: '0.5px', padding: '1px 5px', borderRadius: '3px',
        background: 'rgba(251,191,36,0.15)', color: '#fbbf24', lineHeight: '1.4',
      }, 'Beta');
      labelRow.appendChild(badge);
    }
    labelWrap.appendChild(labelRow);
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
      showRefreshHint();
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
    // // Color swatches (disabled — buggy)
    // container.appendChild(el('div', {
    //   fontSize: '11px', fontWeight: '600', textTransform: 'uppercase',
    //   letterSpacing: '1px', color: '#888', marginBottom: '10px',
    // }, 'Selection color'));
    // container.appendChild(buildColorSwatches());

    // General experiments
    container.appendChild(el('div', {
      fontSize: '11px', fontWeight: '600', textTransform: 'uppercase',
      letterSpacing: '1px', color: '#888', marginBottom: '12px',
    }, 'Behavior'));

    EXPERIMENT_DEFS.filter(e => e.category === 'general').forEach(exp => {
      container.appendChild(buildExperimentRow(exp));
    });
  }

  // --- Tab: Tools ---
  function buildToolsTab(container) {
    container.appendChild(el('div', {
      fontSize: '11px', color: '#666', marginBottom: '16px',
    }, 'Additional tools that add new capabilities to the toolbar.'));

    EXPERIMENT_DEFS.filter(e => e.category === 'tools').forEach(exp => {
      container.appendChild(buildExperimentRow(exp));
    });
  }

  // --- Tab: Plugins ---
  function buildPluginsTab(container) {
    container.appendChild(el('div', {
      fontSize: '11px', color: '#666', marginBottom: '16px',
    }, 'External plugins loaded alongside DOM-Tools. Enable to show their toolbar button.'));

    EXPERIMENT_DEFS.filter(e => e.category === 'plugins').forEach(exp => {
      container.appendChild(buildExperimentRow(exp));
    });
  }

  // --- Tab: About ---
  function buildAboutTab(container) {
    // Version + build date
    const version = el('div', { marginBottom: '20px' });
    version.appendChild(el('div', { fontSize: '14px', fontWeight: '600', color: '#fff', marginBottom: '4px' }, 'DOM-Tools'));
    const buildDate = "2026-07-29T17:55:49.002Z" ;
    const dateLabel = new Date(buildDate).toLocaleString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) ;
    version.appendChild(el('div', { fontSize: '11px', color: '#888' }, `Release: ${dateLabel}`));
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

    const ghLink = document.createElement('a');
    ghLink.href = 'https://github.com/luismqueral/dom-tools';
    ghLink.target = '_blank';
    ghLink.rel = 'noopener';
    ghLink.textContent = 'GitHub';
    Object.assign(ghLink.style, {
      display: 'block', fontSize: '12px', color: getSelectionColor(),
      textDecoration: 'none', padding: '4px 0',
    });
    ghLink.addEventListener('mouseenter', () => { ghLink.style.textDecoration = 'underline'; });
    ghLink.addEventListener('mouseleave', () => { ghLink.style.textDecoration = 'none'; });
    container.appendChild(ghLink);

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
      display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
      fontFamily: 'system-ui, sans-serif', fontSize: '12px', color: '#eee',
      boxSizing: 'border-box', padding: '80px 40px 40px',
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
      _refreshHint = null;
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

  // --- Drag-to-select state ---
  let dragActive = false, dragStartX = 0, dragStartY = 0, didDrag = false;
  let marqueeBox = null;

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
    html.dt-comment-active,
    html.dt-comment-active body,
    html.dt-comment-active body *:not(${inspectorUiSelector}) {
      user-select: none !important;
      -webkit-user-select: none !important;
      cursor: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='20' height='20' viewBox='0 0 24 24' fill='none'%3E%3Cdefs%3E%3Cfilter id='s' x='-20%25' y='-20%25' width='140%25' height='140%25'%3E%3CfeDropShadow dx='0' dy='1' stdDeviation='0.5' flood-opacity='0.3'/%3E%3C/filter%3E%3C/defs%3E%3Cg transform='translate(24,0) scale(-1,1)' filter='url(%23s)'%3E%3Cpath d='M3.41345 10.7445C2.81811 10.513 2.52043 10.3972 2.43353 10.2304C2.35819 10.0858 2.35809 9.91354 2.43326 9.76886C2.51997 9.60195 2.8175 9.48584 3.41258 9.25361L20.3003 2.66327C20.8375 2.45364 21.1061 2.34883 21.2777 2.40616C21.4268 2.45596 21.5437 2.57292 21.5935 2.72197C21.6509 2.8936 21.5461 3.16219 21.3364 3.69937L14.7461 20.5871C14.5139 21.1822 14.3977 21.4797 14.2308 21.5664C14.0862 21.6416 13.9139 21.6415 13.7693 21.5662C13.6025 21.4793 13.4867 21.1816 13.2552 20.5862L10.6271 13.8282C10.5801 13.7074 10.5566 13.647 10.5203 13.5961C10.4881 13.551 10.4487 13.5115 10.4036 13.4794C10.3527 13.4431 10.2923 13.4196 10.1715 13.3726L3.41345 10.7445Z' fill='%23000' stroke='%23fff' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/g%3E%3C/svg%3E") 3 1, default !important;
    }
    @supports (-webkit-appearance: none) and (not (-moz-appearance: none)) {
      @supports (-webkit-hyphens: none) {
        html.dt-comment-active,
        html.dt-comment-active body,
        html.dt-comment-active body *:not(${inspectorUiSelector}) {
          cursor: default !important;
        }
      }
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
    html.dt-comment-active [data-dt-bubble] textarea[readonly] {
      cursor: grab !important;
    }
    html.dt-comment-active [data-dt-bubble] textarea:not([readonly]) {
      cursor: text !important;
    }
    html.dt-comment-active [data-dt-bubble] [aria-label="Drag to move"] {
      cursor: grab !important;
    }
    html.dt-comment-active [data-dt-bubble] [data-dt-close] {
      cursor: pointer !important;
    }
    html.dt-bubble-dragging,
    html.dt-bubble-dragging *,
    [data-dt-bubble].dt-dragging,
    [data-dt-bubble].dt-dragging * {
      cursor: grabbing !important;
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
  function positionTagLabel(lbl, el) {
    const r = el.getBoundingClientRect();
    const labelH = lbl.offsetHeight || 14;
    const left = r.left + window.scrollX;
    const top = r.top + window.scrollY - labelH - 2;
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
    if (!isExperimentEnabled('element-labels')) {
      hideTagLabels();
      return;
    }
    const want = desiredLabelEls();
    Array.from(tagLabels.keys()).forEach(el => {
      if (!want.has(el)) removeTagLabel(el);
    });
    const color = getSelectionColor();
    want.forEach(el => {
      let entry = tagLabels.get(el);
      if (!entry) {
        entry = { lbl: createTagLabel() };
        tagLabels.set(el, entry);
      }
      entry.lbl.textContent = elementLabelText(el);
      entry.lbl.style.background = color;
      positionTagLabel(entry.lbl, el);
    });
  }

  function repositionAllTagLabels() {
    tagLabels.forEach((entry, el) => positionTagLabel(entry.lbl, el));
  }

  function avoidLabelsUnderCursor() {}

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
    refreshTagLabels();
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

  // --- Double-Shift spacing inspection -------------------------------------
  // Double-tap Shift while hovering to toggle padding (green) and margin
  // (orange) overlays on the hovered element. Double-tap again to dismiss.

  let spacingContainer = null;
  let spacingEl = null;
  let spacingActive = false;
  let lastShiftUp = 0;
  const SHIFT_DOUBLE_TAP_MS = 350;

  const SPACING_PADDING_COLOR = 'rgba(144, 238, 144, 0.4)';
  const SPACING_MARGIN_COLOR = 'rgba(255, 165, 0, 0.35)';

  // --- CSS token resolution helpers -------------------------------------------

  const TOKEN_RE = /var\((--[\w-]+)/;

  function extractToken(value) {
    if (!value) return null;
    const m = value.match(TOKEN_RE);
    return m ? m[1] : null;
  }

  function splitShorthandValue(value) {
    const parts = [];
    let current = '', depth = 0;
    for (let i = 0; i < value.length; i++) {
      const ch = value[i];
      if (ch === '(') { depth++; current += ch; }
      else if (ch === ')') { depth--; current += ch; }
      else if (/\s/.test(ch) && depth === 0) {
        if (current) { parts.push(current); current = ''; }
      } else { current += ch; }
    }
    if (current) parts.push(current);
    return parts;
  }

  function expandBoxShorthand(value) {
    const parts = splitShorthandValue(value);
    let top, right, bottom, left;
    if (parts.length === 1) { top = right = bottom = left = parts[0]; }
    else if (parts.length === 2) { top = bottom = parts[0]; right = left = parts[1]; }
    else if (parts.length === 3) { top = parts[0]; right = left = parts[1]; bottom = parts[2]; }
    else { top = parts[0]; right = parts[1]; bottom = parts[2]; left = parts[3]; }
    return { top, right, bottom, left };
  }

  function collectRuleTokens(style, el, tokens) {
    // Check shorthand first
    for (const prop of ['padding', 'margin']) {
      const raw = style.getPropertyValue(prop);
      if (raw && TOKEN_RE.test(raw)) {
        const expanded = expandBoxShorthand(raw);
        const prefix = prop === 'padding' ? 'padding' : 'margin';
        tokens[prefix + 'Top'] = extractToken(expanded.top);
        tokens[prefix + 'Right'] = extractToken(expanded.right);
        tokens[prefix + 'Bottom'] = extractToken(expanded.bottom);
        tokens[prefix + 'Left'] = extractToken(expanded.left);
      }
    }
    // Longhand overrides shorthand
    for (const [cssProp, key] of [
      ['padding-top', 'paddingTop'], ['padding-right', 'paddingRight'],
      ['padding-bottom', 'paddingBottom'], ['padding-left', 'paddingLeft'],
      ['margin-top', 'marginTop'], ['margin-right', 'marginRight'],
      ['margin-bottom', 'marginBottom'], ['margin-left', 'marginLeft'],
    ]) {
      const raw = style.getPropertyValue(cssProp);
      if (raw && TOKEN_RE.test(raw)) {
        tokens[key] = extractToken(raw);
      }
    }
  }

  function processRules(rules, el, tokens) {
    for (let i = 0; i < rules.length; i++) {
      const rule = rules[i];
      if (rule instanceof CSSMediaRule) {
        if (window.matchMedia(rule.conditionText).matches) {
          processRules(rule.cssRules, el, tokens);
        }
      } else if (rule instanceof CSSStyleRule) {
        try { if (!el.matches(rule.selectorText)) continue; } catch (_) { continue; }
        collectRuleTokens(rule.style, el, tokens);
      }
    }
  }

  function resolveTokensForElement(el) {
    const tokens = {
      paddingTop: null, paddingRight: null, paddingBottom: null, paddingLeft: null,
      marginTop: null, marginRight: null, marginBottom: null, marginLeft: null,
    };
    // Iterate stylesheets (later rules / sheets override earlier — cascade approximation)
    for (let s = 0; s < document.styleSheets.length; s++) {
      let rules;
      try { rules = document.styleSheets[s].cssRules; } catch (_) { continue; }
      if (!rules) continue;
      processRules(rules, el, tokens);
    }
    // Inline styles always win
    if (el.style) collectRuleTokens(el.style, el, tokens);
    return tokens;
  }

  // --- Spacing overlay rendering -----------------------------------------------

  function ensureSpacingContainer() {
    if (spacingContainer) return;
    spacingContainer = document.createElement('div');
    spacingContainer.setAttribute('data-dt-spacing-overlay', '');
    Object.assign(spacingContainer.style, {
      position: 'fixed', top: '0', left: '0',
      width: '100%', height: '100%',
      pointerEvents: 'none',
      zIndex: String(Z.badge - 3),
    });
    document.body.appendChild(spacingContainer);
    inspectorUI.add(spacingContainer);
  }

  const spacingLabels = [];

  const LABEL_BG_PADDING = 'rgba(30, 90, 50, 0.9)';
  const LABEL_BG_MARGIN = 'rgba(140, 70, 0, 0.9)';

  function addSpacingBox(x, y, w, h, color, label, tokenName, isPadding) {
    if (w <= 0 || h <= 0) return;
    const d = document.createElement('div');
    Object.assign(d.style, {
      position: 'fixed',
      top: y + 'px', left: x + 'px',
      width: w + 'px', height: h + 'px',
      background: color,
    });
    spacingContainer.appendChild(d);
    // Queue label to be rendered in a second pass on top of all boxes
    if (label > 0 && (w >= 14 || h >= 14)) {
      const showToken = (w >= 20 || h >= 20) ? (tokenName || null) : null;
      const bg = isPadding ? LABEL_BG_PADDING : LABEL_BG_MARGIN;
      spacingLabels.push({ x: x + w / 2, y: y + h / 2, value: Math.round(label), token: showToken, bg });
    }
  }

  function flushSpacingLabels() {
    spacingLabels.forEach(({ x, y, value, token, bg }) => {
      const lbl = document.createElement('span');
      Object.assign(lbl.style, {
        position: 'fixed',
        top: y + 'px', left: x + 'px',
        transform: 'translate(-50%, -50%)',
        font: '9px/1 "IBM Plex Mono", ui-monospace, Menlo, monospace',
        color: '#fff',
        background: bg,
        padding: '2px 4px', borderRadius: '2px',
        whiteSpace: 'nowrap',
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        gap: '1px',
      });
      if (token) {
        const tokSpan = document.createElement('span');
        tokSpan.textContent = token;
        lbl.appendChild(tokSpan);
        const valSpan = document.createElement('span');
        valSpan.textContent = value;
        Object.assign(valSpan.style, { fontSize: '7px', opacity: '0.7' });
        lbl.appendChild(valSpan);
      } else {
        const valSpan = document.createElement('span');
        valSpan.textContent = value;
        lbl.appendChild(valSpan);
      }
      spacingContainer.appendChild(lbl);
    });
    spacingLabels.length = 0;
  }

  function showSpacingOverlay(el, force) {
    if (spacingEl === el && !force) return;
    ensureSpacingContainer();
    spacingContainer.innerHTML = '';
    spacingEl = el;

    const cs = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    const p = (v) => parseFloat(v) || 0;

    const mt = p(cs.marginTop), mr = p(cs.marginRight);
    const mb = p(cs.marginBottom), ml = p(cs.marginLeft);
    const pt = p(cs.paddingTop), pr = p(cs.paddingRight);
    const pb = p(cs.paddingBottom), pl = p(cs.paddingLeft);

    // Padding (inside the element border)
    const bt = p(cs.borderTopWidth), blw = p(cs.borderLeftWidth);
    const br = p(cs.borderRightWidth), bb = p(cs.borderBottomWidth);

    const innerTop = rect.top + bt;
    const innerLeft = rect.left + blw;
    const innerW = rect.width - blw - br;
    const innerH = rect.height - bt - bb;

    // Resolve CSS custom property tokens for this element
    const tokens = resolveTokensForElement(el);

    // Padding boxes
    if (pt > 0) addSpacingBox(innerLeft, innerTop, innerW, pt, SPACING_PADDING_COLOR, pt, tokens.paddingTop, true);
    if (pb > 0) addSpacingBox(innerLeft, innerTop + innerH - pb, innerW, pb, SPACING_PADDING_COLOR, pb, tokens.paddingBottom, true);
    if (pl > 0) addSpacingBox(innerLeft, innerTop + pt, pl, innerH - pt - pb, SPACING_PADDING_COLOR, pl, tokens.paddingLeft, true);
    if (pr > 0) addSpacingBox(innerLeft + innerW - pr, innerTop + pt, pr, innerH - pt - pb, SPACING_PADDING_COLOR, pr, tokens.paddingRight, true);

    // Margin boxes
    if (mt > 0) addSpacingBox(rect.left, rect.top - mt, rect.width, mt, SPACING_MARGIN_COLOR, mt, tokens.marginTop, false);
    if (mb > 0) addSpacingBox(rect.left, rect.bottom, rect.width, mb, SPACING_MARGIN_COLOR, mb, tokens.marginBottom, false);
    if (ml > 0) addSpacingBox(rect.left - ml, rect.top - mt, ml, rect.height + mt + mb, SPACING_MARGIN_COLOR, ml, tokens.marginLeft, false);
    if (mr > 0) addSpacingBox(rect.right, rect.top - mt, mr, rect.height + mt + mb, SPACING_MARGIN_COLOR, mr, tokens.marginRight, false);

    // Render labels in second pass so they sit above all colored boxes
    flushSpacingLabels();
  }

  function clearSpacingOverlay() {
    if (!spacingContainer) return;
    spacingContainer.innerHTML = '';
    spacingEl = null;
    spacingActive = false;
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
    // Clear the spacing target (boxes) but preserve spacingActive state
    // so the next hovered element gets spacing too
    if (spacingContainer) { spacingContainer.innerHTML = ''; spacingEl = null; }
  }

  function onMove$1(e) {
    if (!activeMode$1) return;
    // Suppress hover while hand tool, inline editing, dragging, or modifier key (zoom) is active
    if (state.handToolActive || editingEl || didDrag || e.metaKey || e.ctrlKey) {
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
    if (el === hoveredEl$1) {
      if (spacingActive) showSpacingOverlay(hoveredEl$1);
      return;
    }
    clearHover$1();
    // Don't hover-paint elements that are already selected.
    if (selected.find(s => s.el === el)) return;
    hoveredEl$1 = el;
    ensureOrig(el);

    const color = getSelectionColor();
    el.style.outline = '2.5px solid ' + withAlpha(color, 0.55);
    el.style.backgroundColor = getOrigBackground(el);
    refreshTagLabels();
    if (spacingActive) showSpacingOverlay(el);
  }

  // --- Drag-to-select (marquee) --------------------------------------------
  function initMarquee() {
    marqueeBox = document.createElement('div');
    Object.assign(marqueeBox.style, {
      position: 'fixed', pointerEvents: 'none', display: 'none',
      border: '2px dashed ' + getSelectionColor(),
      background: withAlpha(getSelectionColor(), 0.06),
      zIndex: String(Z.tooltip), borderRadius: '2px',
    });
    document.body.appendChild(marqueeBox);
    inspectorUI.add(marqueeBox);
  }

  function getElementsInRect(rect) {
    const els = [];
    for (const el of document.querySelectorAll('*')) {
      if (isInspectorUI(el) || el === document.body || el === document.documentElement) continue;
      if (el.offsetParent === null && getComputedStyle(el).position !== 'fixed') continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (r.right > rect.left && r.left < rect.right &&
          r.bottom > rect.top && r.top < rect.bottom) {
        els.push(el);
      }
    }
    // Keep only leaf elements — remove any el that contains another match
    return els.filter(el => !els.some(other => other !== el && el.contains(other)));
  }

  function onMouseDown$3(e) {
    if (!activeMode$1) return;
    if (state.handToolActive) return;
    if (isInspectorUI(e.target)) return;
    if (editingEl && (e.target === editingEl || editingEl.contains(e.target))) return;
    if (e.button !== 0) return;

    // Prevent link navigation and text-selection while selecting elements
    e.preventDefault();

    // Clicking outside the editing element — force exit edit mode
    if (editingEl) editingEl.blur();

    dragActive = true;
    didDrag = false;
    dragStartX = e.clientX;
    dragStartY = e.clientY;
  }

  let dragPreviewEls = [];

  function onDragMove(e) {
    if (!dragActive) return;
    const dx = Math.abs(e.clientX - dragStartX);
    const dy = Math.abs(e.clientY - dragStartY);
    if (dx > 4 || dy > 4) {
      didDrag = true;
      clearHover$1();
      const x = Math.min(e.clientX, dragStartX);
      const y = Math.min(e.clientY, dragStartY);
      Object.assign(marqueeBox.style, {
        display: 'block', left: x + 'px', top: y + 'px',
        width: dx + 'px', height: dy + 'px',
      });
      // Live preview: highlight elements inside the marquee
      const rect = { left: x, top: y, right: x + dx, bottom: y + dy };
      const nowInside = getElementsInRect(rect);
      // Remove highlight from elements no longer in rect
      for (const el of dragPreviewEls) {
        if (!nowInside.includes(el) && !selected.some(s => s.el === el)) {
          el.style.outline = getOrigOutline(el);
          el.style.backgroundColor = getOrigBackground(el);
        }
      }
      // Add highlight to new elements in rect
      const color = getSelectionColor();
      for (const el of nowInside) {
        if (!selected.some(s => s.el === el)) {
          ensureOrig(el);
          el.style.outline = '2px solid ' + color;
          el.style.backgroundColor = withAlpha(color, 0.05);
        }
      }
      dragPreviewEls = nowInside;
    }
  }

  function onMouseUp$3(e) {
    if (!dragActive) return;
    dragActive = false;

    if (didDrag) {
      // Clear live preview highlights
      for (const el of dragPreviewEls) {
        if (!selected.some(s => s.el === el)) {
          el.style.outline = getOrigOutline(el);
          el.style.backgroundColor = getOrigBackground(el);
        }
      }
      dragPreviewEls = [];

      const rect = {
        left: Math.min(e.clientX, dragStartX),
        top: Math.min(e.clientY, dragStartY),
        right: Math.max(e.clientX, dragStartX),
        bottom: Math.max(e.clientY, dragStartY),
      };
      marqueeBox.style.display = 'none';
      const els = getElementsInRect(rect);
      if (els.length) {
        if (!e.shiftKey) deselectAll();
        for (const el of els) {
          if (selected.some(s => s.el === el)) continue;
          selected.push(buildEntry(el));
          applyOutline(el);
        }
        syncEditor();
      }
      didDrag = false;
      return;
    }

    // No drag — treat as click
    didDrag = false;
    const el = e.target;
    if (isInspectorUI(el)) return;
    if (el === document.body || el === document.documentElement) {
      if (selected.length) clearSelection();
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

    // Already editing this element — let browser handle word-selection
    if (el === editingEl || el.closest('[data-dt-allow-select]')) return;

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

    const useMarkdown = isExperimentEnabled('markdown-edit');

    function restoreEditStyle() {
      el.style.outline = '2px solid ' + color;
      el.style.backgroundColor = withAlpha(color, 0.08);
    }

    // Focus, select all text, and place caret after a tick (let the bubble close first)
    setTimeout(() => {
      el.focus();
      const sel = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(el);
      sel.removeAllRanges();
      sel.addRange(range);
    }, 0);

    // Shared exit logic
    function exitEditBase() {
      el.contentEditable = 'false';
      el.removeAttribute('data-dt-allow-select');
      el.style.cursor = '';
      document.documentElement.classList.remove('dt-inline-editing');
      editingEl = null;
      evaluateAnnotation(el);
      applyOutline(el);
    }

    if (!useMarkdown) {
      // Plain-text editing path
      const onInput = () => {
        setElementText(el, originalText, originalClasses);
        restoreEditStyle();
      };
      const onKeyDown = (ev) => {
        if (ev.key === 'Escape') { ev.preventDefault(); el.blur(); }
      };
      el.addEventListener('input', onInput);
      el.addEventListener('keydown', onKeyDown, true);
      function exitEdit() {
        el.removeEventListener('blur', exitEdit);
        el.removeEventListener('input', onInput);
        el.removeEventListener('keydown', onKeyDown, true);
        exitEditBase();
      }
      el.addEventListener('blur', exitEdit);
      return;
    }

    // --- Markdown editing path ---
    const mdState = initMarkdownState(el, originalText);
    const { html } = render(mdState.tokens, mdState.cursorOffset);
    mdState.renderedHTML = html;
    el.innerHTML = html;

    let composing = false;

    // --- beforeinput: intercept all edits ---
    function onBeforeInput(e) {
      if (composing) return;
      const sel = window.getSelection();
      const selLength = (sel.rangeCount && !sel.isCollapsed) ? sel.toString().length : 0;
      e.preventDefault();

      const cursorOffset = sourceOffsetFromDOM(el);
      applyInputToSource(mdState, e.inputType, e.data, cursorOffset, e, selLength);

      mdState.tokens = parse(mdState.source);
      const result = render(mdState.tokens, mdState.cursorOffset);
      if (result.html !== mdState.renderedHTML) {
        mdState.renderedHTML = result.html;
        el.innerHTML = result.html;
      }
      placeCursorAtSourceOffset(el, mdState.cursorOffset, mdState.tokens);

      setElementText(el, originalText, originalClasses);
      restoreEditStyle();
    }

    // --- Cursor movement re-rendering ---
    function onCursorMove() {
      if (composing) return;
      if (!el.contains(document.activeElement || document.getSelection()?.anchorNode)) return;
      const newOffset = sourceOffsetFromDOM(el);
      if (newOffset === mdState.cursorOffset) return;
      mdState.cursorOffset = newOffset;
      mdState.tokens = parse(mdState.source);
      const result = render(mdState.tokens, mdState.cursorOffset);
      if (result.html !== mdState.renderedHTML) {
        mdState.renderedHTML = result.html;
        el.innerHTML = result.html;
        placeCursorAtSourceOffset(el, mdState.cursorOffset, mdState.tokens);
      }
    }

    // --- Formatting shortcuts (Cmd+B, Cmd+I, Cmd+K) ---
    function onEditKey(ev) {
      if (ev.key === 'Escape') {
        ev.preventDefault();
        ev.stopPropagation();
        el.blur();
        return;
      }
      if (!(ev.metaKey || ev.ctrlKey)) return;
      let wrap = null;
      if (ev.key === 'b') wrap = '**';
      else if (ev.key === 'i') wrap = '*';
      else if (ev.key === 'k') wrap = ['[', '](url)'];
      if (!wrap) return;

      ev.preventDefault();
      ev.stopPropagation();

      const src = mdState.source;
      const cursorOffset = sourceOffsetFromDOM(el);
      const sel = window.getSelection();
      let selStart = cursorOffset;
      let selEnd = cursorOffset;
      if (sel.rangeCount && !sel.isCollapsed) {
        const selText = sel.toString();
        selEnd = selStart + selText.length;
      }

      if (selStart !== selEnd) {
        const selected = src.slice(selStart, selEnd);
        let wrapped, newCursor;
        if (Array.isArray(wrap)) {
          wrapped = wrap[0] + selected + wrap[1];
          newCursor = selStart + wrap[0].length + selected.length + wrap[1].length;
        } else {
          wrapped = wrap + selected + wrap;
          newCursor = selStart + wrap.length + selected.length + wrap.length;
        }
        mdState.source = src.slice(0, selStart) + wrapped + src.slice(selEnd);
        mdState.cursorOffset = newCursor;
      } else {
        let insert, cursorInside;
        if (Array.isArray(wrap)) {
          insert = wrap[0] + wrap[1];
          cursorInside = cursorOffset + wrap[0].length;
        } else {
          insert = wrap + wrap;
          cursorInside = cursorOffset + wrap.length;
        }
        mdState.source = src.slice(0, cursorOffset) + insert + src.slice(cursorOffset);
        mdState.cursorOffset = cursorInside;
      }

      mdState.tokens = parse(mdState.source);
      const result = render(mdState.tokens, mdState.cursorOffset);
      mdState.renderedHTML = result.html;
      el.innerHTML = result.html;
      placeCursorAtSourceOffset(el, mdState.cursorOffset, mdState.tokens);
      setElementText(el, originalText, originalClasses);
      restoreEditStyle();
    }

    // --- IME ---
    function onCompStart() { composing = true; }
    function onCompEnd() {
      composing = false;
      mdState.source = el.innerText;
      mdState.cursorOffset = sourceOffsetFromDOM(el);
      mdState.tokens = parse(mdState.source);
      const result = render(mdState.tokens, mdState.cursorOffset);
      mdState.renderedHTML = result.html;
      el.innerHTML = result.html;
      placeCursorAtSourceOffset(el, mdState.cursorOffset, mdState.tokens);
      setElementText(el, originalText, originalClasses);
      restoreEditStyle();
    }

    el.addEventListener('beforeinput', onBeforeInput);
    el.addEventListener('keydown', onEditKey, true);
    document.addEventListener('selectionchange', onCursorMove);
    el.addEventListener('compositionstart', onCompStart);
    el.addEventListener('compositionend', onCompEnd);

    // Exit edit on blur or Escape
    function exitEdit() {
      el.removeEventListener('blur', exitEdit);
      el.removeEventListener('beforeinput', onBeforeInput);
      el.removeEventListener('keydown', onEditKey, true);
      document.removeEventListener('selectionchange', onCursorMove);
      el.removeEventListener('compositionstart', onCompStart);
      el.removeEventListener('compositionend', onCompEnd);

      // Final render — all tokens formatted
      const mdFinal = getMarkdownState(el);
      if (mdFinal) {
        const { html: finalHtml } = render(mdFinal.tokens, -1);
        el.innerHTML = finalHtml;
        clearMarkdownState(el);
      }

      exitEditBase();
    }
    el.addEventListener('blur', exitEdit);
  }

  // --- Module spec ---------------------------------------------------------
  const moduleSpec = {
    id: 'style-modifier',
    label: 'Select',
    enabledByDefault: true,

    button: {
      icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M20.5056 10.7754C21.1225 10.5355 21.431 10.4155 21.5176 10.2459C21.5926 10.099 21.5903 9.92446 21.5115 9.77954C21.4205 9.61226 21.109 9.50044 20.486 9.2768L4.59629 3.5728C4.0866 3.38983 3.83175 3.29835 3.66514 3.35605C3.52029 3.40621 3.40645 3.52004 3.35629 3.6649C3.29859 3.8315 3.39008 4.08635 3.57304 4.59605L9.277 20.4858C9.50064 21.1088 9.61246 21.4203 9.77973 21.5113C9.92465 21.5901 10.0991 21.5924 10.2461 21.5174C10.4157 21.4308 10.5356 21.1223 10.7756 20.5054L13.3724 13.8278C13.4194 13.707 13.4429 13.6466 13.4792 13.5957C13.5114 13.5506 13.5508 13.5112 13.5959 13.479C13.6468 13.4427 13.7072 13.4192 13.828 13.3722L20.5056 10.7754Z" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
      tooltip: 'Select (drag to group)',
      get color() { return getSelectionColor(); },
      order: 5,
    },

    shortcuts: [],

    init() {
      ensureSelectionStyles();
      ensurePlexMono();
      initMarquee();
      document.addEventListener('mousedown', onMouseDown$3, true);
      document.addEventListener('click', (e) => {
        if (!activeMode$1 || isInspectorUI(e.target)) return;
        // Suppress link navigation while selecting elements
        if (e.target.closest('a')) { e.preventDefault(); e.stopPropagation(); }
      }, true);
      document.addEventListener('mousemove', (e) => { onDragMove(e); onMove$1(e); }, true);
      document.addEventListener('mouseup', onMouseUp$3, true);
      document.addEventListener('dblclick', onDblClick, true);
      window.addEventListener('scroll', repositionAllTagLabels, true);
      window.addEventListener('resize', repositionAllTagLabels);

      // Double-tap Shift to toggle spacing overlay
      document.addEventListener('keyup', (e) => {
        if (e.key !== 'Shift' || !activeMode$1) return;
        const now = Date.now();
        if (now - lastShiftUp < SHIFT_DOUBLE_TAP_MS) {
          lastShiftUp = 0;
          if (spacingActive) {
            clearSpacingOverlay();
            showToast('Show Spacing OFF');
          } else {
            spacingActive = true;
            if (hoveredEl$1) showSpacingOverlay(hoveredEl$1);
            showToast('Show Spacing ON — [Shift]+[Shift] to toggle');
          }
        } else {
          lastShiftUp = now;
        }
      }, true);
      // Reposition spacing overlay on scroll/resize
      window.addEventListener('scroll', () => { if (spacingEl) showSpacingOverlay(spacingEl, true); }, true);
      window.addEventListener('resize', () => { if (spacingEl) showSpacingOverlay(spacingEl, true); });

      // Live theme updates: re-paint selected outlines, editable-text
      // backgrounds, tag-label backgrounds, and the toolbar button
      // (when active) so a color swap from settings takes effect
      // everywhere.
      onColorChange((color) => {
        selected.forEach(s => applyOutline(s.el));
        tagLabels.forEach((entry) => { entry.lbl.style.background = color; });
        if (marqueeBox) {
          marqueeBox.style.border = '2px dashed ' + color;
          marqueeBox.style.background = withAlpha(color, 0.06);
        }
        if (activeMode$1) setActiveButton('style-modifier');
      });
    },

    activate() {
      activeMode$1 = true;
      state.styleModActive = true;
      document.body.style.cursor = '';
      document.documentElement.classList.add('dt-comment-active');
      showToast('Select ON — Click to select, drag to group');
    },

    deactivate() {
      activeMode$1 = false;
      state.styleModActive = false;
      dragActive = false;
      didDrag = false;
      if (marqueeBox) marqueeBox.style.display = 'none';
      document.body.style.cursor = '';
      document.documentElement.classList.remove('dt-comment-active');
      clearSpacingOverlay();
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
    return e != null && getCurrentText(el) !== e.originalText;
  }

  function findNoteAnnotationByEl(el) {
    return noteAnnotations.find(a => a.els.includes(el)) || null;
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
    handle.textContent = '\u283F';
    Object.assign(handle.style, {
      flex: '0 0 auto',
      width: '14px',
      minHeight: '20px',
      cursor: 'grab',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      color: 'rgba(255,255,255,0.5)',
      fontSize: '14px',
      lineHeight: '1',
      paddingLeft: '2px',
      paddingRight: '2px',
      marginLeft: '-2px',
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

    // Close button
    const closeBtn = document.createElement('div');
    closeBtn.setAttribute('data-dt-close', '');
    closeBtn.textContent = '\u00d7';
    Object.assign(closeBtn.style, {
      flex: '0 0 auto',
      width: '16px',
      height: '16px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      cursor: 'pointer',
      fontSize: '13px',
      fontFamily: 'system-ui, sans-serif',
      color: 'rgba(255,255,255,0.6)',
      borderRadius: '2px',
      lineHeight: '1',
      marginRight: '-3px',
    });
    closeBtn.addEventListener('mouseenter', () => { closeBtn.style.background = 'rgba(255,255,255,0.2)'; closeBtn.style.color = '#fff'; });
    closeBtn.addEventListener('mouseleave', () => { closeBtn.style.background = ''; closeBtn.style.color = 'rgba(255,255,255,0.6)'; });
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      removeNoteAnnotation(annotation);
      clearSelection();
    });

    bubble.appendChild(handle);
    bubble.appendChild(ta);
    bubble.appendChild(closeBtn);
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
      bubble.classList.add('dt-dragging');
      document.documentElement.classList.add('dt-bubble-dragging');
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
      bubble.classList.remove('dt-dragging');
      document.documentElement.classList.remove('dt-bubble-dragging');
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
        : 'Describe changes...')
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
    if (e && getCurrentText(el) === e.originalText && el.className === e.originalClasses) {
      textEdits.delete(el);
    }
    applyAnnotationStyle(el);
    updateBadgeCount();
  }

  // ---- Badge ----
  function countChanges() {
    let count = 0;
    noteAnnotations.forEach(a => {
      if (!a.transient && a.note && a.note.trim()) count++;
    });
    textEdits.forEach((e, el) => {
      if (getCurrentText(el) !== e.originalText || el.className !== e.originalClasses) count++;
    });
    const inspectorChanges = window.DomTools && window.DomTools._inspectorChanges;
    if (inspectorChanges) count += inspectorChanges.length;
    return count;
  }

  function updateBadgeCount() {
    updateCopyBadge(countChanges());
  }

  function hasChanges() {
    return countChanges() > 0;
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
      if (getCurrentText(el) === e.originalText && el.className === e.originalClasses) return;
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
        const after = getCurrentText(el);
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

    // Inspector panel token/style changes.
    const inspectorChanges = window.DomTools && window.DomTools._inspectorChanges;
    if (inspectorChanges && inspectorChanges.length) {
      inspectorChanges.forEach(({ el, prop, from, to }) => {
        if (!overlaps([el])) return;
        const entry = ensureEntry(el);
        if (!entry.styleDiffs) entry.styleDiffs = [];
        entry.styleDiffs.push({ prop, from, to });
      });
    }

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
      if (entry.styleDiffs) {
        lines.push('Styles:');
        entry.styleDiffs.forEach(d => {
          lines.push(`  ${d.prop}: ${d.from} → ${d.to}`);
        });
      }
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
      showToast('DOM-Tools ON — [Esc]+[Esc] to toggle');
    } else {
      closeEditor();
      getModules().forEach(m => { if (m.deactivate) m.deactivate(); });
      document.documentElement.classList.add('dt-disabled');
      showToast('DOM-Tools OFF — [Esc]+[Esc] to toggle');
    }
  }

  function toggleToolsEnabled() {
    setToolsEnabled(!isToolsEnabled());
  }

  function clearAllChanges() {
    if (isExperimentEnabled('kidpix-clear')) {
      kidPixClear(() => {
        doClear();
      });
    } else {
      doClear();
    }
  }

  function doClear() {
    clearAnnotations();
    const drawMod = getModules().find(m => m.id === 'draw');
    if (drawMod && drawMod.clear) drawMod.clear();
    showToast('Cleared all changes');
  }

  // --- Kid Pix clear animation ---
  // Picks a random wipe style: dynamite, firecracker, or dissolve.
  function kidPixClear(onDone) {
    const effects = [dynamiteWipe, firecrackerWipe, dissolveWipe];
    const effect = effects[Math.floor(Math.random() * effects.length)];
    effect(onDone);
  }

  function dynamiteWipe(onDone) {
    // Flash white → shake → clear
    const overlay = makeOverlay();
    overlay.style.background = '#fff';
    overlay.style.opacity = '0';

    // Boom sound (short beep via oscillator)
    playBoom();

    // Shake the page
    document.documentElement.animate([
      { transform: 'translate(0,0)' },
      { transform: 'translate(-8px, 4px)' },
      { transform: 'translate(6px, -3px)' },
      { transform: 'translate(-4px, 6px)' },
      { transform: 'translate(5px, -2px)' },
      { transform: 'translate(-3px, 3px)' },
      { transform: 'translate(0,0)' },
    ], { duration: 400, easing: 'ease-out' });

    // Flash
    overlay.animate([
      { opacity: 0 },
      { opacity: 0.9, offset: 0.1 },
      { opacity: 0.9, offset: 0.3 },
      { opacity: 0 },
    ], { duration: 500 }).onfinish = () => {
      overlay.remove();
      inspectorUI.delete(overlay);
      onDone();
    };
  }

  function firecrackerWipe(onDone) {
    // Sparks flying from random points
    const overlay = makeOverlay();
    overlay.style.background = 'transparent';
    overlay.style.overflow = 'hidden';

    playBoom();

    const count = 40;
    for (let i = 0; i < count; i++) {
      const spark = document.createElement('div');
      const x = Math.random() * 100;
      const y = Math.random() * 100;
      const hue = Math.random() * 360;
      const size = 4 + Math.random() * 8;
      Object.assign(spark.style, {
        position: 'absolute',
        left: x + '%', top: y + '%',
        width: size + 'px', height: size + 'px',
        borderRadius: '50%',
        background: `hsl(${hue}, 100%, 60%)`,
        boxShadow: `0 0 6px hsl(${hue}, 100%, 70%)`,
      });
      overlay.appendChild(spark);

      const dx = (Math.random() - 0.5) * 200;
      const dy = (Math.random() - 0.5) * 200;
      spark.animate([
        { transform: 'scale(1) translate(0,0)', opacity: 1 },
        { transform: `scale(0) translate(${dx}px, ${dy}px)`, opacity: 0 },
      ], { duration: 600 + Math.random() * 400, easing: 'ease-out' });
    }

    setTimeout(() => {
      overlay.remove();
      inspectorUI.delete(overlay);
      onDone();
    }, 700);
  }

  function dissolveWipe(onDone) {
    // Tiles that flip away
    const overlay = makeOverlay();
    overlay.style.background = 'transparent';

    playBoom();

    const cols = 12, rows = 8;
    const w = 100 / cols, h = 100 / rows;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const tile = document.createElement('div');
        Object.assign(tile.style, {
          position: 'absolute',
          left: (c * w) + '%', top: (r * h) + '%',
          width: w + '%', height: h + '%',
          background: '#111',
          opacity: '0',
        });
        overlay.appendChild(tile);
        const delay = (r + c) * 30 + Math.random() * 60;
        tile.animate([
          { opacity: 0, transform: 'scale(0.8) rotateX(0deg)' },
          { opacity: 1, transform: 'scale(1) rotateX(0deg)', offset: 0.3 },
          { opacity: 1, transform: 'scale(1) rotateX(0deg)', offset: 0.7 },
          { opacity: 0, transform: 'scale(0.5) rotateX(90deg)' },
        ], { duration: 600, delay, easing: 'ease-in-out' });
      }
    }

    setTimeout(() => {
      overlay.remove();
      inspectorUI.delete(overlay);
      onDone();
    }, 900);
  }

  function makeOverlay() {
    const el = document.createElement('div');
    Object.assign(el.style, {
      position: 'fixed', inset: '0',
      zIndex: String(Z.flash + 1),
      pointerEvents: 'none',
    });
    document.body.appendChild(el);
    inspectorUI.add(el);
    return el;
  }

  function playBoom() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      // White noise burst
      const buf = ctx.createBuffer(1, ctx.sampleRate * 0.15, ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.3, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);
      src.connect(gain);
      gain.connect(ctx.destination);
      src.start();
      src.stop(ctx.currentTime + 0.2);
      setTimeout(() => ctx.close(), 300);
    } catch (_) {}
  }

  // --- Navigation guard ---
  function initBeforeUnload() {
    // Standard beforeunload (tab close, hard navigation, URL bar change)
    window.addEventListener('beforeunload', (e) => {
      if (hasChanges()) {
        e.preventDefault();
        e.returnValue = '';
      }
    });

    // SPA navigation (pushState/replaceState) — monkey-patch History API
    // to intercept client-side route changes that don't trigger beforeunload.
    const origPush = history.pushState.bind(history);
    const origReplace = history.replaceState.bind(history);

    function guardNavigation(orig, args) {
      if (hasChanges()) {
        const leave = confirm('You have unsaved DOM-Tools changes. Leave this page?');
        if (!leave) return;
      }
      orig.apply(history, args);
    }

    history.pushState = function(...args) { guardNavigation(origPush, args); };
    history.replaceState = function(...args) { guardNavigation(origReplace, args); };

    // Back/forward button (popstate fires after the navigation, so we
    // listen and push back if the user cancels)
    window.addEventListener('popstate', () => {
      if (hasChanges()) {
        const leave = confirm('You have unsaved DOM-Tools changes. Leave this page?');
        if (!leave) {
          // Push current state back to undo the back/forward
          history.pushState(null, '', window.location.href);
        }
      }
    });
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
    grip.textContent = '\u283F';
    Object.assign(grip.style, { color: 'rgba(255,255,255,0.35)', fontSize: '18px' });

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
    getSelected,
    updateBadgeCount,
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

    // Get blob first — toDataURL fails on large canvases
    const blob = await new Promise(r => canvas.toBlob(r, 'image/png'));
    if (!blob) { showToast('Capture failed — canvas too large'); return; }

    // Try clipboard (requires secure context + user gesture may have expired)
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      showToast('Copied to clipboard');
      return;
    } catch (_) {}

    // Fallback: download via object URL
    try {
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.download = filename || 'screenshot.png';
      link.href = url;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      showToast('Downloaded screenshot');
    } catch (_) {
      showToast('Capture failed');
    }
  }

  async function captureElement(el) {
    await loadH2C();
    const oo = el.style.outline, ob = el.style.backgroundColor;
    el.style.outline = el._origOutline || '';
    el.style.backgroundColor = el._origBg || '';
    showToast('Capturing...');
    try {
      const canvas = await html2canvas(el, { backgroundColor: null, scale: getIdealScale(), logging: false });
      await saveCapture(canvas, el);
    } catch (e) { showToast('Capture failed'); }
    el.style.outline = oo;
    el.style.backgroundColor = ob;
  }

  async function captureRegion(x, y, w, h) {
    await loadH2C();
    showToast('Capturing...');
    try {
      const pageW = document.documentElement.scrollWidth;
      const pageH = document.documentElement.scrollHeight;
      const scale = safeScale(pageW, pageH);
      const full = await html2canvas(document.documentElement, {
        backgroundColor: '#fff', scale, logging: false,
        scrollX: 0, scrollY: 0,
        windowWidth: pageW,
        windowHeight: pageH
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

  // Browsers cap canvas dimensions (16384px in Chrome/Safari, 32767 in Firefox).
  // Use 16384 as the safe cross-browser limit.
  const MAX_CANVAS_DIM = 16384;

  function getIdealScale() {
    const setting = getExperimentOption('camera', 'resolution') || '3';
    if (setting === 'auto') return window.devicePixelRatio || 2;
    return Number(setting);
  }

  function safeScale(width, height) {
    const ideal = getIdealScale();
    const maxByWidth = MAX_CANVAS_DIM / width;
    const maxByHeight = MAX_CANVAS_DIM / height;
    return Math.min(ideal, maxByWidth, maxByHeight);
  }

  async function captureFullPage() {
    const w = document.documentElement.scrollWidth;
    const h = document.documentElement.scrollHeight;
    const scale = getIdealScale();

    // Delegate to HD Capture plugin if page exceeds single-canvas limits
    console.log(`[camera] captureFullPage: ${w}x${h} @ ${scale}x, hdCapture=${!!window.DomTools?._hdCapture}, needed=${window.DomTools?._hdCaptureNeeded?.(w, h, scale)}`);
    if (window.DomTools && window.DomTools._hdCapture && window.DomTools._hdCaptureNeeded &&
        window.DomTools._hdCaptureNeeded(w, h, scale)) {
      showToast('HD capture...');
      try {
        await window.DomTools._hdCapture(w, h, scale);
      } catch (e) { showToast('HD capture failed'); }
      return;
    }

    // Standard single-canvas path (with safe scale)
    await loadH2C();
    showToast('Capturing full page...');
    try {
      const cappedScale = safeScale(w, h);
      const canvas = await html2canvas(document.documentElement, {
        backgroundColor: '#fff', scale: cappedScale, logging: false,
        scrollX: 0, scrollY: 0,
        windowWidth: w,
        windowHeight: h,
        width: w,
        height: h,
        ignoreElements: (el) => inspectorUI.has(el)
      });
      await saveCapture(canvas, null, 'full-page-screenshot.png');
    } catch (e) { showToast('Full page capture failed'); }
  }

  var camera = {
    id: 'camera',
    label: 'Screenshots',
    enabledByDefault: true,

    button: {
      icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M2 8.37722C2 8.0269 2 7.85174 2.01462 7.70421C2.1556 6.28127 3.28127 5.1556 4.70421 5.01462C4.85174 5 5.03636 5 5.40558 5C5.54785 5 5.61899 5 5.67939 4.99634C6.45061 4.94963 7.12595 4.46288 7.41414 3.746C7.43671 3.68986 7.45781 3.62657 7.5 3.5C7.54219 3.37343 7.56329 3.31014 7.58586 3.254C7.87405 2.53712 8.54939 2.05037 9.32061 2.00366C9.38101 2 9.44772 2 9.58114 2H14.4189C14.5523 2 14.619 2 14.6794 2.00366C15.4506 2.05037 16.126 2.53712 16.4141 3.254C16.4367 3.31014 16.4578 3.37343 16.5 3.5C16.5422 3.62657 16.5633 3.68986 16.5859 3.746C16.874 4.46288 17.5494 4.94963 18.3206 4.99634C18.381 5 18.4521 5 18.5944 5C18.9636 5 19.1483 5 19.2958 5.01462C20.7187 5.1556 21.8444 6.28127 21.9854 7.70421C22 7.85174 22 8.0269 22 8.37722V16.2C22 17.8802 22 18.7202 21.673 19.362C21.3854 19.9265 20.9265 20.3854 20.362 20.673C19.7202 21 18.8802 21 17.2 21H6.8C5.11984 21 4.27976 21 3.63803 20.673C3.07354 20.3854 2.6146 19.9265 2.32698 19.362C2 18.7202 2 17.8802 2 16.2V8.37722Z" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M12 16.5C14.2091 16.5 16 14.7091 16 12.5C16 10.2909 14.2091 8.5 12 8.5C9.79086 8.5 8 10.2909 8 12.5C8 14.7091 9.79086 16.5 12 16.5Z" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
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
      showToast('Camera ON — Click element, drag area, or [Cmd+Shift+S]. [Esc] to exit');
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
  const PENCIL_CURSOR = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='20' height='20' viewBox='0 0 24 24'%3E%3Cpath d='M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 000-1.41l-2.34-2.34a1 1 0 00-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z' fill='%23fff' stroke='%23000' stroke-width='1.5'/%3E%3C/svg%3E") 2 18, crosshair`;

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
      background: 'rgba(30,30,30,0.85)', borderRadius: '10px', padding: '8px 10px',
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
      display: 'flex', alignItems: 'center', gap: '5px',
      marginBottom: '6px', cursor: 'grab',
    });
    const grip = document.createElement('span');
    grip.textContent = '\u283F';
    Object.assign(grip.style, {
      color: 'rgba(255,255,255,0.35)', fontSize: '18px', lineHeight: '1',
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
    Object.assign(colorRow.style, { display: 'flex', gap: '4px', alignItems: 'center', flexWrap: 'wrap' });
    panel.appendChild(colorRow);

    DRAW_COLORS.forEach(c => {
      const swatch = document.createElement('button');
      swatch.dataset.colorId = c.id;
      const fill = c.value || getSelectionColor();
      Object.assign(swatch.style, {
        width: '20px', height: '20px', borderRadius: '50%', border: '2px solid transparent',
        background: fill, cursor: 'pointer', padding: '0', transition: 'border-color 0.1s, transform 0.1s',
      });
      if (c.id === 'theme') {
        swatch.style.background = getSelectionColor();
      }
      swatch.addEventListener('click', () => {
        activeColorId = c.id;
        applyPenStyle();
        renderPanelState();
      });
      colorRow.appendChild(swatch);
    });

    // Size options (second row)
    const sizeRow = document.createElement('div');
    Object.assign(sizeRow.style, { display: 'flex', gap: '4px', alignItems: 'center', marginTop: '6px' });
    panel.appendChild(sizeRow);

    DRAW_SIZES.forEach(s => {
      const btn = document.createElement('button');
      btn.dataset.sizeId = s.id;
      const dotSize = Math.max(4, s.width * 2);
      Object.assign(btn.style, {
        width: '22px', height: '22px', borderRadius: '50%', border: '2px solid transparent',
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
      showToast('Draw ON — [A] or [Esc] to exit');
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

  let composing = false;

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
    const useMarkdown = isExperimentEnabled('markdown-edit');

    if (!useMarkdown) {
      // Plain-text editing — let browser handle contentEditable natively
      const onInput = () => {
        setElementText(el, originalText, originalClasses);
        evaluateAnnotation(el);
        queueRepositionAll();
      };
      el.addEventListener('input', onInput);
      inputHandlers.set(el, { onInput });
      return;
    }

    const mdState = initMarkdownState(el, originalText);

    // Initial render (plain text → no markdown yet, so renders unchanged)
    const { html } = render(mdState.tokens, mdState.cursorOffset);
    mdState.renderedHTML = html;
    el.innerHTML = html;

    // --- beforeinput: intercept all edits ---
    const onBeforeInput = (e) => {
      if (composing) return; // Let IME compose freely

      // Read selection length BEFORE preventing default (selection still intact)
      const sel = window.getSelection();
      const selLength = (sel.rangeCount && !sel.isCollapsed) ? sel.toString().length : 0;

      e.preventDefault();

      const cursorOffset = sourceOffsetFromDOM(el);
      applyInputToSource(mdState, e.inputType, e.data, cursorOffset, e, selLength);

      mdState.tokens = parse(mdState.source);
      const result = render(mdState.tokens, mdState.cursorOffset);
      if (result.html !== mdState.renderedHTML) {
        mdState.renderedHTML = result.html;
        el.innerHTML = result.html;
      }
      placeCursorAtSourceOffset(el, mdState.cursorOffset, mdState.tokens);

      setElementText(el, originalText, originalClasses);
      evaluateAnnotation(el);
      queueRepositionAll();
    };

    // --- Cursor movement re-rendering ---
    const onCursorMove = () => {
      if (composing) return;
      if (!el.contains(document.activeElement || document.getSelection()?.anchorNode)) return;
      const newOffset = sourceOffsetFromDOM(el);
      if (newOffset === mdState.cursorOffset) return;
      mdState.cursorOffset = newOffset;
      mdState.tokens = parse(mdState.source);
      const result = render(mdState.tokens, mdState.cursorOffset);
      if (result.html !== mdState.renderedHTML) {
        mdState.renderedHTML = result.html;
        el.innerHTML = result.html;
        placeCursorAtSourceOffset(el, mdState.cursorOffset, mdState.tokens);
      }
    };

    // --- IME composition ---
    const onCompStart = () => { composing = true; };
    const onCompEnd = () => {
      composing = false;
      // After composition, sync from DOM
      mdState.source = el.innerText;
      mdState.cursorOffset = sourceOffsetFromDOM(el);
      mdState.tokens = parse(mdState.source);
      const result = render(mdState.tokens, mdState.cursorOffset);
      mdState.renderedHTML = result.html;
      el.innerHTML = result.html;
      placeCursorAtSourceOffset(el, mdState.cursorOffset, mdState.tokens);
      setElementText(el, originalText, originalClasses);
      evaluateAnnotation(el);
      queueRepositionAll();
    };

    // --- Formatting shortcuts (Cmd+B, Cmd+I, Cmd+K) ---
    const onKeyDown = (e) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      let wrap = null;
      if (e.key === 'b') wrap = '**';
      else if (e.key === 'i') wrap = '*';
      else if (e.key === 'k') wrap = ['[', '](url)'];
      if (!wrap) return;

      e.preventDefault();
      e.stopPropagation();

      const src = mdState.source;
      const cursorOffset = sourceOffsetFromDOM(el);

      // Check for text selection
      const sel = window.getSelection();
      let selStart = cursorOffset;
      let selEnd = cursorOffset;
      if (sel.rangeCount && !sel.isCollapsed) {
        // Get selection bounds in source coordinates
        const range = sel.getRangeAt(0);
        const savedStart = range.startContainer;
        const savedStartOff = range.startOffset;
        // Temporarily collapse to start to read start offset
        sel.collapseToStart();
        selStart = sourceOffsetFromDOM(el);
        // Restore and collapse to end
        sel.collapse(savedStart, savedStartOff);
        sel.extend(range.endContainer, range.endOffset);
        sel.collapseToEnd();
        selEnd = sourceOffsetFromDOM(el);
        if (selStart > selEnd) [selStart, selEnd] = [selEnd, selStart];
      }

      if (selStart !== selEnd) {
        // Wrap selection
        const selected = src.slice(selStart, selEnd);
        let wrapped, newCursor;
        if (Array.isArray(wrap)) {
          wrapped = wrap[0] + selected + wrap[1];
          newCursor = selStart + wrap[0].length + selected.length + wrap[1].length;
        } else {
          wrapped = wrap + selected + wrap;
          newCursor = selStart + wrap.length + selected.length + wrap.length;
        }
        mdState.source = src.slice(0, selStart) + wrapped + src.slice(selEnd);
        mdState.cursorOffset = newCursor;
      } else {
        // No selection — insert empty delimiters and place cursor inside
        let insert, cursorInside;
        if (Array.isArray(wrap)) {
          insert = wrap[0] + wrap[1];
          cursorInside = cursorOffset + wrap[0].length;
        } else {
          insert = wrap + wrap;
          cursorInside = cursorOffset + wrap.length;
        }
        mdState.source = src.slice(0, cursorOffset) + insert + src.slice(cursorOffset);
        mdState.cursorOffset = cursorInside;
      }

      mdState.tokens = parse(mdState.source);
      const result = render(mdState.tokens, mdState.cursorOffset);
      mdState.renderedHTML = result.html;
      el.innerHTML = result.html;
      placeCursorAtSourceOffset(el, mdState.cursorOffset, mdState.tokens);

      setElementText(el, originalText, originalClasses);
      evaluateAnnotation(el);
      queueRepositionAll();
    };

    el.addEventListener('beforeinput', onBeforeInput);
    el.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('selectionchange', onCursorMove);
    el.addEventListener('compositionstart', onCompStart);
    el.addEventListener('compositionend', onCompEnd);

    inputHandlers.set(el, { onBeforeInput, onKeyDown, onCursorMove, onCompStart, onCompEnd });
  }

  function unmakeEditable(el) {
    if (!editableEls.has(el)) return;
    el.removeAttribute('data-dt-text-editing');
    el.contentEditable = 'false';
    el.style.cursor = '';
    el.style.outline = '';
    el.style.outlineOffset = '';

    const handlers = inputHandlers.get(el);
    if (handlers) {
      if (handlers.onInput) {
        // Plain-text path
        el.removeEventListener('input', handlers.onInput);
      } else {
        // Markdown path
        el.removeEventListener('beforeinput', handlers.onBeforeInput);
        el.removeEventListener('keydown', handlers.onKeyDown, true);
        document.removeEventListener('selectionchange', handlers.onCursorMove);
        el.removeEventListener('compositionstart', handlers.onCompStart);
        el.removeEventListener('compositionend', handlers.onCompEnd);
      }
      inputHandlers.delete(el);
    }

    // Final render: all tokens formatted (cursor outside all tokens)
    const mdState = getMarkdownState(el);
    if (mdState) {
      const { html } = render(mdState.tokens, -1);
      el.innerHTML = html;
      clearMarkdownState(el);
    }

    editableEls.delete(el);
    applyAnnotationStyle(el);
  }

  // --- Click handler ---------------------------------------------------------

  function onClick$1(e) {
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
      icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M4 7C4 6.06812 4 5.60218 4.15224 5.23463C4.35523 4.74458 4.74458 4.35523 5.23463 4.15224C5.60218 4 6.06812 4 7 4H17C17.9319 4 18.3978 4 18.7654 4.15224C19.2554 4.35523 19.6448 4.74458 19.8478 5.23463C20 5.60218 20 6.06812 20 7M9 20H15M12 4V20" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
      tooltip: 'Edit Text',
      color: BLUE,
      order: 8,
    },

    shortcuts: [],

    init() {
      document.addEventListener('click', onClick$1, true);
      document.addEventListener('mousemove', onMove, true);
    },

    activate() {
      activeMode = true;
      state.editMode = true;
      showToast('Edit Text ON — Click any text to edit. [Esc] to exit');
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
   * Cmd+click → copy element selector.
   *
   * Lightweight global handler: Cmd+click (Ctrl+click on non-Mac) on any
   * page element copies a CSS selector for it to the clipboard, with a
   * small "nudge" animation on the element to confirm the copy.
   *
   * Skipped when:
   *   - the click is on inspector UI (toolbar, bubble, settings panel…)
   *   - DOM-Tools is disabled
   */


  function ellipsize(s, n) {
    return s.length > n ? s.slice(0, n - 1) + '…' : s;
  }

  async function onClick(e) {
    if (!isToolsEnabled()) return;
    // Cmd on Mac, Ctrl on others
    if (!(e.metaKey || e.ctrlKey)) return;
    if (e.shiftKey) return; // leave Shift+click for multi-select

    const el = e.target;
    if (!el || el.nodeType !== 1) return;
    if (isInspectorUI(el)) return;
    if (el === document.body || el === document.documentElement) return;

    e.preventDefault();
    e.stopPropagation();

    // If the element has any tracked changes (own note, text edit,
    // class diff, or group-note membership), copy the same Markdown
    // section copy-all would emit for it. Otherwise fall back to the
    // bare selector.
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
      document.addEventListener('click', onClick, true);
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
    const wasZoomed = wrapper.dataset.dtBgSet === '1';
    if (zoomed && !wasZoomed) {
      showToast('Canvas ON — [Cmd]+Scroll to zoom, [Space] to pan. [Cmd+0] to reset');
    } else if (!zoomed && wasZoomed) {
      showToast('Canvas OFF');
    }
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
      showArtboardLabel();
    } else {
      document.body.style.background = '';
      document.documentElement.style.background = '';
      wrapper.style.background = '';
      wrapper.style.borderRadius = '';
      wrapper.style.boxShadow = '';
      delete wrapper.dataset.dtBgSet;
      hideArtboardLabel();
    }
    showZoomLevel();
  }

  // --- Artboard label (page title shown above wrapper when zoomed out) ---
  let artboardLabel = null;

  function ensureArtboardLabel() {
    if (artboardLabel) return;
    artboardLabel = document.createElement('div');
    artboardLabel.setAttribute('data-dt-artboard-label', '');
    Object.assign(artboardLabel.style, {
      position: 'absolute',
      top: '-40px',
      left: '0',
      fontSize: '12px',
      fontWeight: '500',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      color: '#6b7280',
      whiteSpace: 'nowrap',
      pointerEvents: 'none',
      userSelect: 'none',
      WebkitUserSelect: 'none',
    });
    artboardLabel.textContent = document.title || window.location.hostname;
    wrapper.style.position = 'relative';
    wrapper.appendChild(artboardLabel);
    inspectorUI.add(artboardLabel);
  }

  function showArtboardLabel() {
    if (!wrapper) return;
    ensureArtboardLabel();
    artboardLabel.style.display = '';
  }

  function hideArtboardLabel() {
    if (artboardLabel) artboardLabel.style.display = 'none';
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
    hideArtboardLabel();
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
    register(camera);
    register(copySelector);
    register(canvasZoom);
    if (isExperimentEnabled('move')) register(move);
    if (isExperimentEnabled('duplicate')) register(duplicate);

    renderToolbar();
    initSettings();
    boot();
    initCopyAll();
    initKeyboard();
    initBeforeUnload();

    moduleSpec.activate();
    setActiveButton('style-modifier');

    // Wire up late-register callback (for plugins loaded after boot)
    onLateRegister((mod) => appendButton(mod));

    // Drain any plugins that loaded before boot
    drainPluginQueue();
  }

  function drainPluginQueue() {
    const pending = window.DomTools._pendingPlugins || [];
    pending.forEach(plugin => {
      if (!isExperimentEnabled(plugin.id)) return;
      registerLate(plugin, pluginAPI);
    });
    window.DomTools._pendingPlugins = [];
  }

  // Public plugin registration (works before or after boot)
  window.DomTools.registerPlugin = function(plugin) {
    if (booted) {
      if (!isExperimentEnabled(plugin.id)) return;
      registerLate(plugin, pluginAPI);
    } else {
      window.DomTools._pendingPlugins.push(plugin);
    }
  };

  // Expose API for plugins that want to access it after registration
  window.DomTools.api = pluginAPI;

  // Expose for SPA integration (call window.bootDomTools() from JS)
  window.bootDomTools = bootDomTools;

  function ready(fn) {
    if (document.body) fn();
    else document.addEventListener('DOMContentLoaded', fn);
  }

  if (new URLSearchParams(window.location.search).has('dom-tools')) {
    ready(bootDomTools);
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
        ready(bootDomTools);
        lastEsc = 0;
        return;
      }
      lastEsc = now;
    }
    document.addEventListener('keydown', preBootEsc, true);
  }

})();
/**
 * Dev Panel Plugin
 * Non-invasive instrumentation panel that observes DOM-Tools state by watching
 * the DOM for actual signals (classes, attributes). Useful during development.
 */
(function () {
  'use strict';

  let panel = null;
  let api = null;
  let active = false;
  let rafId = null;

  // --- State ---
  let keyEntries = [];
  let animEntries = [];
  const MAX_KEY_ENTRIES = 50;
  const MAX_ANIM_ENTRIES = 30;

  // Refs to live DOM inside the panel
  let stateGrid = null;
  let keyLog = null;
  let animLog = null;

  // Keep reference to original Element.prototype.animate
  const origAnimate = Element.prototype.animate;
  let animPatched = false;

  // --- Helpers ---
  function formatTime() {
    const d = new Date();
    return `${d.getMinutes().toString().padStart(2, '0')}:${d.getSeconds().toString().padStart(2, '0')}.${d.getMilliseconds().toString().padStart(3, '0')}`;
  }

  // --- State Detection ---
  // These match the actual CSS classes and data attributes DOM-Tools sets.
  const stateChecks = [
    { label: 'Enabled', detect: () => !document.documentElement.classList.contains('dt-disabled') },
    { label: 'Toolbar', detect: () => !!document.querySelector('[data-dt-toolbar]') },
    { label: 'Bubbles', detect: () => document.querySelectorAll('[data-dt-bubble]').length },
    { label: 'Select', detect: () => document.documentElement.classList.contains('dt-comment-active') },
    { label: 'Editing', detect: () => document.documentElement.classList.contains('dt-inline-editing') },
    { label: 'Draw', detect: () => !!document.querySelector('canvas[data-dt-ignore]') },
    { label: 'Zoom', detect: () => document.documentElement.classList.contains('dt-space-grab') || document.documentElement.classList.contains('dt-space-grabbing') },
    { label: 'Settings', detect: () => !!document.querySelector('[data-dt-settings]') },
  ];

  function renderState() {
    if (!stateGrid) return;
    stateGrid.innerHTML = stateChecks.map(s => {
      const val = s.detect();
      const display = typeof val === 'boolean' ? (val ? 'ON' : 'OFF') : (typeof val === 'number' ? val : val);
      const cls = val === true || (typeof val === 'number' && val > 0) ? 'on' : 'off';
      return `<div class="state-row"><span class="state-key">${s.label}</span><span class="state-val ${cls}">${display}</span></div>`;
    }).join('');
  }

  function tick() {
    renderState();
    rafId = requestAnimationFrame(tick);
  }

  // --- Key Event Logging ---
  const SHORTCUTS = ['Escape', 'T', 'C', 'S', 'K', 'A'];

  function onKeyDown(e) {
    const mods = [e.metaKey && 'Cmd', e.ctrlKey && 'Ctrl', e.shiftKey && 'Shift', e.altKey && 'Alt'].filter(Boolean).join('+');
    const isShortcut = SHORTCUTS.includes(e.key) && (e.shiftKey || e.metaKey || e.ctrlKey || e.key === 'Escape');
    keyEntries.unshift({ key: e.key, mods, target: e.target.tagName.toLowerCase(), time: formatTime(), shortcut: isShortcut });
    if (keyEntries.length > MAX_KEY_ENTRIES) keyEntries.pop();
    renderKeyLog();
  }

  function renderKeyLog() {
    if (!keyLog) return;
    keyLog.innerHTML = keyEntries.map(e =>
      `<div class="key-entry${e.shortcut ? ' shortcut' : ''}">` +
      `<span class="time">${e.time}</span> ` +
      `<span class="key">${e.key}</span>` +
      (e.mods ? ` <span class="mods">${e.mods}</span>` : '') +
      ` <span class="target">&lt;${e.target}&gt;</span>` +
      `</div>`
    ).join('');
  }

  // --- Animation Interception ---
  function patchAnimate() {
    if (animPatched) return;
    animPatched = true;
    Element.prototype.animate = function (keyframes, options) {
      const el = this;
      const isNudge = Array.isArray(keyframes) && keyframes.some(k => k.transform && /translateY/i.test(k.transform));
      if (isNudge && active) {
        const tag = el.tagName.toLowerCase() + (el.className ? '.' + String(el.className).split(' ')[0] : '');
        const dur = typeof options === 'number' ? options : (options && options.duration) || '?';
        animEntries.unshift({ tag, duration: dur + 'ms', time: formatTime() });
        if (animEntries.length > MAX_ANIM_ENTRIES) animEntries.pop();
        renderAnimLog();
      }
      return origAnimate.call(this, keyframes, options);
    };
  }

  function unpatchAnimate() {
    if (!animPatched) return;
    animPatched = false;
    Element.prototype.animate = origAnimate;
  }

  function renderAnimLog() {
    if (!animLog) return;
    animLog.innerHTML = animEntries.map(e =>
      `<div class="anim-entry"><span class="anim-time">${e.time}</span> ${e.tag} <span style="color:#9ca3af">${e.duration}</span></div>`
    ).join('');
  }

  // --- Toast observer ---
  let toastObserver = null;
  function startToastObserver() {
    toastObserver = new MutationObserver((mutations) => {
      for (const m of mutations) {
        for (const node of m.addedNodes) {
          if (node.nodeType === 1 && node.hasAttribute && node.hasAttribute('data-dt-toast')) {
            animEntries.unshift({ tag: 'toast: ' + (node.textContent || '').slice(0, 30), duration: '—', time: formatTime() });
            if (animEntries.length > MAX_ANIM_ENTRIES) animEntries.pop();
            renderAnimLog();
          }
        }
      }
    });
    toastObserver.observe(document.body, { childList: true, subtree: true });
  }

  function stopToastObserver() {
    if (toastObserver) { toastObserver.disconnect(); toastObserver = null; }
  }

  // --- Build Panel UI ---
  function buildPanelContent(contentEl) {
    contentEl.innerHTML = '';
    contentEl.style.padding = '0';

    const style = document.createElement('style');
    style.textContent = `
      .dp-body { padding: 10px 12px; font-size: 11px; line-height: 1.5; }
      .dp-section { margin-bottom: 14px; }
      .dp-section-title {
        font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px;
        color: rgba(255,255,255,0.4); margin: 0 0 6px; font-weight: 600;
      }
      .state-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 8px; }
      .state-row { display: flex; justify-content: space-between; align-items: center; }
      .state-key { color: rgba(255,255,255,0.4); }
      .state-val { font-weight: 600; }
      .state-val.on { color: #34d399; }
      .state-val.off { color: rgba(255,255,255,0.25); }
      .dp-log {
        max-height: 140px; overflow-y: auto;
        background: rgba(0,0,0,0.3); border-radius: 6px;
        padding: 6px 8px;
      }
      .key-entry { border-bottom: 1px solid rgba(255,255,255,0.06); padding: 3px 0; }
      .key-entry:last-child { border-bottom: none; }
      .key-entry .key { color: #fbbf24; font-weight: 700; }
      .key-entry .mods { color: #a78bfa; }
      .key-entry .target { color: rgba(255,255,255,0.3); }
      .key-entry .time { color: rgba(255,255,255,0.25); font-size: 10px; }
      .key-entry.shortcut { background: rgba(59,130,246,0.15); border-radius: 4px; padding: 3px 4px; }
      .anim-entry { color: #6ee7b7; padding: 2px 0; border-bottom: 1px solid rgba(255,255,255,0.06); }
      .anim-entry:last-child { border-bottom: none; }
      .anim-entry .anim-time { color: rgba(255,255,255,0.25); font-size: 10px; }
      .dp-btn {
        padding: 4px 10px; border: none;
        background: rgba(255,255,255,0.1); color: #e5e7eb;
        border-radius: 6px; cursor: pointer; font-size: 10px;
        font-family: inherit;
      }
      .dp-btn:hover { background: rgba(255,255,255,0.18); }
      .dp-log::-webkit-scrollbar { width: 4px; }
      .dp-log::-webkit-scrollbar-track { background: transparent; }
      .dp-log::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.15); border-radius: 2px; }
    `;
    contentEl.appendChild(style);

    const body = document.createElement('div');
    body.className = 'dp-body';
    body.innerHTML = `
      <div class="dp-section">
        <div class="dp-section-title">State</div>
        <div class="state-grid" id="dp-state-grid"></div>
      </div>
      <div class="dp-section">
        <div class="dp-section-title" style="display:flex;justify-content:space-between;align-items:center;">
          Key Events <button class="dp-btn" id="dp-clear-keys" style="margin:0;padding:2px 6px;">Clear</button>
        </div>
        <div class="dp-log" id="dp-key-log"></div>
      </div>
      <div class="dp-section">
        <div class="dp-section-title">Animations</div>
        <div class="dp-log" id="dp-anim-log"></div>
      </div>
    `;
    contentEl.appendChild(body);

    stateGrid = body.querySelector('#dp-state-grid');
    keyLog = body.querySelector('#dp-key-log');
    animLog = body.querySelector('#dp-anim-log');

    body.querySelector('#dp-clear-keys').addEventListener('click', () => {
      keyEntries = [];
      renderKeyLog();
    });
  }

  // --- Plugin Definition ---
  // Dev panel is persistent — it auto-activates on init and stays visible
  // regardless of which tool is active. No toolbar button.
  const plugin = {
    id: 'dev-panel',
    label: 'Dev Panel',

    init(_api) {
      // Auto-activate immediately on registration
      if (active) return;
      active = true;
      api = _api;

      panel = api.createPanel({ title: 'Dev Panel', position: { top: '16px', right: '16px' }, width: '260px' });
      panel.style.display = 'block';

      buildPanelContent(panel._content);

      // Start state polling
      rafId = requestAnimationFrame(tick);

      // Start keydown listener
      document.addEventListener('keydown', onKeyDown, true);

      // Patch animate
      patchAnimate();

      // Start toast observer
      startToastObserver();
    },

    // No-op: dev panel should never be deactivated by tool switches
    activate() {},
    deactivate() {},
  };

  if (window.DomTools) {
    window.DomTools.registerPlugin(plugin);
  }
})();

/**
 * DOM-Tools Plugin: DOM Synth
 * Turns the page into a musical instrument. Hover elements to hear them,
 * click to lock into a sequence, or let it auto-scan and drone.
 * Immediate, interactive, playful. Web Audio API, zero deps.
 */
(function() {
  'use strict';

  let api = null;
  let panel = null;
  let audioCtx = null;
  let masterGain = null;
  let compressor = null;
  let reverbNode = null;
  let active = false;

  // Modes
  const MODES = ['hover', 'sequence', 'drone', 'theremin'];
  let mode = 'hover'; // default: instant sound on hover

  // Musical scales (semitone offsets from root)
  const SCALES = {
    chromatic: [0,1,2,3,4,5,6,7,8,9,10,11],
    major: [0,2,4,5,7,9,11],
    minor: [0,2,3,5,7,8,10],
    pentatonic: [0,2,4,7,9],
    blues: [0,3,5,6,7,10],
    dorian: [0,2,3,5,7,9,10],
    japanese: [0,1,5,7,8],
    whole: [0,2,4,6,8,10],
  };
  let scaleName = 'pentatonic';
  let rootNote = 220; // A3

  // Sequencer
  let playing = false;
  let clockInterval = null;
  let currentStep = 0;
  let nextStepTime = 0;
  let bpm = 120;
  let stepCount = 16;
  let volume = 0.7;
  const tracks = []; // { el, steps[], muted, sound }

  // Drone
  let droneOscs = [];
  let droneGain = null;

  // Theremin
  let thereminOsc = null;
  let thereminGain = null;
  let thereminFilter = null;

  // Hover
  let lastHoverEl = null;
  let hoverTimeout = null;

  // --- Audio setup ---
  function ensureAudio() {
    if (audioCtx) return;
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    compressor = audioCtx.createDynamicsCompressor();
    compressor.threshold.value = -12;
    compressor.knee.value = 10;
    compressor.connect(audioCtx.destination);

    // Simple convolver reverb (generated noise impulse)
    reverbNode = audioCtx.createConvolver();
    const len = audioCtx.sampleRate * 1.5;
    const impulse = audioCtx.createBuffer(2, len, audioCtx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const data = impulse.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.5);
      }
    }
    reverbNode.buffer = impulse;

    masterGain = audioCtx.createGain();
    masterGain.gain.value = volume;

    // Dry + wet mix
    const dryGain = audioCtx.createGain();
    dryGain.gain.value = 0.7;
    const wetGain = audioCtx.createGain();
    wetGain.gain.value = 0.3;

    masterGain.connect(dryGain);
    masterGain.connect(reverbNode);
    reverbNode.connect(wetGain);
    dryGain.connect(compressor);
    wetGain.connect(compressor);
  }

  // --- Scale quantization ---
  function quantizeToScale(freq) {
    const scale = SCALES[scaleName];
    // Find nearest note in scale
    const semitones = 12 * Math.log2(freq / rootNote);
    const octave = Math.floor(semitones / 12);
    const remainder = ((semitones % 12) + 12) % 12;
    // Snap to nearest scale degree
    let closest = scale[0];
    let minDist = 999;
    for (const degree of scale) {
      const dist = Math.abs(remainder - degree);
      if (dist < minDist) { minDist = dist; closest = degree; }
    }
    return rootNote * Math.pow(2, octave + closest / 12);
  }

  // --- DOM-to-sound mapping ---
  function mapElement(el) {
    const rect = el.getBoundingClientRect();
    const viewH = window.innerHeight;
    const viewW = window.innerWidth;

    // Pitch: vertical position (top=high, bottom=low)
    const normalY = 1 - Math.min(1, Math.max(0, rect.top / viewH));
    const rawFreq = 100 + normalY * 1400;
    const freq = quantizeToScale(rawFreq);

    // Duration from width
    const normalW = Math.min(1, rect.width / viewW);
    const duration = 0.08 + normalW * 0.4;

    // Filter from height
    const normalH = Math.min(1, rect.height / viewH);
    const cutoff = 300 + normalH * 6000;

    // Osc type from color
    const bg = getComputedStyle(el).backgroundColor;
    const hue = colorToHue(bg);
    const oscTypes = ['sine', 'triangle', 'square', 'sawtooth'];
    const oscType = oscTypes[Math.floor(hue / 90) % 4];

    // Velocity from element area
    const area = (rect.width * rect.height) / (viewW * viewH);
    const velocity = Math.min(1, Math.max(0.15, area * 4 + 0.2));

    // Detune from horizontal position
    const normalX = rect.left / viewW;
    const detune = (normalX - 0.5) * 30; // ±15 cents for stereo width

    return { freq, duration, cutoff, oscType, velocity, detune };
  }

  function colorToHue(color) {
    const m = color.match(/\d+/g);
    if (!m || m.length < 3) return 0;
    const r = +m[0] / 255, g = +m[1] / 255, b = +m[2] / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    if (max === min) return 0;
    const d = max - min;
    let h;
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
    return h * 360;
  }

  // --- Play a note ---
  function playNote(sound, time) {
    if (!audioCtx) return;
    time = time || audioCtx.currentTime;

    const osc = audioCtx.createOscillator();
    osc.type = sound.oscType;
    osc.frequency.setValueAtTime(sound.freq, time);
    osc.detune.setValueAtTime(sound.detune || 0, time);

    // Sub oscillator for body
    const sub = audioCtx.createOscillator();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(sound.freq * 0.5, time);

    const filter = audioCtx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(sound.cutoff, time);
    filter.frequency.exponentialRampToValueAtTime(300, time + sound.duration);
    filter.Q.value = 4;

    const env = audioCtx.createGain();
    env.gain.setValueAtTime(0, time);
    env.gain.linearRampToValueAtTime(sound.velocity * 0.35, time + 0.01);
    env.gain.exponentialRampToValueAtTime(0.001, time + sound.duration);

    const subGain = audioCtx.createGain();
    subGain.gain.setValueAtTime(sound.velocity * 0.15, time);
    subGain.gain.exponentialRampToValueAtTime(0.001, time + sound.duration * 0.8);

    osc.connect(filter);
    sub.connect(subGain);
    subGain.connect(filter);
    filter.connect(env);
    env.connect(masterGain);

    osc.start(time);
    sub.start(time);
    osc.stop(time + sound.duration + 0.05);
    sub.stop(time + sound.duration + 0.05);
  }

  // --- Visual feedback ---
  function pulseElement(el, color) {
    if (!el || typeof el.animate !== 'function') return;
    const c = color || '#10b981';
    el.animate([
      { boxShadow: `0 0 0 0px ${c}00`, transform: 'scale(1)' },
      { boxShadow: `0 0 20px 6px ${c}99`, transform: 'scale(1.015)', offset: 0.2 },
      { boxShadow: `0 0 0 0px ${c}00`, transform: 'scale(1)' },
    ], { duration: 300, easing: 'ease-out' });
  }

  // ===== HOVER MODE =====
  function onHoverMove(e) {
    if (mode !== 'hover' || !active) return;
    const el = e.target;
    if (api.isInspectorUI(el)) return;
    if (el === lastHoverEl) return;
    lastHoverEl = el;

    // Debounce to avoid rapid-fire
    if (hoverTimeout) clearTimeout(hoverTimeout);
    hoverTimeout = setTimeout(() => {
      ensureAudio();
      if (audioCtx.state === 'suspended') audioCtx.resume();
      const sound = mapElement(el);
      playNote(sound);
      pulseElement(el);
    }, 30);
  }

  // ===== SEQUENCE MODE =====
  const LOOKAHEAD = 0.1;
  const INTERVAL = 25;

  function getStepDuration() { return 60 / bpm / 4; }

  function scheduler() {
    while (nextStepTime < audioCtx.currentTime + LOOKAHEAD) {
      tracks.forEach(track => {
        if (track.muted || !track.steps[currentStep]) return;
        const sound = mapElement(track.el);
        playNote(sound, nextStepTime);
        const delay = Math.max(0, (nextStepTime - audioCtx.currentTime) * 1000);
        setTimeout(() => pulseElement(track.el), delay);
      });
      updateStepHighlight(currentStep);
      nextStepTime += getStepDuration();
      currentStep = (currentStep + 1) % stepCount;
    }
  }

  function startPlayback() {
    ensureAudio();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    playing = true;
    currentStep = 0;
    nextStepTime = audioCtx.currentTime + 0.05;
    clockInterval = setInterval(scheduler, INTERVAL);
    refreshUI();
  }

  function stopPlayback() {
    playing = false;
    if (clockInterval) { clearInterval(clockInterval); clockInterval = null; }
    currentStep = 0;
    updateStepHighlight(-1);
    refreshUI();
  }

  function onSequenceClick(e) {
    if (mode !== 'sequence' || !active) return;
    const el = e.target;
    if (api.isInspectorUI(el)) return;
    e.preventDefault();
    e.stopPropagation();

    const idx = tracks.findIndex(t => t.el === el);
    if (idx !== -1) {
      tracks.splice(idx, 1);
    } else {
      const depth = getDepth(el);
      const interval = Math.max(2, Math.min(8, depth + 1));
      const steps = Array.from({ length: stepCount }, (_, i) => i % interval === 0);
      tracks.push({ el, steps, muted: false });
      // Preview the sound
      ensureAudio();
      if (audioCtx.state === 'suspended') audioCtx.resume();
      playNote(mapElement(el));
      pulseElement(el);
    }
    renderGrid();
  }

  function getDepth(el) {
    let d = 0, n = el;
    while (n && n !== document.body) { d++; n = n.parentElement; }
    return d;
  }

  // ===== DRONE MODE =====
  function startDrone() {
    ensureAudio();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    stopDrone();

    // Scan visible elements and pick up to 6 for a chord
    const els = Array.from(document.querySelectorAll('h1,h2,h3,p,a,button,img,div'))
      .filter(el => {
        if (api.isInspectorUI(el)) return false;
        const r = el.getBoundingClientRect();
        return r.top < window.innerHeight && r.bottom > 0 && r.width > 20;
      })
      .slice(0, 6);

    droneGain = audioCtx.createGain();
    droneGain.gain.value = 0;
    droneGain.connect(masterGain);

    // Fade in
    droneGain.gain.linearRampToValueAtTime(0.25, audioCtx.currentTime + 1.5);

    droneOscs = els.map(el => {
      const sound = mapElement(el);
      const osc = audioCtx.createOscillator();
      osc.type = sound.oscType;
      osc.frequency.value = sound.freq;
      osc.detune.value = (Math.random() - 0.5) * 10; // slight detune for richness

      // Slow LFO on frequency
      const lfo = audioCtx.createOscillator();
      lfo.frequency.value = 0.1 + Math.random() * 0.3;
      const lfoGain = audioCtx.createGain();
      lfoGain.gain.value = sound.freq * 0.01;
      lfo.connect(lfoGain);
      lfoGain.connect(osc.frequency);
      lfo.start();

      const filter = audioCtx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = sound.cutoff * 0.5;
      filter.Q.value = 1;

      osc.connect(filter);
      filter.connect(droneGain);
      osc.start();

      // Pulse the element slowly
      const pulseInterval = setInterval(() => {
        if (!active || mode !== 'drone') { clearInterval(pulseInterval); return; }
        pulseElement(el, '#10b981');
      }, 2000 + Math.random() * 3000);

      return { osc, lfo, filter, el, pulseInterval };
    });
  }

  function stopDrone() {
    if (droneGain) {
      try { droneGain.gain.linearRampToValueAtTime(0, audioCtx.currentTime + 0.5); } catch(e) {}
    }
    droneOscs.forEach(d => {
      try { d.osc.stop(audioCtx.currentTime + 0.6); } catch(e) {}
      try { d.lfo.stop(audioCtx.currentTime + 0.6); } catch(e) {}
      clearInterval(d.pulseInterval);
    });
    droneOscs = [];
    setTimeout(() => { if (droneGain) { droneGain.disconnect(); droneGain = null; } }, 700);
  }

  // ===== THEREMIN MODE =====
  function startTheremin() {
    ensureAudio();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    stopTheremin();

    thereminOsc = audioCtx.createOscillator();
    thereminOsc.type = 'sawtooth';
    thereminOsc.frequency.value = 440;

    thereminFilter = audioCtx.createBiquadFilter();
    thereminFilter.type = 'lowpass';
    thereminFilter.frequency.value = 2000;
    thereminFilter.Q.value = 5;

    thereminGain = audioCtx.createGain();
    thereminGain.gain.value = 0;

    thereminOsc.connect(thereminFilter);
    thereminFilter.connect(thereminGain);
    thereminGain.connect(masterGain);
    thereminOsc.start();

    document.addEventListener('mousemove', onThereminMove);
    document.addEventListener('mousedown', onThereminDown);
    document.addEventListener('mouseup', onThereminUp);
  }

  function stopTheremin() {
    document.removeEventListener('mousemove', onThereminMove);
    document.removeEventListener('mousedown', onThereminDown);
    document.removeEventListener('mouseup', onThereminUp);
    if (thereminOsc) { try { thereminOsc.stop(); } catch(e) {} thereminOsc = null; }
    if (thereminGain) { thereminGain.disconnect(); thereminGain = null; }
    thereminFilter = null;
  }

  function onThereminMove(e) {
    if (!thereminOsc) return;
    const x = e.clientX / window.innerWidth;
    const y = 1 - (e.clientY / window.innerHeight);
    const rawFreq = 80 + y * 1500;
    const freq = quantizeToScale(rawFreq);
    thereminOsc.frequency.exponentialRampToValueAtTime(
      Math.max(20, freq), audioCtx.currentTime + 0.05
    );
    thereminFilter.frequency.value = 400 + x * 6000;
  }

  function onThereminDown() {
    if (thereminGain) thereminGain.gain.linearRampToValueAtTime(0.3, audioCtx.currentTime + 0.05);
  }

  function onThereminUp() {
    if (thereminGain) thereminGain.gain.linearRampToValueAtTime(0, audioCtx.currentTime + 0.1);
  }

  // ===== AUTO-SCAN =====
  function autoScan() {
    tracks.length = 0;
    const els = Array.from(document.querySelectorAll('h1,h2,h3,h4,p,a,button,img,li,span,section,article'))
      .filter(el => {
        if (api.isInspectorUI(el)) return false;
        const r = el.getBoundingClientRect();
        return r.top < window.innerHeight && r.bottom > 0 && r.width > 30 && r.height > 10;
      });
    // Pick up to 8 diverse elements
    const picked = [];
    const stride = Math.max(1, Math.floor(els.length / 8));
    for (let i = 0; i < els.length && picked.length < 8; i += stride) {
      picked.push(els[i]);
    }
    picked.forEach((el, i) => {
      const steps = Array.from({ length: stepCount }, (_, s) => {
        // Euclidean-ish distribution
        const hits = Math.max(1, Math.min(8, 3 + i));
        return (s * hits) % stepCount < hits;
      });
      tracks.push({ el, steps, muted: false });
    });
    renderGrid();
    api.showToast(`Scanned ${picked.length} elements`);
  }

  // ===== PANEL UI =====
  let gridContainer = null;
  let _playBtn = null;
  let _modeButtons = {};
  let _stepCells = [];

  function buildPanel() {
    panel = api.createPanel({ title: 'DOM Synth', position: { top: '16px', right: '16px' }, width: '340px' });
    const C = panel._content;
    C.style.maxHeight = '70vh';
    C.style.overflowY = 'auto';

    // --- Mode selector ---
    addSection(C, 'mode', true);
    const modeRow = mkEl('div', { display: 'flex', gap: '4px', marginBottom: '10px' });
    MODES.forEach(m => {
      const btn = mkEl('button', {
        padding: '4px 8px', fontSize: '10px', fontWeight: '600',
        border: 'none', borderRadius: '4px', cursor: 'pointer',
        background: m === mode ? '#10b981' : '#333', color: '#fff', fontFamily: 'inherit',
        textTransform: 'capitalize',
      });
      btn.textContent = m;
      btn.addEventListener('click', () => setMode(m));
      _modeButtons[m] = btn;
      modeRow.appendChild(btn);
    });
    C.appendChild(modeRow);

    // --- Scale + Root ---
    addSection(C, 'tuning');
    const tuneRow = mkEl('div', { display: 'flex', gap: '6px', alignItems: 'center', marginBottom: '8px' });
    const scaleSelect = mkEl('select', {
      fontSize: '10px', background: '#333', color: '#fff', border: 'none',
      borderRadius: '3px', padding: '3px 6px',
    });
    Object.keys(SCALES).forEach(name => {
      const opt = document.createElement('option');
      opt.value = name; opt.textContent = name;
      if (name === scaleName) opt.selected = true;
      scaleSelect.appendChild(opt);
    });
    scaleSelect.addEventListener('change', () => { scaleName = scaleSelect.value; });
    tuneRow.appendChild(scaleSelect);

    const rootSelect = mkEl('select', {
      fontSize: '10px', background: '#333', color: '#fff', border: 'none',
      borderRadius: '3px', padding: '3px 6px',
    });
    const noteNames = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
    const rootFreqs = { C: 130.81, 'C#': 138.59, D: 146.83, 'D#': 155.56, E: 164.81, F: 174.61, 'F#': 185.0, G: 196.0, 'G#': 207.65, A: 220.0, 'A#': 233.08, B: 246.94 };
    noteNames.forEach(n => {
      const opt = document.createElement('option');
      opt.value = rootFreqs[n]; opt.textContent = n + '3';
      if (rootFreqs[n] === rootNote) opt.selected = true;
      rootSelect.appendChild(opt);
    });
    rootSelect.addEventListener('change', () => { rootNote = parseFloat(rootSelect.value); });
    tuneRow.appendChild(rootSelect);
    C.appendChild(tuneRow);

    // --- Transport (sequence mode) ---
    addSection(C, 'transport');
    const transport = mkEl('div', { display: 'flex', gap: '6px', alignItems: 'center', marginBottom: '8px' });
    _playBtn = mkBtn(playing ? '⏸' : '▶', () => { playing ? stopPlayback() : startPlayback(); });
    _playBtn.style.width = '28px';
    transport.appendChild(_playBtn);
    transport.appendChild(mkBtn('■', stopPlayback));
    transport.appendChild(mkBtn('Scan', autoScan));
    transport.appendChild(mkBtn('Rnd', randomize));

    const bpmInput = document.createElement('input');
    bpmInput.type = 'range'; bpmInput.min = '60'; bpmInput.max = '200'; bpmInput.value = bpm;
    Object.assign(bpmInput.style, { width: '50px', height: '3px', accentColor: '#10b981', marginLeft: 'auto' });
    const bpmLbl = mkEl('span', { fontSize: '9px', color: '#888' });
    bpmLbl.textContent = bpm + '';
    bpmInput.addEventListener('input', () => { bpm = +bpmInput.value; bpmLbl.textContent = bpm + ''; });
    transport.appendChild(bpmInput);
    transport.appendChild(bpmLbl);
    C.appendChild(transport);

    // Volume
    const volRow = mkEl('div', { display: 'flex', gap: '6px', alignItems: 'center', marginBottom: '10px' });
    const volLbl = mkEl('span', { fontSize: '9px', color: '#888' });
    volLbl.textContent = 'vol';
    const volInput = document.createElement('input');
    volInput.type = 'range'; volInput.min = '0'; volInput.max = '1'; volInput.step = '0.05'; volInput.value = volume;
    Object.assign(volInput.style, { width: '80px', height: '3px', accentColor: '#10b981' });
    volInput.addEventListener('input', () => {
      volume = +volInput.value;
      if (masterGain) masterGain.gain.value = volume;
    });
    volRow.appendChild(volLbl);
    volRow.appendChild(volInput);
    C.appendChild(volRow);

    // Grid
    gridContainer = mkEl('div', { maxHeight: '180px', overflowY: 'auto' });
    C.appendChild(gridContainer);
    renderGrid();
  }

  function setMode(m) {
    // Cleanup previous mode
    if (mode === 'drone') stopDrone();
    if (mode === 'theremin') stopTheremin();
    if (mode === 'sequence' && playing) stopPlayback();

    mode = m;

    // Activate new mode
    if (mode === 'drone') startDrone();
    if (mode === 'theremin') startTheremin();

    // Update UI
    Object.entries(_modeButtons).forEach(([key, btn]) => {
      btn.style.background = key === m ? '#10b981' : '#333';
    });

    const hints = {
      hover: 'Hover elements to hear them',
      sequence: 'Click elements to build a pattern',
      drone: 'Page elements sustain as a chord',
      theremin: 'Click + drag to play (Y=pitch, X=filter)',
    };
    api.showToast(hints[m] || '');
  }

  // --- Grid rendering ---
  function renderGrid() {
    if (!gridContainer) return;
    gridContainer.innerHTML = '';
    _stepCells = [];

    if (tracks.length === 0) {
      const empty = mkEl('div', { color: '#555', fontSize: '9px', textAlign: 'center', padding: '12px 0' });
      empty.textContent = mode === 'sequence' ? 'click elements to add • or hit Scan' : 'switch to sequence mode for the grid';
      gridContainer.appendChild(empty);
      return;
    }

    tracks.forEach((track, ti) => {
      const row = mkEl('div', { display: 'flex', alignItems: 'center', gap: '1px', marginBottom: '3px' });

      // Label
      const lbl = mkEl('div', {
        fontSize: '8px', color: track.muted ? '#555' : '#aaa', width: '55px',
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flexShrink: '0',
        cursor: 'pointer',
      });
      const sel = api.getSelector(track.el);
      lbl.textContent = sel.length > 12 ? sel.slice(0, 12) + '…' : sel;
      lbl.title = sel;
      lbl.addEventListener('click', () => {
        // Preview sound + highlight element
        ensureAudio();
        if (audioCtx.state === 'suspended') audioCtx.resume();
        playNote(mapElement(track.el));
        pulseElement(track.el);
      });
      row.appendChild(lbl);

      // Step cells
      const cells = [];
      for (let s = 0; s < stepCount; s++) {
        const cell = mkEl('div', {
          width: '10px', height: '10px', borderRadius: '2px', cursor: 'pointer',
          background: track.steps[s] ? '#10b981' : '#282828',
          border: '1px solid ' + (track.steps[s] ? '#10b981' : '#3a3a3a'),
          flexShrink: '0', transition: 'background 0.1s',
        });
        cell.addEventListener('click', () => {
          track.steps[s] = !track.steps[s];
          cell.style.background = track.steps[s] ? '#10b981' : '#282828';
          cell.style.borderColor = track.steps[s] ? '#10b981' : '#3a3a3a';
        });
        row.appendChild(cell);
        cells.push(cell);
      }
      _stepCells.push(cells);

      // Mute
      const muteBtn = mkEl('div', {
        width: '14px', height: '14px', fontSize: '8px', fontWeight: '700',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        borderRadius: '2px', cursor: 'pointer', marginLeft: '3px',
        background: track.muted ? '#ef4444' : '#333', color: '#fff', flexShrink: '0',
      });
      muteBtn.textContent = 'M';
      muteBtn.addEventListener('click', () => {
        track.muted = !track.muted;
        muteBtn.style.background = track.muted ? '#ef4444' : '#333';
        lbl.style.color = track.muted ? '#555' : '#aaa';
      });
      row.appendChild(muteBtn);

      // Remove
      const rmBtn = mkEl('div', {
        width: '14px', height: '14px', fontSize: '11px',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        borderRadius: '2px', cursor: 'pointer', marginLeft: '1px',
        background: '#333', color: '#777', flexShrink: '0',
      });
      rmBtn.textContent = '×';
      rmBtn.addEventListener('click', () => { tracks.splice(ti, 1); renderGrid(); });
      row.appendChild(rmBtn);

      gridContainer.appendChild(row);
    });
  }

  function updateStepHighlight(step) {
    _stepCells.forEach((cells, ti) => {
      cells.forEach((cell, s) => {
        cell.style.boxShadow = s === step ? '0 0 4px #10b981' : 'none';
      });
    });
  }

  function randomize() {
    tracks.forEach(track => {
      const density = 0.2 + Math.random() * 0.35;
      track.steps = Array.from({ length: stepCount }, () => Math.random() < density);
    });
    renderGrid();
  }

  function refreshUI() {
    if (_playBtn) {
      _playBtn.textContent = playing ? '⏸' : '▶';
      _playBtn.style.background = playing ? '#10b981' : '#333';
    }
  }

  // --- UI helpers ---
  function mkEl(tag, styles) {
    const e = document.createElement(tag);
    if (styles) Object.assign(e.style, styles);
    return e;
  }

  function mkBtn(text, onClick) {
    const btn = mkEl('button', {
      padding: '3px 7px', fontSize: '10px', fontWeight: '600',
      border: 'none', borderRadius: '3px', cursor: 'pointer',
      background: '#333', color: '#fff', fontFamily: 'inherit',
    });
    btn.textContent = text;
    btn.addEventListener('click', onClick);
    btn.addEventListener('mouseenter', () => { btn.style.background = '#444'; });
    btn.addEventListener('mouseleave', () => { btn.style.background = '#333'; });
    return btn;
  }

  function addSection(parent, text, first) {
    const s = mkEl('div', {
      fontSize: '9px', fontWeight: '700', textTransform: 'uppercase',
      letterSpacing: '1px', color: '#555', marginBottom: '6px',
      marginTop: first ? '0' : '12px',
      paddingTop: first ? '0' : '8px',
      borderTop: first ? 'none' : '1px solid rgba(255,255,255,0.05)',
    });
    s.textContent = text;
    parent.appendChild(s);
  }

  // --- Plugin definition ---
  const plugin = {
    id: 'dom-synth',
    label: 'DOM Synth',
    enabledByDefault: true,

    button: {
      icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>',
      tooltip: 'DOM Synth',
      color: '#10b981',
      order: 51,
    },

    init(pluginApi) { api = pluginApi; },

    activate() {
      active = true;
      if (!panel) buildPanel();
      panel.style.display = 'block';
      document.addEventListener('mousemove', onHoverMove);
      document.addEventListener('click', onSequenceClick, true);
      setMode(mode);
    },

    deactivate() {
      active = false;
      if (mode === 'drone') stopDrone();
      if (mode === 'theremin') stopTheremin();
      if (playing) stopPlayback();
      document.removeEventListener('mousemove', onHoverMove);
      document.removeEventListener('click', onSequenceClick, true);
      if (panel) panel.style.display = 'none';
      lastHoverEl = null;
    },

    toggle() {
      if (active) { this.deactivate(); return false; }
      this.activate();
      return true;
    },
  };

  // Register
  const dt = window.DomTools || (window.DomTools = { _pendingPlugins: [] });
  if (dt.registerPlugin) dt.registerPlugin(plugin);
  else dt._pendingPlugins.push(plugin);
})();

/**
 * DOM X-Ray Plugin
 * Box-model visualization: content (blue), padding (green), border (yellow), margin (orange).
 * Hover to inspect, click to lock selection.
 */
(function () {
  const COLORS = {
    margin:  'rgba(255, 165, 0, 0.15)',
    border:  'rgba(255, 215, 0, 0.25)',
    padding: 'rgba(144, 238, 144, 0.2)',
    content: 'rgba(100, 149, 237, 0.15)',
  };

  let container = null;
  let tooltip = null;
  let locked = null;
  let active = false;
  let api = null;

  function createOverlayContainer() {
    container = document.createElement('div');
    container.id = 'dt-xray-overlays';
    container.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:2147483640;';
    document.body.appendChild(container);
  }

  function createTooltip() {
    tooltip = document.createElement('div');
    tooltip.id = 'dt-xray-tooltip';
    tooltip.style.cssText = `
      position:fixed;pointer-events:none;z-index:2147483641;
      background:rgba(20,20,30,0.92);color:#e0e0e0;
      font:11px/1.5 'SF Mono',Menlo,monospace;
      padding:8px 10px;border-radius:6px;
      max-width:280px;white-space:pre;
      box-shadow:0 4px 12px rgba(0,0,0,0.3);
      display:none;
    `;
    document.body.appendChild(tooltip);
  }

  function getBoxModel(el) {
    const cs = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    const parse = (v) => parseFloat(v) || 0;

    const mt = parse(cs.marginTop), mr = parse(cs.marginRight);
    const mb = parse(cs.marginBottom), ml = parse(cs.marginLeft);
    const bt = parse(cs.borderTopWidth), br = parse(cs.borderRightWidth);
    const bb = parse(cs.borderBottomWidth), blw = parse(cs.borderLeftWidth);
    const pt = parse(cs.paddingTop), pr = parse(cs.paddingRight);
    const pb = parse(cs.paddingBottom), pl = parse(cs.paddingLeft);

    return {
      rect, cs,
      margin: { top: mt, right: mr, bottom: mb, left: ml },
      border: { top: bt, right: br, bottom: bb, left: blw },
      padding: { top: pt, right: pr, bottom: pb, left: pl },
    };
  }

  function renderOverlays(el) {
    container.innerHTML = '';
    const { rect, margin, border, padding } = getBoxModel(el);

    // Margin layer (outermost)
    const marginRect = {
      top: rect.top - margin.top,
      left: rect.left - margin.left,
      width: rect.width + margin.left + margin.right,
      height: rect.height + margin.top + margin.bottom,
    };
    addOverlay(marginRect, COLORS.margin);

    // Border layer
    addOverlay({ top: rect.top, left: rect.left, width: rect.width, height: rect.height }, COLORS.border);

    // Padding layer (inside border)
    const paddingRect = {
      top: rect.top + border.top,
      left: rect.left + border.left,
      width: rect.width - border.left - border.right,
      height: rect.height - border.top - border.bottom,
    };
    addOverlay(paddingRect, COLORS.padding);

    // Content layer (innermost)
    const contentRect = {
      top: paddingRect.top + padding.top,
      left: paddingRect.left + padding.left,
      width: paddingRect.width - padding.left - padding.right,
      height: paddingRect.height - padding.top - padding.bottom,
    };
    addOverlay(contentRect, COLORS.content);
  }

  function addOverlay(r, color) {
    const d = document.createElement('div');
    d.style.cssText = `position:fixed;top:${r.top}px;left:${r.left}px;width:${r.width}px;height:${r.height}px;background:${color};`;
    container.appendChild(d);
  }

  function updateTooltip(el, e) {
    const { rect, cs, margin, border, padding } = getBoxModel(el);
    const tag = el.tagName.toLowerCase();
    const cls = el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).join('.') : '';
    const id = el.id ? `#${el.id}` : '';

    const lines = [
      `${tag}${id}${cls}`,
      `${Math.round(rect.width)} x ${Math.round(rect.height)}`,
      `margin: ${fmt(margin)}`,
      `padding: ${fmt(padding)}`,
      `border: ${fmt(border)}`,
      `position: ${cs.position}${cs.zIndex !== 'auto' ? '  z:' + cs.zIndex : ''}`,
    ];

    tooltip.textContent = lines.join('\n');
    tooltip.style.display = 'block';

    // Position near cursor
    let x = e.clientX + 14;
    let y = e.clientY + 14;
    const tw = tooltip.offsetWidth;
    const th = tooltip.offsetHeight;
    if (x + tw > window.innerWidth - 8) x = e.clientX - tw - 10;
    if (y + th > window.innerHeight - 8) y = e.clientY - th - 10;
    tooltip.style.left = x + 'px';
    tooltip.style.top = y + 'px';
  }

  function fmt(box) {
    return `${box.top} ${box.right} ${box.bottom} ${box.left}`;
  }

  function isIgnored(el) {
    if (!el || el === document.body || el === document.documentElement) return true;
    if (el.closest('#dt-xray-overlays, #dt-xray-tooltip, #dom-tools-toolbar, [data-dt-ignore]')) return true;
    return false;
  }

  // --- Event handlers ---
  function onMouseMove(e) {
    if (locked) {
      updateTooltip(locked, e);
      return;
    }
    const el = document.elementFromPoint(e.clientX, e.clientY);
    if (!el || isIgnored(el)) {
      container.innerHTML = '';
      tooltip.style.display = 'none';
      return;
    }
    renderOverlays(el);
    updateTooltip(el, e);
  }

  function onClick(e) {
    const el = document.elementFromPoint(e.clientX, e.clientY);
    if (!el || isIgnored(el)) return;
    e.preventDefault();
    e.stopPropagation();

    if (locked === el) {
      locked = null; // unlock
    } else {
      locked = el;
      renderOverlays(el);
      updateTooltip(el, e);
    }
  }

  function onScroll() {
    if (locked) renderOverlays(locked);
  }

  // --- Plugin interface ---
  const plugin = {
    id: 'dom-xray',
    label: 'X-Ray',
    icon: `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><rect x="7" y="7" width="10" height="10" rx="1"/><rect x="10" y="10" width="4" height="4"/></svg>`,

    toggle() {
      if (active) { this.deactivate(); return false; }
      else { this.activate(this._api); return true; }
    },

    activate(_api) {
      if (_api) api = _api;
      active = true;
      createOverlayContainer();
      createTooltip();
      document.addEventListener('mousemove', onMouseMove, true);
      document.addEventListener('click', onClick, true);
      window.addEventListener('scroll', onScroll, true);
      window.addEventListener('resize', onScroll);
    },

    deactivate() {
      active = false;
      locked = null;
      document.removeEventListener('mousemove', onMouseMove, true);
      document.removeEventListener('click', onClick, true);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
      if (container) { container.remove(); container = null; }
      if (tooltip) { tooltip.remove(); tooltip = null; }
    },
  };

  if (window.DomTools) {
    window.DomTools.registerPlugin(plugin);
  }
})();

/**
 * HD Capture plugin — tiled full-page screenshots for tall pages.
 *
 * When a page exceeds the browser's max canvas dimension (16384px),
 * this plugin renders in horizontal strips at full resolution, then
 * stitches them into a single compressed PNG using a built-in DEFLATE
 * encoder. No external dependencies.
 *
 * Enabled by default. Hooks into the camera system via
 * window.DomTools._hdCapture override.
 */
(function () {
  'use strict';

  const MAX_CANVAS_DIM = 16384;
  const STRIP_HEIGHT = 4000; // px at 1x scale per strip

  // =========================================================
  // Minimal DEFLATE encoder (fixed Huffman codes)
  // =========================================================

  function deflateRaw(data) {
    // Use fixed Huffman encoding in 65535-byte stored blocks
    // This is simpler than full Huffman but still produces valid deflate
    const MAX_BLOCK = 65535;
    const blocks = [];
    let offset = 0;

    while (offset < data.length) {
      const remaining = data.length - offset;
      const len = Math.min(remaining, MAX_BLOCK);
      const isLast = (offset + len >= data.length);

      // Block header: BFINAL (1 bit) + BTYPE=00 (2 bits) = stored block
      blocks.push(isLast ? 1 : 0);
      // LEN (2 bytes little-endian)
      blocks.push(len & 0xFF, (len >> 8) & 0xFF);
      // NLEN (one's complement of LEN)
      const nlen = ~len & 0xFFFF;
      blocks.push(nlen & 0xFF, (nlen >> 8) & 0xFF);
      // Literal data
      for (let i = 0; i < len; i++) {
        blocks.push(data[offset + i]);
      }
      offset += len;
    }

    return new Uint8Array(blocks);
  }

  function adler32(data) {
    let a = 1, b = 0;
    for (let i = 0; i < data.length; i++) {
      a = (a + data[i]) % 65521;
      b = (b + a) % 65521;
    }
    return ((b << 16) | a) >>> 0;
  }

  function zlibCompress(data) {
    const deflated = deflateRaw(data);
    const checksum = adler32(data);
    // zlib header: CMF=0x78 (deflate, window 32k), FLG=0x01 (no dict, check bits)
    const result = new Uint8Array(2 + deflated.length + 4);
    result[0] = 0x78;
    result[1] = 0x01;
    result.set(deflated, 2);
    const off = 2 + deflated.length;
    result[off] = (checksum >> 24) & 0xFF;
    result[off + 1] = (checksum >> 16) & 0xFF;
    result[off + 2] = (checksum >> 8) & 0xFF;
    result[off + 3] = checksum & 0xFF;
    return result;
  }

  // =========================================================
  // PNG encoder
  // =========================================================

  function crc32(buf) {
    let crc = 0xFFFFFFFF;
    for (let i = 0; i < buf.length; i++) {
      crc ^= buf[i];
      for (let j = 0; j < 8; j++) {
        crc = (crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0);
      }
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }

  function pngChunk(type, data) {
    const typeBytes = new TextEncoder().encode(type);
    const len = data.length;
    const chunk = new Uint8Array(4 + 4 + len + 4);
    // Length (4 bytes big-endian)
    chunk[0] = (len >> 24) & 0xFF;
    chunk[1] = (len >> 16) & 0xFF;
    chunk[2] = (len >> 8) & 0xFF;
    chunk[3] = len & 0xFF;
    // Type
    chunk.set(typeBytes, 4);
    // Data
    chunk.set(data, 8);
    // CRC over type+data
    const crcData = new Uint8Array(4 + len);
    crcData.set(typeBytes, 0);
    crcData.set(data, 4);
    const crc = crc32(crcData);
    chunk[8 + len] = (crc >> 24) & 0xFF;
    chunk[8 + len + 1] = (crc >> 16) & 0xFF;
    chunk[8 + len + 2] = (crc >> 8) & 0xFF;
    chunk[8 + len + 3] = crc & 0xFF;
    return chunk;
  }

  function encodePNG(width, height, rgbaStrips) {
    // Build raw image data with filter byte (0 = None) per row
    const rowBytes = width * 4; // RGBA
    const rawSize = height * (1 + rowBytes);
    const raw = new Uint8Array(rawSize);

    let destOffset = 0;
    let stripIdx = 0;
    let stripRowOffset = 0;

    for (let y = 0; y < height; y++) {
      raw[destOffset++] = 0; // filter: None
      const strip = rgbaStrips[stripIdx];
      const srcStart = stripRowOffset * rowBytes;
      raw.set(strip.subarray(srcStart, srcStart + rowBytes), destOffset);
      destOffset += rowBytes;
      stripRowOffset++;
      if (stripRowOffset >= strip.length / rowBytes) {
        stripIdx++;
        stripRowOffset = 0;
      }
    }

    // Compress
    const compressed = zlibCompress(raw);

    // IHDR
    const ihdr = new Uint8Array(13);
    ihdr[0] = (width >> 24) & 0xFF;
    ihdr[1] = (width >> 16) & 0xFF;
    ihdr[2] = (width >> 8) & 0xFF;
    ihdr[3] = width & 0xFF;
    ihdr[4] = (height >> 24) & 0xFF;
    ihdr[5] = (height >> 16) & 0xFF;
    ihdr[6] = (height >> 8) & 0xFF;
    ihdr[7] = height & 0xFF;
    ihdr[8] = 8;  // bit depth
    ihdr[9] = 6;  // color type: RGBA
    ihdr[10] = 0; // compression
    ihdr[11] = 0; // filter
    ihdr[12] = 0; // interlace

    // Assemble PNG
    const signature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
    const ihdrChunk = pngChunk('IHDR', ihdr);
    const idatChunk = pngChunk('IDAT', compressed);
    const iendChunk = pngChunk('IEND', new Uint8Array(0));

    const png = new Uint8Array(
      signature.length + ihdrChunk.length + idatChunk.length + iendChunk.length
    );
    let off = 0;
    png.set(signature, off); off += signature.length;
    png.set(ihdrChunk, off); off += ihdrChunk.length;
    png.set(idatChunk, off); off += idatChunk.length;
    png.set(iendChunk, off);

    return png;
  }

  // =========================================================
  // Tiled capture
  // =========================================================

  async function loadH2C() {
    if (!window.html2canvas) {
      const s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
      document.head.appendChild(s);
      await new Promise(r => s.onload = r);
    }
  }

  async function captureHD(pageWidth, pageHeight, scale, inspectorUI) {
    await loadH2C();

    const stripH = STRIP_HEIGHT; // at 1x
    const numStrips = Math.ceil(pageHeight / stripH);
    const scaledWidth = Math.round(pageWidth * scale);
    const totalScaledHeight = Math.round(pageHeight * scale);
    const rgbaStrips = [];

    for (let i = 0; i < numStrips; i++) {
      const y = i * stripH;
      const h = Math.min(stripH, pageHeight - y);

      const canvas = await html2canvas(document.documentElement, {
        backgroundColor: '#fff',
        scale: scale,
        logging: false,
        scrollX: 0,
        scrollY: 0,
        x: 0,
        y: y,
        width: pageWidth,
        height: h,
        windowWidth: pageWidth,
        windowHeight: pageHeight,
        ignoreElements: inspectorUI
          ? (el) => inspectorUI.has(el)
          : undefined,
      });

      // Extract RGBA pixel data from this strip
      const ctx = canvas.getContext('2d');
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      rgbaStrips.push(imageData.data);

      // Update progress
      if (window.DomTools && window.DomTools._showToast) {
        window.DomTools._showToast(`Capturing... ${i + 1}/${numStrips}`);
      }
    }

    // Encode to PNG
    const pngData = encodePNG(scaledWidth, totalScaledHeight, rgbaStrips);
    const blob = new Blob([pngData], { type: 'image/png' });

    // Try clipboard, fallback to download
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      if (window.DomTools && window.DomTools._showToast) {
        window.DomTools._showToast('HD screenshot copied to clipboard');
      }
    } catch (_) {
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.download = 'full-page-screenshot-hd.png';
      link.href = url;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      if (window.DomTools && window.DomTools._showToast) {
        window.DomTools._showToast('HD screenshot downloaded');
      }
    }
  }

  // =========================================================
  // Plugin registration
  // =========================================================

  function needsTiling(pageWidth, pageHeight, scale) {
    return (pageWidth * scale > MAX_CANVAS_DIM) ||
           (pageHeight * scale > MAX_CANVAS_DIM);
  }

  const plugin = {
    id: 'hd-capture',
    label: 'HD Capture',

    init(api) {
      console.log('[hd-capture] Plugin initialized');
      // Expose the HD capture hook
      window.DomTools._hdCapture = async function (w, h, scale) {
        console.log(`[hd-capture] Tiling ${w}x${h} @ ${scale}x`);
        await captureHD(w, h, scale, api.inspectorUI);
      };
      window.DomTools._hdCaptureNeeded = needsTiling;
      // Expose toast for progress updates
      window.DomTools._showToast = api.showToast;
    },

    enable() {},
    disable() {
      delete window.DomTools._hdCapture;
      delete window.DomTools._hdCaptureNeeded;
    },
  };

  if (window.DomTools) {
    window.DomTools.registerPlugin(plugin);
  } else {
    window.DomTools = window.DomTools || {};
    window.DomTools._pendingPlugins = window.DomTools._pendingPlugins || [];
    window.DomTools._pendingPlugins.push(plugin);
  }
})();

/**
 * Inspector Panel plugin — keyboard-first design token editor.
 *
 * Shows spacing (cross/plus layout), typography, and appearance controls
 * for the currently selected element. Token values are stepped with
 * arrow keys; raw values are editable inline.
 *
 * Prototype for issue #50.
 */
(function () {
  'use strict';

  const TOKEN_RE = /var\((--[\w-]+)/;

  // --- Token resolution ---

  function extractToken(value) {
    if (!value) return null;
    const m = value.match(TOKEN_RE);
    return m ? m[1] : null;
  }

  function splitShorthandValue(value) {
    const parts = [];
    let current = '', depth = 0;
    for (let i = 0; i < value.length; i++) {
      const ch = value[i];
      if (ch === '(') { depth++; current += ch; }
      else if (ch === ')') { depth--; current += ch; }
      else if (/\s/.test(ch) && depth === 0) {
        if (current) { parts.push(current); current = ''; }
      } else { current += ch; }
    }
    if (current) parts.push(current);
    return parts;
  }

  function expandBoxShorthand(value) {
    const parts = splitShorthandValue(value);
    let top, right, bottom, left;
    if (parts.length === 1) { top = right = bottom = left = parts[0]; }
    else if (parts.length === 2) { top = bottom = parts[0]; right = left = parts[1]; }
    else if (parts.length === 3) { top = parts[0]; right = left = parts[1]; bottom = parts[2]; }
    else { top = parts[0]; right = parts[1]; bottom = parts[2]; left = parts[3]; }
    return { top, right, bottom, left };
  }

  // --- Token discovery ---

  let _familyCache = null;

  function discoverTokenFamilies() {
    if (_familyCache) return _familyCache;
    const families = {};
    const rootStyles = getComputedStyle(document.documentElement);
    for (let s = 0; s < document.styleSheets.length; s++) {
      let rules;
      try { rules = document.styleSheets[s].cssRules; } catch (_) { continue; }
      if (!rules) continue;
      for (let i = 0; i < rules.length; i++) {
        const rule = rules[i];
        if (!(rule instanceof CSSStyleRule)) continue;
        if (rule.selectorText !== ':root' && rule.selectorText !== 'html') continue;
        for (let j = 0; j < rule.style.length; j++) {
          const name = rule.style[j];
          if (!name.startsWith('--')) continue;
          const value = rootStyles.getPropertyValue(name).trim();
          const family = getFamily(name);
          if (!families[family]) families[family] = [];
          families[family].push({ name, value });
        }
      }
    }
    _familyCache = families;
    return families;
  }

  function getFamily(tokenName) {
    const bare = tokenName.replace(/^--/, '');
    const parts = bare.split('-');
    if (parts.length <= 1) return bare;
    return parts.slice(0, -1).join('-');
  }

  function getFamilyTokens(tokenName) {
    const families = discoverTokenFamilies();
    const family = getFamily(tokenName);
    return families[family] || [];
  }

  function getFamilyByName(familyName) {
    const families = discoverTokenFamilies();
    return families[familyName] || [];
  }

  // Resolve a token name to its computed color value (for swatches)
  function resolveTokenColor(tokenName) {
    const rootStyles = getComputedStyle(document.documentElement);
    return rootStyles.getPropertyValue(tokenName).trim();
  }

  // --- Token resolution for an element ---

  function resolveAllTokens(el) {
    const tokens = {};
    for (let s = 0; s < document.styleSheets.length; s++) {
      let rules;
      try { rules = document.styleSheets[s].cssRules; } catch (_) { continue; }
      if (!rules) continue;
      processRules(rules, el, tokens);
    }
    if (el.style && el.style.length) {
      for (let i = 0; i < el.style.length; i++) {
        const prop = el.style[i];
        const raw = el.style.getPropertyValue(prop);
        if (raw && TOKEN_RE.test(raw)) {
          tokens[prop] = extractToken(raw);
        }
      }
    }
    return tokens;
  }

  function processRules(rules, el, tokens) {
    for (let i = 0; i < rules.length; i++) {
      const rule = rules[i];
      if (rule instanceof CSSMediaRule) {
        if (window.matchMedia(rule.conditionText).matches) {
          processRules(rule.cssRules, el, tokens);
        }
      } else if (rule instanceof CSSStyleRule) {
        try { if (!el.matches(rule.selectorText)) continue; } catch (_) { continue; }
        collectTokens(rule.style, tokens);
      }
    }
  }

  function collectTokens(style, tokens) {
    for (const prop of ['padding', 'margin']) {
      const raw = style.getPropertyValue(prop);
      if (raw && TOKEN_RE.test(raw)) {
        const expanded = expandBoxShorthand(raw);
        tokens[prop + '-top'] = extractToken(expanded.top);
        tokens[prop + '-right'] = extractToken(expanded.right);
        tokens[prop + '-bottom'] = extractToken(expanded.bottom);
        tokens[prop + '-left'] = extractToken(expanded.left);
      }
    }
    for (let i = 0; i < style.length; i++) {
      const prop = style[i];
      const raw = style.getPropertyValue(prop);
      if (raw && TOKEN_RE.test(raw)) {
        tokens[prop] = extractToken(raw);
      }
    }
  }

  // --- Change tracking ---

  const changes = [];

  function applyToken(el, cssProp, newToken, oldToken) {
    if (!el._dtOrigStyles) el._dtOrigStyles = {};
    if (!(cssProp in el._dtOrigStyles)) {
      el._dtOrigStyles[cssProp] = el.style.getPropertyValue(cssProp) || '';
    }
    el.style.setProperty(cssProp, `var(${newToken})`);
    const existing = changes.find(c => c.el === el && c.prop === cssProp);
    if (existing) {
      existing.to = newToken;
    } else {
      changes.push({
        el, prop: cssProp,
        from: oldToken || el._dtOrigStyles[cssProp],
        to: newToken,
        selector: api.getSelector(el),
      });
    }
    window.DomTools._inspectorChanges = changes;
    if (api.updateBadgeCount) api.updateBadgeCount();
  }

  function applyRawValue(el, cssProp, value) {
    if (!el._dtOrigStyles) el._dtOrigStyles = {};
    if (!(cssProp in el._dtOrigStyles)) {
      el._dtOrigStyles[cssProp] = el.style.getPropertyValue(cssProp) || '';
    }
    el.style.setProperty(cssProp, value);
    const existing = changes.find(c => c.el === el && c.prop === cssProp);
    if (existing) {
      existing.to = value;
    } else {
      changes.push({
        el, prop: cssProp,
        from: el._dtOrigStyles[cssProp],
        to: value,
        selector: api.getSelector(el),
      });
    }
    window.DomTools._inspectorChanges = changes;
    if (api.updateBadgeCount) api.updateBadgeCount();
  }

  function resetProp(el, cssProp) {
    el.style.removeProperty(cssProp);
    const idx = changes.findIndex(c => c.el === el && c.prop === cssProp);
    if (idx >= 0) changes.splice(idx, 1);
    window.DomTools._inspectorChanges = changes;
    if (api.updateBadgeCount) api.updateBadgeCount();
  }

  // --- Token usage indicators ---

  const INDICATOR_TOKEN = '#4ade80';  // green-400
  const INDICATOR_RAW = '#f59e0b';    // amber-500

  function indicatorDot(isToken) {
    const dot = el('span', {
      color: isToken ? INDICATOR_TOKEN : INDICATOR_RAW,
      fontSize: '7px',
      marginRight: '5px',
      flexShrink: '0',
      lineHeight: '1',
    });
    dot.textContent = '\u25CF';
    return dot;
  }

  // --- Spacing overlay ---

  const PAD_COLOR = 'rgba(144, 238, 144, 0.4)';
  const PAD_BRIGHT = 'rgba(144, 238, 144, 0.6)';
  const PAD_LABEL_BG = 'rgba(30, 90, 50, 0.9)';
  const MAR_COLOR = 'rgba(255, 165, 0, 0.35)';
  const MAR_BRIGHT = 'rgba(255, 165, 0, 0.55)';
  const MAR_LABEL_BG = 'rgba(140, 70, 0, 0.9)';

  let overlayEl = null;

  function clearOverlay() {
    if (overlayEl) { overlayEl.remove(); overlayEl = null; }
  }

  function showSpacingOverlay(prop, el) {
    clearOverlay();
    if (!el) return;
    const cs = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    const p = (v) => parseFloat(v) || 0;
    const isPadding = prop.startsWith('padding');
    const color = isPadding ? PAD_COLOR : MAR_COLOR;
    const brightColor = isPadding ? PAD_BRIGHT : MAR_BRIGHT;
    const labelBg = isPadding ? PAD_LABEL_BG : MAR_LABEL_BG;

    const sides = (prop === 'padding' || prop === 'margin')
      ? ['top', 'right', 'bottom', 'left']
      : [prop.split('-').pop()];

    const container = document.createElement('div');
    Object.assign(container.style, {
      position: 'fixed', top: '0', left: '0',
      width: '100%', height: '100%',
      pointerEvents: 'none', zIndex: '99998',
    });

    sides.forEach(side => {
      const fullProp = (isPadding ? 'padding-' : 'margin-') + side;
      const val = p(cs.getPropertyValue(fullProp));
      if (val <= 0) return;

      let x, y, w, h;
      if (isPadding) {
        const pt = p(cs.paddingTop), pr = p(cs.paddingRight), pb = p(cs.paddingBottom), pl = p(cs.paddingLeft);
        if (side === 'top') { x = rect.left; y = rect.top; w = rect.width; h = pt; }
        else if (side === 'bottom') { x = rect.left; y = rect.bottom - pb; w = rect.width; h = pb; }
        else if (side === 'left') { x = rect.left; y = rect.top + pt; w = pl; h = rect.height - pt - pb; }
        else { x = rect.right - pr; y = rect.top + pt; w = pr; h = rect.height - pt - pb; }
      } else {
        const mt = p(cs.marginTop), mr = p(cs.marginRight), mb = p(cs.marginBottom), ml = p(cs.marginLeft);
        if (side === 'top') { x = rect.left; y = rect.top - mt; w = rect.width; h = mt; }
        else if (side === 'bottom') { x = rect.left; y = rect.bottom; w = rect.width; h = mb; }
        else if (side === 'left') { x = rect.left - ml; y = rect.top - mt; w = ml; h = rect.height + mt + mb; }
        else { x = rect.right; y = rect.top - mt; w = mr; h = rect.height + mt + mb; }
      }

      const box = document.createElement('div');
      Object.assign(box.style, {
        position: 'fixed', top: y + 'px', left: x + 'px',
        width: w + 'px', height: h + 'px',
        background: sides.length === 1 ? brightColor : color,
      });
      container.appendChild(box);

      if (w >= 14 || h >= 14) {
        const lbl = document.createElement('span');
        Object.assign(lbl.style, {
          position: 'fixed',
          top: (y + h / 2) + 'px', left: (x + w / 2) + 'px',
          transform: 'translate(-50%, -50%)',
          font: '9px/1 ui-monospace, Menlo, monospace',
          color: '#fff', background: labelBg,
          padding: '2px 5px', borderRadius: '2px',
          whiteSpace: 'nowrap',
        });
        lbl.textContent = Math.round(val) + 'px';
        container.appendChild(lbl);
      }
    });

    document.body.appendChild(container);
    overlayEl = container;
  }

  // --- DOM helpers ---

  function el(tag, styles, attrs) {
    const node = document.createElement(tag);
    if (styles) Object.assign(node.style, styles);
    if (attrs) Object.entries(attrs).forEach(([k, v]) => node.setAttribute(k, v));
    return node;
  }

  // --- Panel rendering ---

  let panel = null;
  let content = null;
  let api = null;
  let lastEl = null;

  function renderPanel(targetEl) {
    if (!targetEl || !content) return;
    lastEl = targetEl;
    content.innerHTML = '';

    const computed = getComputedStyle(targetEl);
    const tokens = resolveAllTokens(targetEl);
    const selector = api.getSelector(targetEl);

    // --- Selector header ---
    const headerDiv = el('div', { marginBottom: '10px', paddingBottom: '8px', borderBottom: '1px solid rgba(255,255,255,0.1)' });
    const selectorLabel = el('div', { fontSize: '10px', color: 'rgba(255,255,255,0.5)', marginBottom: '2px' });
    selectorLabel.textContent = 'SELECTOR';
    const selectorCode = el('code', { fontSize: '11px', color: '#7dd3fc', wordBreak: 'break-all' });
    selectorCode.textContent = selector;
    headerDiv.appendChild(selectorLabel);
    headerDiv.appendChild(selectorCode);
    content.appendChild(headerDiv);

    // --- SPACING section ---
    content.appendChild(sectionLabel('SPACING'));
    content.appendChild(buildCross('padding', targetEl, tokens, computed));
    content.appendChild(buildCross('margin', targetEl, tokens, computed));

    // Gap — always show (editable even at 0)
    const gapToken = tokens['gap'] || null;
    const gapVal = computed.getPropertyValue('gap');
    if (gapToken) {
      content.appendChild(buildPropRow('gap', gapToken, gapVal, targetEl, 'sp'));
    } else {
      content.appendChild(buildValueRow('gap', gapVal || '0', targetEl, 1));
    }

    // --- TYPOGRAPHY section ---
    content.appendChild(sectionLabel('TYPOGRAPHY'));

    const typProps = [
      { prop: 'font-family', family: null, isValue: false },
      { prop: 'font-size', family: null, isValue: false },
      { prop: 'font-weight', family: null, isValue: true, step: 100 },
      { prop: 'line-height', family: null, isValue: true, step: 0.1 },
      { prop: 'color', family: null, isValue: false, hasColor: true },
    ];
    for (const def of typProps) {
      const token = tokens[def.prop] || null;
      const val = computed.getPropertyValue(def.prop);
      if (!val) continue;
      if (def.isValue || (!token && def.step)) {
        content.appendChild(buildValueRow(def.prop, val, targetEl, def.step || 1));
      } else if (token) {
        content.appendChild(buildPropRow(def.prop, token, val, targetEl, null, def.hasColor));
      } else {
        content.appendChild(buildStaticRow(def.prop, val));
      }
    }

    // --- APPEARANCE section ---
    content.appendChild(sectionLabel('APPEARANCE'));

    const appProps = [
      { prop: 'background-color', label: 'background', family: null, isValue: false, hasColor: true },
      { prop: 'border-radius', family: null, isValue: false },
      { prop: 'border-color', family: null, isValue: false, hasColor: true },
      { prop: 'border-width', family: null, isValue: true, step: 1 },
    ];
    for (const def of appProps) {
      const token = tokens[def.prop] || null;
      const val = computed.getPropertyValue(def.prop);
      if (!val) continue;
      if (def.isValue || (!token && def.step)) {
        content.appendChild(buildValueRow(def.label || def.prop, val, targetEl, def.step || 1));
      } else if (token) {
        content.appendChild(buildPropRow(def.label || def.prop, token, val, targetEl, null, def.hasColor));
      } else {
        content.appendChild(buildStaticRow(def.label || def.prop, truncate(val, 30)));
      }
    }

    // Wire Tab cycling across all controls
    wireTabCycling();
  }

  // --- Section label ---

  function sectionLabel(text) {
    const lbl = el('div', {
      fontSize: '9px', fontWeight: '700',
      color: 'rgba(255,255,255,0.4)', letterSpacing: '0.5px',
      marginBottom: '4px', marginTop: '10px',
    });
    lbl.textContent = text;
    return lbl;
  }

  // --- Cross/Plus grid for padding/margin ---

  function buildCross(type, targetEl, tokens, computed) {
    const isPadding = type === 'padding';
    const accentColor = isPadding ? 'rgba(80,200,120,' : 'rgba(255,165,0,';

    // Count tokenized sides
    const sides = ['top', 'right', 'bottom', 'left'];
    const tokenCount = sides.filter(s => !!tokens[`${type}-${s}`]).length;

    const wrapper = el('div', { marginBottom: '10px' });

    // Label with token count
    const label = el('div', {
      fontSize: '9px', fontWeight: '600', letterSpacing: '0.3px',
      color: accentColor + '0.7)', marginBottom: '4px', textAlign: 'center',
      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
    });
    const labelText = el('span');
    labelText.textContent = type;
    label.appendChild(labelText);
    const countBadge = el('span', {
      fontSize: '8px', fontWeight: '600',
      color: tokenCount === 4 ? INDICATOR_TOKEN : tokenCount > 0 ? INDICATOR_RAW : 'rgba(255,255,255,0.3)',
    });
    countBadge.textContent = `${tokenCount}/4`;
    label.appendChild(countBadge);
    wrapper.appendChild(label);

    // Grid
    const grid = el('div', {
      display: 'grid',
      gridTemplateColumns: '1fr auto 1fr',
      gridTemplateRows: 'auto auto auto',
      gap: '2px',
      alignItems: 'center',
      justifyItems: 'center',
      maxWidth: '220px',
      margin: '0 auto',
    });

    const positions = {
      top: { gridColumn: '2', gridRow: '1' },
      left: { gridColumn: '1', gridRow: '2' },
      right: { gridColumn: '3', gridRow: '2' },
      bottom: { gridColumn: '2', gridRow: '3' },
    };

    const stepSpans = [];

    // Side cells
    sides.forEach(side => {
      const prop = `${type}-${side}`;
      const token = tokens[prop] || null;
      const val = computed.getPropertyValue(prop);

      const cell = el('div', positions[side]);
      const span = createTokenStep(token, prop, targetEl, 'sp', isPadding);
      stepSpans.push(span);
      cell.appendChild(span);
      grid.appendChild(cell);
    });

    // "All" center cell
    const centerCell = el('div', { gridColumn: '2', gridRow: '2' });
    const allSpan = el('span', {
      fontSize: '10px', minWidth: '50px', padding: '3px 6px',
      borderRadius: '4px', textAlign: 'center', cursor: 'pointer',
      outline: 'none', whiteSpace: 'nowrap',
      background: accentColor + '0.15)',
      color: accentColor + '0.9)',
      transition: 'background 0.12s, box-shadow 0.12s',
    }, { tabindex: '0' });
    allSpan.textContent = 'all';
    allSpan.classList.add('dt-token-step', 'dt-cross-all');
    allSpan.dataset.prop = type;
    allSpan.dataset.family = 'sp';

    // "All" interaction — steps all 4 sides together
    attachAllControl(allSpan, stepSpans, type, targetEl);
    centerCell.appendChild(allSpan);
    grid.appendChild(centerCell);

    wrapper.appendChild(grid);
    return wrapper;
  }

  function createTokenStep(token, prop, targetEl, defaultFamily, isPadding) {
    const hasToken = !!token;
    const family = hasToken ? getFamily(token) : defaultFamily;

    const span = el('span', {
      fontSize: '10px', minWidth: '70px', padding: '3px 6px',
      borderRadius: '4px', textAlign: 'center', cursor: 'pointer',
      outline: 'none', whiteSpace: 'nowrap',
      color: hasToken ? '#fbbf24' : 'rgba(255,255,255,0.4)',
      background: 'rgba(251,191,36,0.08)',
      transition: 'background 0.12s, box-shadow 0.12s',
    }, { tabindex: '0' });
    span.textContent = hasToken ? token : '0';
    span.classList.add('dt-token-step');
    span.dataset.prop = prop;
    span.dataset.token = token || '';
    span.dataset.family = family || '';

    attachTokenStepHandlers(span, targetEl);
    return span;
  }

  // --- Token step keyboard handlers ---

  function attachTokenStepHandlers(span, targetEl) {
    const prop = span.dataset.prop;

    span.addEventListener('click', (e) => { e.stopPropagation(); span.focus(); });

    span.addEventListener('focus', () => {
      span.style.background = 'rgba(251,191,36,0.22)';
      span.style.boxShadow = '0 0 0 2px rgba(251,191,36,0.6)';
      if (prop.startsWith('padding') || prop.startsWith('margin')) {
        showSpacingOverlay(prop, targetEl);
      }
    });

    span.addEventListener('blur', () => {
      span.style.background = 'rgba(251,191,36,0.08)';
      span.style.boxShadow = '';
      clearOverlay();
    });

    span.addEventListener('mouseenter', () => {
      if (document.activeElement !== span) {
        span.style.background = 'rgba(251,191,36,0.18)';
        span.style.boxShadow = '0 0 0 1px rgba(251,191,36,0.3)';
      }
      if (prop.startsWith('padding') || prop.startsWith('margin')) {
        showSpacingOverlay(prop, targetEl);
      }
    });

    span.addEventListener('mouseleave', () => {
      if (document.activeElement !== span) {
        span.style.background = 'rgba(251,191,36,0.08)';
        span.style.boxShadow = '';
        clearOverlay();
      }
    });

    span.addEventListener('keydown', (e) => {
      const family = span.dataset.family;
      const scale = getFamilyByName(family);

      if (e.key === 'ArrowUp' || e.key === 'ArrowRight') {
        e.preventDefault();
        if (scale && scale.length) {
          stepToken(span, scale, 1, targetEl);
        } else {
          stepRawPx(span, 1, targetEl, e.shiftKey);
        }
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') {
        e.preventDefault();
        if (scale && scale.length) {
          stepToken(span, scale, -1, targetEl);
        } else {
          stepRawPx(span, -1, targetEl, e.shiftKey);
        }
      } else if (e.key === 'Backspace' || e.key === 'Delete') {
        e.preventDefault();
        resetProp(targetEl, prop);
        span.textContent = '0';
        span.style.color = 'rgba(255,255,255,0.4)';
        span.dataset.token = '';
      } else if (e.key === 'Escape') {
        span.blur();
      } else if (e.key === 'Tab') {
        e.preventDefault();
        cycleControl(span, e.shiftKey);
      }
    });
  }

  function stepRawPx(span, dir, targetEl, shiftKey) {
    const prop = span.dataset.prop;
    const current = parseFloat(span.textContent) || 0;
    const step = shiftKey ? 10 : 1;
    const next = Math.max(0, current + dir * step);
    const val = next + 'px';
    span.textContent = val;
    span.style.color = '#7dd3fc';
    applyRawValue(targetEl, prop, val);
    if (prop.startsWith('padding') || prop.startsWith('margin')) {
      showSpacingOverlay(prop, targetEl);
    }
  }

  function stepToken(span, scale, dir, targetEl) {
    const currentToken = span.dataset.token;
    let idx = scale.findIndex(t => t.name === currentToken);
    if (idx < 0) idx = 0;
    idx = Math.max(0, Math.min(scale.length - 1, idx + dir));

    const token = scale[idx];
    span.dataset.token = token.name;
    span.textContent = token.name;
    span.style.color = '#fbbf24';

    const prop = span.dataset.prop;
    applyToken(targetEl, prop, token.name, currentToken);

    if (prop.startsWith('padding') || prop.startsWith('margin')) {
      showSpacingOverlay(prop, targetEl);
    }

    // Update swatch if in a row with one
    const row = span.closest('.dt-prop-row');
    if (row) {
      const swatch = row.querySelector('.dt-color-swatch');
      if (swatch) {
        swatch.style.background = resolveTokenColor(token.name);
      }
    }
  }

  // --- "All" center control ---

  function attachAllControl(allSpan, sideSpans, type, targetEl) {
    allSpan.addEventListener('click', (e) => { e.stopPropagation(); allSpan.focus(); });

    allSpan.addEventListener('focus', () => {
      const isPadding = type === 'padding';
      const accent = isPadding ? 'rgba(80,200,120,' : 'rgba(255,165,0,';
      allSpan.style.boxShadow = '0 0 0 2px ' + accent + '0.6)';
      showSpacingOverlay(type, targetEl);
    });

    allSpan.addEventListener('blur', () => {
      allSpan.style.boxShadow = '';
      clearOverlay();
    });

    allSpan.addEventListener('keydown', (e) => {
      const family = allSpan.dataset.family;
      const scale = getFamilyByName(family);
      if (!scale || !scale.length) return;

      if (e.key === 'ArrowUp' || e.key === 'ArrowRight') {
        e.preventDefault();
        stepAll(allSpan, sideSpans, scale, 1, type, targetEl);
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') {
        e.preventDefault();
        stepAll(allSpan, sideSpans, scale, -1, type, targetEl);
      } else if (e.key === 'Backspace' || e.key === 'Delete') {
        e.preventDefault();
        ['top', 'right', 'bottom', 'left'].forEach(side => {
          resetProp(targetEl, `${type}-${side}`);
        });
        sideSpans.forEach(s => {
          s.textContent = '\u2014';
          s.style.color = 'rgba(255,255,255,0.3)';
          s.dataset.token = '';
        });
        allSpan.textContent = '\u2014';
      } else if (e.key === 'Escape') {
        allSpan.blur();
      } else if (e.key === 'Tab') {
        e.preventDefault();
        cycleControl(allSpan, e.shiftKey);
      }
    });
  }

  function stepAll(allSpan, sideSpans, scale, dir, type, targetEl) {
    // Use the first side's current index as reference
    const refToken = sideSpans[0].dataset.token;
    let idx = scale.findIndex(t => t.name === refToken);
    if (idx < 0) idx = 0;
    idx = Math.max(0, Math.min(scale.length - 1, idx + dir));

    const token = scale[idx];
    allSpan.textContent = token.name;
    allSpan.dataset.token = token.name;

    const sides = ['top', 'right', 'bottom', 'left'];
    sideSpans.forEach((span, i) => {
      span.dataset.token = token.name;
      span.textContent = token.name;
      span.style.color = '#fbbf24';
      applyToken(targetEl, `${type}-${sides[i]}`, token.name, span.dataset.token);
    });

    showSpacingOverlay(type, targetEl);
  }

  // --- Property row builders ---

  function buildPropRow(label, token, val, targetEl, defaultFamily, hasColor) {
    const row = el('div', {
      display: 'flex', gap: '6px', alignItems: 'center',
      padding: '2px 0', fontSize: '11px',
    });
    row.classList.add('dt-prop-row');

    row.appendChild(indicatorDot(true));
    const nameSpan = el('span', { color: 'rgba(255,255,255,0.6)', minWidth: '70px', flexShrink: '0' });
    nameSpan.textContent = label;
    row.appendChild(nameSpan);

    // Color swatch
    if (hasColor && token) {
      const swatch = el('span', {
        width: '12px', height: '12px', borderRadius: '3px',
        border: '1px solid rgba(255,255,255,0.2)',
        marginLeft: 'auto', flexShrink: '0',
        background: resolveTokenColor(token),
      });
      swatch.classList.add('dt-color-swatch');
      row.appendChild(swatch);
    }

    // Token step
    const family = token ? getFamily(token) : defaultFamily;
    const span = el('span', {
      color: '#fbbf24', fontSize: '11px', whiteSpace: 'nowrap',
      cursor: 'pointer', padding: '4px 10px', borderRadius: '4px',
      background: 'rgba(251,191,36,0.08)', minWidth: '100px',
      textAlign: 'center', outline: 'none',
      marginLeft: hasColor ? '0' : 'auto',
      transition: 'background 0.12s, box-shadow 0.12s',
    }, { tabindex: '0' });
    span.textContent = token;
    span.classList.add('dt-token-step');
    span.dataset.prop = label.includes('-') ? label : label; // use actual CSS prop
    span.dataset.token = token;
    span.dataset.family = family || '';

    // For non-spacing props, we still want the prop name to be the CSS property
    // Fix: use the actual prop (could differ from label for background-color→background)
    const cssProp = label === 'background' ? 'background-color' : label;
    span.dataset.prop = cssProp;

    attachTokenStepHandlers(span, targetEl);
    row.appendChild(span);
    return row;
  }

  function buildValueRow(prop, val, targetEl, step) {
    const row = el('div', {
      display: 'flex', gap: '6px', alignItems: 'center',
      padding: '2px 0', fontSize: '11px',
    });
    row.classList.add('dt-prop-row');

    row.appendChild(indicatorDot(false));
    const nameSpan = el('span', { color: 'rgba(255,255,255,0.6)', minWidth: '70px', flexShrink: '0' });
    nameSpan.textContent = prop;
    row.appendChild(nameSpan);

    const input = el('span', {
      color: '#7dd3fc', fontSize: '11px', whiteSpace: 'nowrap',
      cursor: 'text', padding: '4px 10px', borderRadius: '4px',
      background: 'rgba(125,211,252,0.08)', minWidth: '60px',
      textAlign: 'center', outline: 'none', marginLeft: 'auto',
      transition: 'background 0.12s, box-shadow 0.12s',
    }, { tabindex: '0', contenteditable: 'true' });
    // Show simplified value (extract number if possible)
    const numVal = parseFloat(val);
    input.textContent = isNaN(numVal) ? val : numVal.toString();
    input.classList.add('dt-value-input');
    input.dataset.prop = prop;

    attachValueInputHandlers(input, targetEl, step);
    row.appendChild(input);
    return row;
  }

  function buildStaticRow(label, val) {
    const row = el('div', {
      display: 'flex', gap: '6px', alignItems: 'center',
      padding: '2px 0', fontSize: '11px',
    });
    row.appendChild(indicatorDot(false));
    const nameSpan = el('span', { color: 'rgba(255,255,255,0.6)', minWidth: '70px', flexShrink: '0' });
    nameSpan.textContent = label;
    const valSpan = el('span', { color: 'rgba(255,255,255,0.8)', marginLeft: 'auto' });
    valSpan.textContent = truncate(val, 30);
    row.appendChild(nameSpan);
    row.appendChild(valSpan);
    return row;
  }

  // --- Value input handlers ---

  function attachValueInputHandlers(input, targetEl, step) {
    const prop = input.dataset.prop;

    input.addEventListener('focus', () => {
      input.style.background = 'rgba(125,211,252,0.18)';
      input.style.boxShadow = '0 0 0 2px rgba(125,211,252,0.6)';
      // Select all
      const range = document.createRange();
      range.selectNodeContents(input);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    });

    input.addEventListener('blur', () => {
      input.style.background = 'rgba(125,211,252,0.08)';
      input.style.boxShadow = '';
      const val = input.textContent.trim();
      if (!val || val === '\u2014') {
        input.textContent = '\u2014';
        input.style.color = 'rgba(255,255,255,0.3)';
        resetProp(targetEl, prop);
      } else {
        input.style.color = '#7dd3fc';
        applyRawValue(targetEl, prop, val);
      }
    });

    input.addEventListener('mouseenter', () => {
      if (document.activeElement !== input) {
        input.style.background = 'rgba(125,211,252,0.15)';
        input.style.boxShadow = '0 0 0 1px rgba(125,211,252,0.3)';
      }
    });

    input.addEventListener('mouseleave', () => {
      if (document.activeElement !== input) {
        input.style.background = 'rgba(125,211,252,0.08)';
        input.style.boxShadow = '';
      }
    });

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        input.blur();
      } else if (e.key === 'Escape') {
        input.blur();
      } else if (e.key === 'Tab') {
        e.preventDefault();
        const val = input.textContent.trim();
        if (val && val !== '\u2014') applyRawValue(targetEl, prop, val);
        cycleControl(input, e.shiftKey);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        const num = parseFloat(input.textContent);
        if (!isNaN(num)) {
          const s = e.shiftKey && step === 1 ? 10 : step;
          input.textContent = parseFloat((num + s).toFixed(2)).toString();
          applyRawValue(targetEl, prop, input.textContent);
        }
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        const num = parseFloat(input.textContent);
        if (!isNaN(num)) {
          const s = e.shiftKey && step === 1 ? 10 : step;
          input.textContent = parseFloat(Math.max(0, num - s).toFixed(2)).toString();
          applyRawValue(targetEl, prop, input.textContent);
        }
      }
    });
  }

  // --- Tab cycling ---

  function wireTabCycling() {
    // Tab cycling is handled in each keydown handler via cycleControl()
  }

  function cycleControl(current, reverse) {
    const all = [...content.querySelectorAll('.dt-token-step, .dt-value-input')];
    const i = all.indexOf(current);
    if (i < 0) return;
    const next = reverse
      ? all[(i - 1 + all.length) % all.length]
      : all[(i + 1) % all.length];
    next.focus();
  }

  // --- Utility ---

  function truncate(str, max) {
    return str.length > max ? str.slice(0, max) + '\u2026' : str;
  }

  // --- Selection tracking ---

  function onSelectionChange() {
    const sel = api.getSelected();
    if (sel.length > 0) {
      const last = sel[sel.length - 1];
      renderPanel(last.el);
      panel.style.display = '';
    } else {
      panel.style.display = 'none';
    }
  }

  let pollInterval = null;
  let lastSelCount = 0;
  let lastSelEl = null;

  function startPolling() {
    pollInterval = setInterval(() => {
      const sel = api.getSelected();
      const curEl = sel.length > 0 ? sel[sel.length - 1].el : null;
      if (sel.length !== lastSelCount || curEl !== lastSelEl) {
        lastSelCount = sel.length;
        lastSelEl = curEl;
        onSelectionChange();
      }
    }, 150);
  }

  function stopPolling() {
    if (pollInterval) { clearInterval(pollInterval); pollInterval = null; }
  }

  // --- Plugin registration ---

  const plugin = {
    id: 'inspector-panel',
    label: 'Inspector Panel',
    // No icon — not a toolbar mode. Shows automatically when an element is selected.

    init(_api) {
      api = _api;
      panel = api.createPanel({
        title: 'Inspector',
        position: { top: '80px', right: '16px' },
        width: '320px',
      });
      content = panel._content;
      Object.assign(content.style, {
        maxHeight: '60vh',
        overflowY: 'auto',
        overflowX: 'hidden',
        scrollbarWidth: 'none',
      });
      panel.style.display = 'none';
      startPolling();
      window.DomTools._inspectorChanges = changes;
    if (api.updateBadgeCount) api.updateBadgeCount();
    },

    enable() {
      startPolling();
    },

    disable() {
      stopPolling();
      clearOverlay();
      if (panel) panel.style.display = 'none';
    },
  };

  if (window.DomTools) {
    window.DomTools.registerPlugin(plugin);
  } else {
    window.DomTools = window.DomTools || {};
    window.DomTools._pendingPlugins = window.DomTools._pendingPlugins || [];
    window.DomTools._pendingPlugins.push(plugin);
  }
})();

/**
 * Inspector Panel (NYT-CSS) — token audit variant with hardcoded NYT token families.
 *
 * Knows which CSS properties SHOULD use NYT design tokens, so it can flag
 * raw values even on pages that don't define :root custom properties.
 * Extends the same keyboard-first editing UX as the universal inspector.
 */
(function () {
  'use strict';

  const TOKEN_RE = /var\((--[\w-]+)/;

  // --- NYT Token Definitions ---

  const NYT_TOKENS = {
    sp: [
      { name: '--sp-0', value: '0' },
      { name: '--sp-1', value: '0.25rem' },
      { name: '--sp-2', value: '0.5rem' },
      { name: '--sp-3', value: '0.75rem' },
      { name: '--sp-4', value: '1rem' },
      { name: '--sp-5', value: '1.5rem' },
      { name: '--sp-6', value: '2rem' },
      { name: '--sp-7', value: '3rem' },
      { name: '--sp-8', value: '4rem' },
      { name: '--sp-10', value: '5rem' },
      { name: '--sp-12', value: '6rem' },
      { name: '--sp-16', value: '8rem' },
    ],
    ts: [
      { name: '--ts-xs', value: '11px' },
      { name: '--ts-sm', value: '13px' },
      { name: '--ts-base', value: '15px' },
      { name: '--ts-md', value: '17px' },
      { name: '--ts-lg', value: '20px' },
      { name: '--ts-xl', value: '26px' },
      { name: '--ts-2xl', value: '34px' },
      { name: '--ts-3xl', value: '42px' },
      { name: '--ts-4xl', value: '52px' },
      { name: '--ts-5xl', value: '64px' },
      { name: '--ts-6xl', value: '80px' },
    ],
    lh: [
      { name: '--lh-solid', value: '1' },
      { name: '--lh-title', value: '1.2' },
      { name: '--lh-heading', value: '1.3' },
      { name: '--lh-copy', value: '1.55' },
      { name: '--lh-loose', value: '1.8' },
    ],
    ls: [
      { name: '--ls-tight', value: '-0.02em' },
      { name: '--ls-none', value: '0' },
      { name: '--ls-tracked', value: '0.05em' },
      { name: '--ls-mega', value: '0.15em' },
    ],
    br: [
      { name: '--br-0', value: '0' },
      { name: '--br-1', value: '2px' },
      { name: '--br-2', value: '4px' },
      { name: '--br-3', value: '8px' },
      { name: '--br-4', value: '12px' },
      { name: '--br-5', value: '16px' },
      { name: '--br-pill', value: '9999px' },
      { name: '--br-full', value: '100%' },
    ],
    bw: [
      { name: '--bw-0', value: '0' },
      { name: '--bw-1', value: '1px' },
      { name: '--bw-2', value: '2px' },
      { name: '--bw-3', value: '4px' },
      { name: '--bw-4', value: '8px' },
    ],
    shadow: [
      { name: '--shadow-1', value: '0 1px 2px rgba(0, 0, 0, 0.08)' },
      { name: '--shadow-2', value: '0 2px 4px rgba(0, 0, 0, 0.1)' },
      { name: '--shadow-3', value: '0 4px 8px rgba(0, 0, 0, 0.12)' },
      { name: '--shadow-4', value: '0 8px 16px rgba(0, 0, 0, 0.14)' },
      { name: '--shadow-5', value: '0 16px 32px rgba(0, 0, 0, 0.16)' },
    ],
    ease: [
      { name: '--ease-fast', value: '0.1s ease' },
      { name: '--ease-normal', value: '0.2s ease' },
      { name: '--ease-slow', value: '0.4s ease' },
    ],
    mw: [
      { name: '--mw-narrow', value: '560px' },
      { name: '--mw-container', value: '760px' },
      { name: '--mw-wide', value: '960px' },
      { name: '--mw-full', value: '1200px' },
    ],
    'nyt-fg': [
      { name: '--nyt-fg', value: '#121212' },
      { name: '--nyt-fg-dim', value: '#5a5a5a' },
      { name: '--nyt-fg-faint', value: '#8b8b8b' },
    ],
    'nyt-bg': [
      { name: '--nyt-bg', value: '#ffffff' },
      { name: '--nyt-bg-alt', value: '#f5f5f2' },
    ],
    'nyt-border': [
      { name: '--nyt-border', value: '#ececec' },
      { name: '--nyt-border-strong', value: '#c7c7c7' },
    ],
    'nyt-accent': [
      { name: '--nyt-accent', value: '#326891' },
      { name: '--nyt-red', value: '#c13b2a' },
      { name: '--nyt-orange', value: '#b87a00' },
      { name: '--nyt-green', value: '#3f7f63' },
    ],
    viz: [
      { name: '--viz-1', value: '#2A6586' },
      { name: '--viz-2', value: '#6CBAAB' },
      { name: '--viz-3', value: '#B2A5E7' },
      { name: '--viz-4', value: '#F66043' },
      { name: '--viz-5', value: '#D2E463' },
      { name: '--viz-6', value: '#F1A05B' },
      { name: '--viz-7', value: '#657D53' },
      { name: '--viz-8', value: '#BD5D91' },
    ],
    'viz-blue': [
      { name: '--viz-blue-1', value: '#242b40' },
      { name: '--viz-blue-2', value: '#1f497d' },
      { name: '--viz-blue-3', value: '#00577e' },
      { name: '--viz-blue-4', value: '#80b0c1' },
    ],
    'viz-green': [
      { name: '--viz-green-1', value: '#437661' },
      { name: '--viz-green-2', value: '#6a9b87' },
      { name: '--viz-green-3', value: '#a8ddc7' },
      { name: '--viz-green-4', value: '#e2eceb' },
    ],
    'viz-product': [
      { name: '--viz-core', value: '#2F3E7A' },
      { name: '--viz-cooking', value: '#f9351a' },
      { name: '--viz-games', value: '#F8CD0F' },
      { name: '--viz-athletic', value: '#30522D' },
      { name: '--viz-wirecutter', value: '#6085ff' },
      { name: '--viz-audio', value: '#357a8a' },
    ],
    'nyt-font': [
      { name: '--nyt-sans', value: "'nyt-franklin', -apple-system, BlinkMacSystemFont, 'Helvetica Neue', sans-serif" },
      { name: '--nyt-sans-small', value: "'nyt-franklin-small', -apple-system, BlinkMacSystemFont, 'Helvetica Neue', sans-serif" },
      { name: '--nyt-serif', value: "'nyt-cheltenham', Georgia, 'Times New Roman', serif" },
      { name: '--nyt-serif-cond', value: "'nyt-cheltenham-cond', Georgia, 'Times New Roman', serif" },
      { name: '--nyt-serif-wide', value: "'nyt-cheltenham-wide', Georgia, 'Times New Roman', serif" },
      { name: '--nyt-serif-small', value: "'nyt-cheltenham-small', Georgia, 'Times New Roman', serif" },
      { name: '--nyt-serif-scaps', value: "'nyt-cheltenham-scaps', Georgia, 'Times New Roman', serif" },
      { name: '--nyt-imperial', value: "'nyt-imperial', Georgia, 'Times New Roman', serif" },
      { name: '--nyt-display', value: "'nyt-karnak', Georgia, serif" },
      { name: '--nyt-display-cond', value: "'nyt-karnak-cond', Georgia, serif" },
      { name: '--nyt-display-small', value: "'nyt-karnak-small', Georgia, serif" },
      { name: '--nyt-mag', value: "'nyt-kippenberger', Georgia, serif" },
      { name: '--nyt-mag-cond', value: "'nyt-kippenberger-condensed', Georgia, serif" },
      { name: '--nyt-mag-poster', value: "'nyt-kippenberger-poster', Georgia, serif" },
      { name: '--nyt-mag-sans', value: "'nyt-magsans', -apple-system, BlinkMacSystemFont, sans-serif" },
      { name: '--nyt-mag-serif', value: "'nyt-magserif', Georgia, serif" },
      { name: '--nyt-mag-slab', value: "'nyt-magslab', Georgia, serif" },
      { name: '--nyt-fact', value: "'nyt-fact', -apple-system, BlinkMacSystemFont, 'Helvetica Neue', sans-serif" },
      { name: '--nyt-fact-display', value: "'nyt-fact-display', -apple-system, BlinkMacSystemFont, 'Helvetica Neue', sans-serif" },
      { name: '--nyt-athletic', value: "'nyt-athletic-slab', Georgia, serif" },
      { name: '--nyt-schnyder', value: "'nyt-schnyder-s', Georgia, serif" },
      { name: '--nyt-mono', value: "'nyt-ibm-plex', ui-monospace, SFMono-Regular, Menlo, Monaco, monospace" },
      { name: '--nyt-prototype', value: "'Comic Sans MS', 'Comic Sans', cursive" },
    ],
  };

  // Maps CSS properties to their expected NYT token family
  const PROP_FAMILY_MAP = {
    'padding-top': 'sp', 'padding-right': 'sp', 'padding-bottom': 'sp', 'padding-left': 'sp',
    'margin-top': 'sp', 'margin-right': 'sp', 'margin-bottom': 'sp', 'margin-left': 'sp',
    'gap': 'sp',
    'font-size': 'ts',
    'line-height': 'lh',
    'letter-spacing': 'ls',
    'border-radius': 'br',
    'border-top-left-radius': 'br', 'border-top-right-radius': 'br',
    'border-bottom-left-radius': 'br', 'border-bottom-right-radius': 'br',
    'border-width': 'bw',
    'border-top-width': 'bw', 'border-right-width': 'bw',
    'border-bottom-width': 'bw', 'border-left-width': 'bw',
    'color': 'nyt-fg',
    'background-color': 'nyt-bg',
    'border-color': 'nyt-border',
    'border-top-color': 'nyt-border', 'border-right-color': 'nyt-border',
    'border-bottom-color': 'nyt-border', 'border-left-color': 'nyt-border',
    'font-family': 'nyt-font',
    'box-shadow': 'shadow',
    'max-width': 'mw',
    'transition': 'ease',
  };

  // --- Inject token CSS vars into page (so var() resolves on any page) ---

  let injectedStyleEl = null;

  function injectTokenStyles() {
    if (injectedStyleEl) return;
    const rules = [':root {'];
    for (const family of Object.values(NYT_TOKENS)) {
      for (const tok of family) {
        rules.push(`  ${tok.name}: ${tok.value};`);
      }
    }
    rules.push('}');
    injectedStyleEl = document.createElement('style');
    injectedStyleEl.id = 'dt-nyt-injected-tokens';
    injectedStyleEl.textContent = rules.join('\n');
    document.head.appendChild(injectedStyleEl);
  }

  function removeTokenStyles() {
    if (injectedStyleEl) { injectedStyleEl.remove(); injectedStyleEl = null; }
  }

  // --- Token resolution ---

  function extractToken(value) {
    if (!value) return null;
    const m = value.match(TOKEN_RE);
    return m ? m[1] : null;
  }

  function splitShorthandValue(value) {
    const parts = [];
    let current = '', depth = 0;
    for (let i = 0; i < value.length; i++) {
      const ch = value[i];
      if (ch === '(') { depth++; current += ch; }
      else if (ch === ')') { depth--; current += ch; }
      else if (/\s/.test(ch) && depth === 0) {
        if (current) { parts.push(current); current = ''; }
      } else { current += ch; }
    }
    if (current) parts.push(current);
    return parts;
  }

  function expandBoxShorthand(value) {
    const parts = splitShorthandValue(value);
    let top, right, bottom, left;
    if (parts.length === 1) { top = right = bottom = left = parts[0]; }
    else if (parts.length === 2) { top = bottom = parts[0]; right = left = parts[1]; }
    else if (parts.length === 3) { top = parts[0]; right = left = parts[1]; bottom = parts[2]; }
    else { top = parts[0]; right = parts[1]; bottom = parts[2]; left = parts[3]; }
    return { top, right, bottom, left };
  }

  // --- Token discovery (uses hardcoded NYT tokens) ---

  function getFamily(tokenName) {
    // Check if token belongs to any known family
    for (const [familyName, tokens] of Object.entries(NYT_TOKENS)) {
      if (tokens.some(t => t.name === tokenName)) return familyName;
    }
    // Fallback: split by last dash
    const bare = tokenName.replace(/^--/, '');
    const parts = bare.split('-');
    if (parts.length <= 1) return bare;
    return parts.slice(0, -1).join('-');
  }

  function getFamilyTokens(tokenName) {
    const family = getFamily(tokenName);
    return NYT_TOKENS[family] || [];
  }

  function getFamilyByName(familyName) {
    return NYT_TOKENS[familyName] || [];
  }

  function getExpectedFamily(cssProp) {
    return PROP_FAMILY_MAP[cssProp] || null;
  }

  function resolveTokenColor(tokenName) {
    // Try computed style first, fall back to hardcoded
    const rootStyles = getComputedStyle(document.documentElement);
    const computed = rootStyles.getPropertyValue(tokenName).trim();
    if (computed) return computed;
    // Look up in NYT_TOKENS
    for (const family of Object.values(NYT_TOKENS)) {
      const t = family.find(tok => tok.name === tokenName);
      if (t) return t.value;
    }
    return '';
  }

  // --- Token resolution for an element ---

  function resolveAllTokens(el) {
    const tokens = {};
    for (let s = 0; s < document.styleSheets.length; s++) {
      let rules;
      try { rules = document.styleSheets[s].cssRules; } catch (_) { continue; }
      if (!rules) continue;
      processRules(rules, el, tokens);
    }
    if (el.style && el.style.length) {
      for (let i = 0; i < el.style.length; i++) {
        const prop = el.style[i];
        const raw = el.style.getPropertyValue(prop);
        if (raw && TOKEN_RE.test(raw)) {
          tokens[prop] = extractToken(raw);
        }
      }
    }
    return tokens;
  }

  function processRules(rules, el, tokens) {
    for (let i = 0; i < rules.length; i++) {
      const rule = rules[i];
      if (rule instanceof CSSMediaRule) {
        if (window.matchMedia(rule.conditionText).matches) {
          processRules(rule.cssRules, el, tokens);
        }
      } else if (rule instanceof CSSStyleRule) {
        try { if (!el.matches(rule.selectorText)) continue; } catch (_) { continue; }
        collectTokens(rule.style, tokens);
      }
    }
  }

  function collectTokens(style, tokens) {
    for (const prop of ['padding', 'margin']) {
      const raw = style.getPropertyValue(prop);
      if (raw && TOKEN_RE.test(raw)) {
        const expanded = expandBoxShorthand(raw);
        tokens[prop + '-top'] = extractToken(expanded.top);
        tokens[prop + '-right'] = extractToken(expanded.right);
        tokens[prop + '-bottom'] = extractToken(expanded.bottom);
        tokens[prop + '-left'] = extractToken(expanded.left);
      }
    }
    for (let i = 0; i < style.length; i++) {
      const prop = style[i];
      const raw = style.getPropertyValue(prop);
      if (raw && TOKEN_RE.test(raw)) {
        tokens[prop] = extractToken(raw);
      }
    }
  }

  // --- Token usage indicators ---

  const INDICATOR_TOKEN = '#4ade80';  // green-400
  const INDICATOR_RAW = '#f59e0b';    // amber-500

  function indicatorDot(isToken) {
    const dot = mkEl('span', {
      color: isToken ? INDICATOR_TOKEN : INDICATOR_RAW,
      fontSize: '7px',
      marginRight: '5px',
      flexShrink: '0',
      lineHeight: '1',
    });
    dot.textContent = '\u25CF';
    return dot;
  }

  // --- Change tracking ---

  const changes = [];

  function applyToken(el, cssProp, newToken, oldToken) {
    if (!el._dtOrigStyles) el._dtOrigStyles = {};
    if (!(cssProp in el._dtOrigStyles)) {
      el._dtOrigStyles[cssProp] = el.style.getPropertyValue(cssProp) || '';
    }
    // Set resolved value directly for immediate visual feedback,
    // then layer var() on top. If var() resolves, it wins; if not, the raw value holds.
    const resolved = resolveTokenColor(newToken);
    if (resolved) {
      el.style.setProperty(cssProp, resolved);
    }
    // Also set via var() so it stays linked to the token if defined
    el.style.setProperty(cssProp, `var(${newToken}, ${resolved || ''})`);
    const existing = changes.find(c => c.el === el && c.prop === cssProp);
    if (existing) {
      existing.to = newToken;
    } else {
      changes.push({
        el, prop: cssProp,
        from: oldToken || el._dtOrigStyles[cssProp],
        to: newToken,
        selector: api.getSelector(el),
      });
    }
    window.DomTools._inspectorChanges = changes;
    if (api.updateBadgeCount) api.updateBadgeCount();
  }

  function applyRawValue(el, cssProp, value) {
    if (!el._dtOrigStyles) el._dtOrigStyles = {};
    if (!(cssProp in el._dtOrigStyles)) {
      el._dtOrigStyles[cssProp] = el.style.getPropertyValue(cssProp) || '';
    }
    el.style.setProperty(cssProp, value);
    const existing = changes.find(c => c.el === el && c.prop === cssProp);
    if (existing) {
      existing.to = value;
    } else {
      changes.push({
        el, prop: cssProp,
        from: el._dtOrigStyles[cssProp],
        to: value,
        selector: api.getSelector(el),
      });
    }
    window.DomTools._inspectorChanges = changes;
    if (api.updateBadgeCount) api.updateBadgeCount();
  }

  function resetProp(el, cssProp) {
    el.style.removeProperty(cssProp);
    const idx = changes.findIndex(c => c.el === el && c.prop === cssProp);
    if (idx >= 0) changes.splice(idx, 1);
    window.DomTools._inspectorChanges = changes;
    if (api.updateBadgeCount) api.updateBadgeCount();
  }

  // --- Spacing overlay ---

  const PAD_COLOR = 'rgba(144, 238, 144, 0.4)';
  const PAD_BRIGHT = 'rgba(144, 238, 144, 0.6)';
  const PAD_LABEL_BG = 'rgba(30, 90, 50, 0.9)';
  const MAR_COLOR = 'rgba(255, 165, 0, 0.35)';
  const MAR_BRIGHT = 'rgba(255, 165, 0, 0.55)';
  const MAR_LABEL_BG = 'rgba(140, 70, 0, 0.9)';

  let overlayEl = null;

  function clearOverlay() {
    if (overlayEl) { overlayEl.remove(); overlayEl = null; }
  }

  function showSpacingOverlay(prop, el) {
    clearOverlay();
    if (!el) return;
    const cs = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    const p = (v) => parseFloat(v) || 0;
    const isPadding = prop.startsWith('padding');
    const color = isPadding ? PAD_COLOR : MAR_COLOR;
    const brightColor = isPadding ? PAD_BRIGHT : MAR_BRIGHT;
    const labelBg = isPadding ? PAD_LABEL_BG : MAR_LABEL_BG;

    // Resolve tokens for this element so overlay labels can show token names
    const elTokens = resolveAllTokens(el);

    const sides = (prop === 'padding' || prop === 'margin')
      ? ['top', 'right', 'bottom', 'left']
      : [prop.split('-').pop()];

    const container = document.createElement('div');
    Object.assign(container.style, {
      position: 'fixed', top: '0', left: '0',
      width: '100%', height: '100%',
      pointerEvents: 'none', zIndex: '99998',
    });

    sides.forEach(side => {
      const fullProp = (isPadding ? 'padding-' : 'margin-') + side;
      const val = p(cs.getPropertyValue(fullProp));
      if (val <= 0) return;

      let x, y, w, h;
      if (isPadding) {
        const pt = p(cs.paddingTop), pr = p(cs.paddingRight), pb = p(cs.paddingBottom), pl = p(cs.paddingLeft);
        if (side === 'top') { x = rect.left; y = rect.top; w = rect.width; h = pt; }
        else if (side === 'bottom') { x = rect.left; y = rect.bottom - pb; w = rect.width; h = pb; }
        else if (side === 'left') { x = rect.left; y = rect.top + pt; w = pl; h = rect.height - pt - pb; }
        else { x = rect.right - pr; y = rect.top + pt; w = pr; h = rect.height - pt - pb; }
      } else {
        const mt = p(cs.marginTop), mr = p(cs.marginRight), mb = p(cs.marginBottom), ml = p(cs.marginLeft);
        if (side === 'top') { x = rect.left; y = rect.top - mt; w = rect.width; h = mt; }
        else if (side === 'bottom') { x = rect.left; y = rect.bottom; w = rect.width; h = mb; }
        else if (side === 'left') { x = rect.left - ml; y = rect.top - mt; w = ml; h = rect.height + mt + mb; }
        else { x = rect.right; y = rect.top - mt; w = mr; h = rect.height + mt + mb; }
      }

      const box = document.createElement('div');
      Object.assign(box.style, {
        position: 'fixed', top: y + 'px', left: x + 'px',
        width: w + 'px', height: h + 'px',
        background: sides.length === 1 ? brightColor : color,
      });
      container.appendChild(box);

      if (w >= 14 || h >= 14) {
        const token = elTokens[fullProp] || null;
        const lbl = document.createElement('span');
        Object.assign(lbl.style, {
          position: 'fixed',
          top: (y + h / 2) + 'px', left: (x + w / 2) + 'px',
          transform: 'translate(-50%, -50%)',
          font: '9px/1 ui-monospace, Menlo, monospace',
          color: token ? '#fbbf24' : '#fff',
          background: labelBg,
          padding: '2px 5px', borderRadius: '2px',
          whiteSpace: 'nowrap',
        });
        lbl.textContent = token ? token + ' (' + Math.round(val) + 'px)' : Math.round(val) + 'px';
        container.appendChild(lbl);
      }
    });

    document.body.appendChild(container);
    overlayEl = container;
  }

  // --- Property overlay (non-spacing) ---

  function showPropertyOverlay(prop, el) {
    clearOverlay();
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    const val = cs.getPropertyValue(prop);
    if (!val) return;

    const elTokens = resolveAllTokens(el);
    const token = elTokens[prop] || null;
    const expectedFamily = getExpectedFamily(prop);

    const container = document.createElement('div');
    Object.assign(container.style, {
      position: 'fixed', top: '0', left: '0',
      width: '100%', height: '100%',
      pointerEvents: 'none', zIndex: '99998',
    });

    // Highlight outline on the element
    const outline = document.createElement('div');
    Object.assign(outline.style, {
      position: 'fixed',
      top: rect.top + 'px', left: rect.left + 'px',
      width: rect.width + 'px', height: rect.height + 'px',
      border: token ? '1.5px solid rgba(74,222,128,0.6)' : '1.5px dashed rgba(245,158,11,0.6)',
      borderRadius: '2px',
      pointerEvents: 'none',
    });
    container.appendChild(outline);

    // Label badge positioned above element
    const lbl = document.createElement('div');
    const labelY = Math.max(4, rect.top - 22);
    Object.assign(lbl.style, {
      position: 'fixed',
      top: labelY + 'px', left: rect.left + 'px',
      font: '9px/1 ui-monospace, Menlo, monospace',
      color: token ? '#fbbf24' : '#fff',
      background: 'rgba(20,20,30,0.92)',
      padding: '3px 6px', borderRadius: '3px',
      whiteSpace: 'nowrap',
      boxShadow: '0 2px 6px rgba(0,0,0,0.3)',
    });

    let labelText = prop + ': ';
    if (token) {
      labelText += token;
    } else if (expectedFamily) {
      labelText += val + ' (no token)';
    } else {
      labelText += val;
    }
    lbl.textContent = labelText;
    container.appendChild(lbl);

    document.body.appendChild(container);
    overlayEl = container;
  }

  // --- DOM helpers ---

  function mkEl(tag, styles, attrs) {
    const node = document.createElement(tag);
    if (styles) Object.assign(node.style, styles);
    if (attrs) Object.entries(attrs).forEach(([k, v]) => node.setAttribute(k, v));
    return node;
  }

  // --- Panel rendering ---

  let panel = null;
  let content = null;
  let api = null;
  let lastEl = null;

  function renderPanel(targetEl) {
    if (!targetEl || !content) return;
    lastEl = targetEl;
    content.innerHTML = '';

    const computed = getComputedStyle(targetEl);
    const tokens = resolveAllTokens(targetEl);
    const selector = api.getSelector(targetEl);

    // --- Selector header ---
    const headerDiv = mkEl('div', { marginBottom: '10px', paddingBottom: '8px', borderBottom: '1px solid rgba(255,255,255,0.1)' });
    const selectorLabel = mkEl('div', { fontSize: '10px', color: 'rgba(255,255,255,0.5)', marginBottom: '2px' });
    selectorLabel.textContent = 'SELECTOR';
    const selectorCode = mkEl('code', { fontSize: '11px', color: '#7dd3fc', wordBreak: 'break-all' });
    selectorCode.textContent = selector;
    // NYT badge
    const nytBadge = mkEl('span', {
      fontSize: '9px', fontWeight: '700', color: '#000',
      background: '#fff', padding: '1px 5px', borderRadius: '3px',
      marginLeft: '8px', verticalAlign: 'middle',
    });
    nytBadge.textContent = 'NYT';
    headerDiv.appendChild(selectorLabel);
    headerDiv.appendChild(selectorCode);
    headerDiv.appendChild(nytBadge);
    content.appendChild(headerDiv);

    // --- SPACING section ---
    content.appendChild(sectionLabel('SPACING'));
    content.appendChild(buildCross('padding', targetEl, tokens, computed));
    content.appendChild(buildCross('margin', targetEl, tokens, computed));

    // Gap — always use token step (sp family)
    const gapToken = tokens['gap'] || null;
    const gapVal = computed.getPropertyValue('gap');
    content.appendChild(buildPropRow('gap', gapToken, gapVal || '0', targetEl, 'sp'));

    // --- TYPOGRAPHY section ---
    content.appendChild(sectionLabel('TYPOGRAPHY'));

    const typProps = [
      { prop: 'font-family', family: 'nyt-font', isValue: false },
      { prop: 'font-size', family: 'ts', isValue: false },
      { prop: 'font-weight', family: null, isValue: true, step: 100 },
      { prop: 'line-height', family: 'lh', isValue: false },
      { prop: 'letter-spacing', family: 'ls', isValue: false },
      { prop: 'color', family: 'nyt-fg', isValue: false, hasColor: true },
    ];
    for (const def of typProps) {
      const token = tokens[def.prop] || null;
      const val = computed.getPropertyValue(def.prop);
      if (!val) continue;
      if (def.isValue) {
        content.appendChild(buildValueRow(def.prop, val, targetEl, def.step || 1));
      } else if (token || def.family) {
        // Has token, or has an expected family — use token step (allows scrolling through scale)
        content.appendChild(buildPropRow(def.prop, token, val, targetEl, def.family, def.hasColor));
      } else {
        content.appendChild(buildStaticRow(def.prop, val));
      }
    }

    // --- APPEARANCE section ---
    content.appendChild(sectionLabel('APPEARANCE'));

    const appProps = [
      { prop: 'background-color', label: 'background', family: 'nyt-bg', isValue: false, hasColor: true },
      { prop: 'border-radius', family: 'br', isValue: false },
      { prop: 'border-color', family: 'nyt-border', isValue: false, hasColor: true },
      { prop: 'border-width', family: 'bw', isValue: true, step: 1 },
    ];
    for (const def of appProps) {
      const token = tokens[def.prop] || null;
      const val = computed.getPropertyValue(def.prop);
      if (!val) continue;
      if (def.isValue) {
        content.appendChild(buildValueRow(def.label || def.prop, val, targetEl, def.step || 1));
      } else if (token || def.family) {
        content.appendChild(buildPropRow(def.label || def.prop, token, val, targetEl, def.family, def.hasColor));
      } else {
        content.appendChild(buildStaticRow(def.label || def.prop, truncate(val, 30)));
      }
    }

    wireTabCycling();
  }

  // --- Section label ---

  function sectionLabel(text) {
    const lbl = mkEl('div', {
      fontSize: '9px', fontWeight: '700',
      color: 'rgba(255,255,255,0.4)', letterSpacing: '0.5px',
      marginBottom: '4px', marginTop: '10px',
    });
    lbl.textContent = text;
    return lbl;
  }

  // --- Cross/Plus grid for padding/margin ---

  function buildCross(type, targetEl, tokens, computed) {
    const isPadding = type === 'padding';
    const accentColor = isPadding ? 'rgba(80,200,120,' : 'rgba(255,165,0,';

    const sides = ['top', 'right', 'bottom', 'left'];
    const tokenCount = sides.filter(s => !!tokens[`${type}-${s}`]).length;

    const wrapper = mkEl('div', { marginBottom: '10px' });

    // Label with token count
    const label = mkEl('div', {
      fontSize: '9px', fontWeight: '600', letterSpacing: '0.3px',
      color: accentColor + '0.7)', marginBottom: '4px', textAlign: 'center',
      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
    });
    const labelText = mkEl('span');
    labelText.textContent = type;
    label.appendChild(labelText);
    const countBadge = mkEl('span', {
      fontSize: '8px', fontWeight: '600',
      color: tokenCount === 4 ? INDICATOR_TOKEN : tokenCount > 0 ? INDICATOR_RAW : 'rgba(255,255,255,0.3)',
    });
    countBadge.textContent = `${tokenCount}/4`;
    label.appendChild(countBadge);
    wrapper.appendChild(label);

    // Grid
    const grid = mkEl('div', {
      display: 'grid',
      gridTemplateColumns: '1fr auto 1fr',
      gridTemplateRows: 'auto auto auto',
      gap: '2px',
      alignItems: 'center',
      justifyItems: 'center',
      maxWidth: '220px',
      margin: '0 auto',
    });

    const positions = {
      top: { gridColumn: '2', gridRow: '1' },
      left: { gridColumn: '1', gridRow: '2' },
      right: { gridColumn: '3', gridRow: '2' },
      bottom: { gridColumn: '2', gridRow: '3' },
    };

    const stepSpans = [];

    sides.forEach(side => {
      const prop = `${type}-${side}`;
      const token = tokens[prop] || null;

      const cell = mkEl('div', positions[side]);
      const span = createTokenStep(token, prop, targetEl, 'sp', isPadding);
      stepSpans.push(span);
      cell.appendChild(span);
      grid.appendChild(cell);
    });

    // "All" center cell
    const centerCell = mkEl('div', { gridColumn: '2', gridRow: '2' });
    const allSpan = mkEl('span', {
      fontSize: '10px', minWidth: '50px', padding: '3px 6px',
      borderRadius: '4px', textAlign: 'center', cursor: 'pointer',
      outline: 'none', whiteSpace: 'nowrap',
      background: accentColor + '0.15)',
      color: accentColor + '0.9)',
      transition: 'background 0.12s, box-shadow 0.12s',
    }, { tabindex: '0' });
    allSpan.textContent = 'all';
    allSpan.classList.add('dt-token-step', 'dt-cross-all');
    allSpan.dataset.prop = type;
    allSpan.dataset.family = 'sp';

    attachAllControl(allSpan, stepSpans, type, targetEl);
    centerCell.appendChild(allSpan);
    grid.appendChild(centerCell);

    wrapper.appendChild(grid);
    return wrapper;
  }

  function createTokenStep(token, prop, targetEl, defaultFamily, isPadding) {
    const hasToken = !!token;
    const family = hasToken ? getFamily(token) : defaultFamily;

    const span = mkEl('span', {
      fontSize: '10px', minWidth: '70px', padding: '3px 6px',
      borderRadius: '4px', textAlign: 'center', cursor: 'pointer',
      outline: 'none', whiteSpace: 'nowrap',
      color: hasToken ? '#fbbf24' : 'rgba(255,255,255,0.4)',
      background: 'rgba(251,191,36,0.08)',
      transition: 'background 0.12s, box-shadow 0.12s',
    }, { tabindex: '0' });
    span.textContent = hasToken ? token : '0';
    span.classList.add('dt-token-step');
    span.dataset.prop = prop;
    span.dataset.token = token || '';
    span.dataset.family = family || '';

    attachTokenStepHandlers(span, targetEl);
    return span;
  }

  // --- Token step keyboard handlers ---

  function attachTokenStepHandlers(span, targetEl) {
    const prop = span.dataset.prop;

    span.addEventListener('click', (e) => { e.stopPropagation(); span.focus(); });

    span.addEventListener('focus', () => {
      span.style.background = 'rgba(251,191,36,0.22)';
      span.style.boxShadow = '0 0 0 2px rgba(251,191,36,0.6)';
      if (prop.startsWith('padding') || prop.startsWith('margin')) {
        showSpacingOverlay(prop, targetEl);
      } else {
        showPropertyOverlay(prop, targetEl);
      }
    });

    span.addEventListener('blur', () => {
      span.style.background = 'rgba(251,191,36,0.08)';
      span.style.boxShadow = '';
      clearOverlay();
    });

    span.addEventListener('mouseenter', () => {
      if (document.activeElement !== span) {
        span.style.background = 'rgba(251,191,36,0.18)';
        span.style.boxShadow = '0 0 0 1px rgba(251,191,36,0.3)';
      }
      if (prop.startsWith('padding') || prop.startsWith('margin')) {
        showSpacingOverlay(prop, targetEl);
      } else {
        showPropertyOverlay(prop, targetEl);
      }
    });

    span.addEventListener('mouseleave', () => {
      if (document.activeElement !== span) {
        span.style.background = 'rgba(251,191,36,0.08)';
        span.style.boxShadow = '';
        clearOverlay();
      }
    });

    span.addEventListener('keydown', (e) => {
      const family = span.dataset.family;
      const scale = getFamilyByName(family);

      if (e.key === 'ArrowUp' || e.key === 'ArrowRight') {
        e.preventDefault();
        if (scale && scale.length) {
          stepToken(span, scale, 1, targetEl);
        } else {
          stepRawPx(span, 1, targetEl, e.shiftKey);
        }
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') {
        e.preventDefault();
        if (scale && scale.length) {
          stepToken(span, scale, -1, targetEl);
        } else {
          stepRawPx(span, -1, targetEl, e.shiftKey);
        }
      } else if (e.key === 'Backspace' || e.key === 'Delete') {
        e.preventDefault();
        resetProp(targetEl, prop);
        span.textContent = '0';
        span.style.color = 'rgba(255,255,255,0.4)';
        span.dataset.token = '';
      } else if (e.key === 'Escape') {
        span.blur();
      } else if (e.key === 'Tab') {
        e.preventDefault();
        cycleControl(span, e.shiftKey);
      }
    });
  }

  function stepRawPx(span, dir, targetEl, shiftKey) {
    const prop = span.dataset.prop;
    const current = parseFloat(span.textContent) || 0;
    const step = shiftKey ? 10 : 1;
    const next = Math.max(0, current + dir * step);
    const val = next + 'px';
    span.textContent = val;
    span.style.color = '#7dd3fc';
    applyRawValue(targetEl, prop, val);
    if (prop.startsWith('padding') || prop.startsWith('margin')) {
      showSpacingOverlay(prop, targetEl);
    }
  }

  function stepToken(span, scale, dir, targetEl) {
    const currentToken = span.dataset.token;
    let idx = scale.findIndex(t => t.name === currentToken);
    if (idx < 0) idx = 0;
    idx = Math.max(0, Math.min(scale.length - 1, idx + dir));

    const token = scale[idx];
    span.dataset.token = token.name;
    span.textContent = token.name;
    span.style.color = '#fbbf24';

    const prop = span.dataset.prop;
    applyToken(targetEl, prop, token.name, currentToken);

    if (prop.startsWith('padding') || prop.startsWith('margin')) {
      showSpacingOverlay(prop, targetEl);
    }

    const row = span.closest('.dt-prop-row');
    if (row) {
      const swatch = row.querySelector('.dt-color-swatch');
      if (swatch) {
        swatch.style.background = resolveTokenColor(token.name);
      }
    }
  }

  // --- "All" center control ---

  function attachAllControl(allSpan, sideSpans, type, targetEl) {
    allSpan.addEventListener('click', (e) => { e.stopPropagation(); allSpan.focus(); });

    allSpan.addEventListener('focus', () => {
      const isPadding = type === 'padding';
      const accent = isPadding ? 'rgba(80,200,120,' : 'rgba(255,165,0,';
      allSpan.style.boxShadow = '0 0 0 2px ' + accent + '0.6)';
      showSpacingOverlay(type, targetEl);
    });

    allSpan.addEventListener('blur', () => {
      allSpan.style.boxShadow = '';
      clearOverlay();
    });

    allSpan.addEventListener('keydown', (e) => {
      const family = allSpan.dataset.family;
      const scale = getFamilyByName(family);
      if (!scale || !scale.length) return;

      if (e.key === 'ArrowUp' || e.key === 'ArrowRight') {
        e.preventDefault();
        stepAll(allSpan, sideSpans, scale, 1, type, targetEl);
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') {
        e.preventDefault();
        stepAll(allSpan, sideSpans, scale, -1, type, targetEl);
      } else if (e.key === 'Backspace' || e.key === 'Delete') {
        e.preventDefault();
        ['top', 'right', 'bottom', 'left'].forEach(side => {
          resetProp(targetEl, `${type}-${side}`);
        });
        sideSpans.forEach(s => {
          s.textContent = '\u2014';
          s.style.color = 'rgba(255,255,255,0.3)';
          s.dataset.token = '';
        });
        allSpan.textContent = '\u2014';
      } else if (e.key === 'Escape') {
        allSpan.blur();
      } else if (e.key === 'Tab') {
        e.preventDefault();
        cycleControl(allSpan, e.shiftKey);
      }
    });
  }

  function stepAll(allSpan, sideSpans, scale, dir, type, targetEl) {
    const refToken = sideSpans[0].dataset.token;
    let idx = scale.findIndex(t => t.name === refToken);
    if (idx < 0) idx = 0;
    idx = Math.max(0, Math.min(scale.length - 1, idx + dir));

    const token = scale[idx];
    allSpan.textContent = token.name;
    allSpan.dataset.token = token.name;

    const sides = ['top', 'right', 'bottom', 'left'];
    sideSpans.forEach((span, i) => {
      span.dataset.token = token.name;
      span.textContent = token.name;
      span.style.color = '#fbbf24';
      applyToken(targetEl, `${type}-${sides[i]}`, token.name, span.dataset.token);
    });

    showSpacingOverlay(type, targetEl);
  }

  // --- Property row builders ---

  function buildPropRow(label, token, val, targetEl, defaultFamily, hasColor) {
    const hasToken = !!token;
    const row = mkEl('div', {
      display: 'flex', gap: '6px', alignItems: 'center',
      padding: '3px 0', fontSize: '11px',
    });
    row.classList.add('dt-prop-row');

    row.appendChild(indicatorDot(hasToken));
    const nameSpan = mkEl('span', {
      color: 'rgba(255,255,255,0.6)', width: '90px', flexShrink: '0',
      fontSize: '10px',
    });
    nameSpan.textContent = label;
    row.appendChild(nameSpan);

    // Color swatch
    if (hasColor) {
      const colorVal = hasToken ? resolveTokenColor(token) : val;
      const swatch = mkEl('span', {
        width: '12px', height: '12px', borderRadius: '3px',
        border: '1px solid rgba(255,255,255,0.2)',
        flexShrink: '0',
        background: colorVal,
      });
      swatch.classList.add('dt-color-swatch');
      row.appendChild(swatch);
    }

    // Token step — always steppable through the family scale
    const family = hasToken ? getFamily(token) : defaultFamily;
    const span = mkEl('span', {
      color: hasToken ? '#fbbf24' : 'rgba(255,255,255,0.5)',
      fontSize: '10px', whiteSpace: 'nowrap',
      cursor: 'pointer', padding: '4px 8px', borderRadius: '4px',
      background: 'rgba(251,191,36,0.08)', minWidth: '110px',
      textAlign: 'center', outline: 'none',
      marginLeft: 'auto', flexShrink: '0',
      transition: 'background 0.12s, box-shadow 0.12s',
    }, { tabindex: '0' });
    span.textContent = hasToken ? token : truncate(cleanValue(val), 20);
    span.classList.add('dt-token-step');
    span.dataset.token = token || '';
    span.dataset.family = family || '';

    const cssProp = label === 'background' ? 'background-color' : label;
    span.dataset.prop = cssProp;

    attachTokenStepHandlers(span, targetEl);
    row.appendChild(span);
    return row;
  }

  function buildValueRow(prop, val, targetEl, step) {
    const row = mkEl('div', {
      display: 'flex', gap: '6px', alignItems: 'center',
      padding: '3px 0', fontSize: '11px',
    });
    row.classList.add('dt-prop-row');

    row.appendChild(indicatorDot(false));
    const nameSpan = mkEl('span', {
      color: 'rgba(255,255,255,0.6)', width: '90px', flexShrink: '0',
      fontSize: '10px',
    });
    nameSpan.textContent = prop;
    row.appendChild(nameSpan);

    const input = mkEl('span', {
      color: '#7dd3fc', fontSize: '10px', whiteSpace: 'nowrap',
      cursor: 'text', padding: '4px 8px', borderRadius: '4px',
      background: 'rgba(125,211,252,0.08)', minWidth: '110px',
      textAlign: 'center', outline: 'none', marginLeft: 'auto',
      flexShrink: '0',
      transition: 'background 0.12s, box-shadow 0.12s',
    }, { tabindex: '0', contenteditable: 'true' });
    const numVal = parseFloat(val);
    input.textContent = isNaN(numVal) ? val : parseFloat(numVal.toFixed(1)).toString();
    input.classList.add('dt-value-input');
    input.dataset.prop = prop;

    attachValueInputHandlers(input, targetEl, step);
    row.appendChild(input);
    return row;
  }

  function buildStaticRow(label, val) {
    const row = mkEl('div', {
      display: 'flex', gap: '6px', alignItems: 'center',
      padding: '3px 0', fontSize: '11px',
    });
    row.appendChild(indicatorDot(false));
    const nameSpan = mkEl('span', {
      color: 'rgba(255,255,255,0.6)', width: '90px', flexShrink: '0',
      fontSize: '10px',
    });
    nameSpan.textContent = label;
    const valSpan = mkEl('span', {
      color: 'rgba(255,255,255,0.5)', marginLeft: 'auto',
      fontSize: '10px', padding: '4px 8px', borderRadius: '4px',
      background: 'rgba(255,255,255,0.04)', minWidth: '110px',
      textAlign: 'center', flexShrink: '0',
    });
    valSpan.textContent = truncate(cleanValue(val), 20);
    row.appendChild(nameSpan);
    row.appendChild(valSpan);
    return row;
  }

  // --- Value input handlers ---

  function attachValueInputHandlers(input, targetEl, step) {
    const prop = input.dataset.prop;

    input.addEventListener('focus', () => {
      input.style.background = 'rgba(125,211,252,0.18)';
      input.style.boxShadow = '0 0 0 2px rgba(125,211,252,0.6)';
      const range = document.createRange();
      range.selectNodeContents(input);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      if (!prop.startsWith('padding') && !prop.startsWith('margin')) {
        showPropertyOverlay(prop, targetEl);
      }
    });

    input.addEventListener('blur', () => {
      input.style.background = 'rgba(125,211,252,0.08)';
      input.style.boxShadow = '';
      clearOverlay();
      const val = input.textContent.trim();
      if (!val || val === '\u2014') {
        input.textContent = '\u2014';
        input.style.color = 'rgba(255,255,255,0.3)';
        resetProp(targetEl, prop);
      } else {
        input.style.color = '#7dd3fc';
        applyRawValue(targetEl, prop, val);
      }
    });

    input.addEventListener('mouseenter', () => {
      if (document.activeElement !== input) {
        input.style.background = 'rgba(125,211,252,0.15)';
        if (!prop.startsWith('padding') && !prop.startsWith('margin')) {
          showPropertyOverlay(prop, targetEl);
        }
        input.style.boxShadow = '0 0 0 1px rgba(125,211,252,0.3)';
      }
    });

    input.addEventListener('mouseleave', () => {
      if (document.activeElement !== input) {
        input.style.background = 'rgba(125,211,252,0.08)';
        input.style.boxShadow = '';
        clearOverlay();
      }
    });

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        input.blur();
      } else if (e.key === 'Escape') {
        input.blur();
      } else if (e.key === 'Tab') {
        e.preventDefault();
        const val = input.textContent.trim();
        if (val && val !== '\u2014') applyRawValue(targetEl, prop, val);
        cycleControl(input, e.shiftKey);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        const num = parseFloat(input.textContent);
        if (!isNaN(num)) {
          const s = e.shiftKey && step === 1 ? 10 : step;
          input.textContent = parseFloat((num + s).toFixed(2)).toString();
          applyRawValue(targetEl, prop, input.textContent);
        }
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        const num = parseFloat(input.textContent);
        if (!isNaN(num)) {
          const s = e.shiftKey && step === 1 ? 10 : step;
          input.textContent = parseFloat(Math.max(0, num - s).toFixed(2)).toString();
          applyRawValue(targetEl, prop, input.textContent);
        }
      }
    });
  }

  // --- Tab cycling ---

  function wireTabCycling() {}

  function cycleControl(current, reverse) {
    const all = [...content.querySelectorAll('.dt-token-step, .dt-value-input')];
    const i = all.indexOf(current);
    if (i < 0) return;
    const next = reverse
      ? all[(i - 1 + all.length) % all.length]
      : all[(i + 1) % all.length];
    next.focus();
  }

  // --- Utility ---

  function truncate(str, max) {
    return str.length > max ? str.slice(0, max) + '\u2026' : str;
  }

  function cleanValue(val) {
    if (!val) return val;
    // Round long floating point values (40.299999px → 40.3px)
    return val.replace(/(\d+\.\d{2})\d+/g, (_, short) => parseFloat(short).toString());
  }

  // --- Selection tracking ---

  function onSelectionChange() {
    const sel = api.getSelected();
    if (sel.length > 0) {
      const last = sel[sel.length - 1];
      renderPanel(last.el);
      panel.style.display = '';
    } else {
      panel.style.display = 'none';
    }
  }

  let pollInterval = null;
  let lastSelCount = 0;
  let lastSelEl = null;

  function startPolling() {
    pollInterval = setInterval(() => {
      const sel = api.getSelected();
      const curEl = sel.length > 0 ? sel[sel.length - 1].el : null;
      if (sel.length !== lastSelCount || curEl !== lastSelEl) {
        lastSelCount = sel.length;
        lastSelEl = curEl;
        onSelectionChange();
      }
    }, 150);
  }

  function stopPolling() {
    if (pollInterval) { clearInterval(pollInterval); pollInterval = null; }
  }

  // --- Plugin registration ---

  const plugin = {
    id: 'inspector-panel-nyt',
    label: 'Inspector (NYT)',

    init(_api) {
      api = _api;
      panel = api.createPanel({
        title: 'Inspector (NYT)',
        position: { top: '80px', right: '16px' },
        width: '320px',
      });
      content = panel._content;
      Object.assign(content.style, {
        maxHeight: '60vh',
        overflowY: 'auto',
        overflowX: 'hidden',
        scrollbarWidth: 'none',
      });
      panel.style.display = 'none';
      injectTokenStyles();
      startPolling();
      window.DomTools._inspectorChanges = changes;
      if (api.updateBadgeCount) api.updateBadgeCount();
    },

    enable() {
      injectTokenStyles();
      startPolling();
    },

    disable() {
      stopPolling();
      clearOverlay();
      removeTokenStyles();
      if (panel) panel.style.display = 'none';
    },
  };

  if (window.DomTools) {
    window.DomTools.registerPlugin(plugin);
  } else {
    window.DomTools = window.DomTools || {};
    window.DomTools._pendingPlugins = window.DomTools._pendingPlugins || [];
    window.DomTools._pendingPlugins.push(plugin);
  }
})();

/**
 * DOM-Tools Plugin: Morphizer
 * A real-time video synth that captures the page via getDisplayMedia and processes
 * it through a WebGL feedback loop with displacement, color, and visual effects.
 * GPU-accelerated, no dependencies. Load after dom-tools.js.
 */
(function() {
  'use strict';

  // --- Shader sources ---
  const VERT_SRC = `
    attribute vec2 a_position;
    varying vec2 v_uv;
    void main() {
      v_uv = a_position * 0.5 + 0.5;
      gl_Position = vec4(a_position, 0.0, 1.0);
    }
  `;

  const FRAG_SRC = `
    precision highp float;
    varying vec2 v_uv;

    uniform sampler2D u_texture;     // live page capture
    uniform sampler2D u_feedback;    // previous frame (FBO)
    uniform vec2 u_resolution;
    uniform vec2 u_mouse;
    uniform float u_time;

    // Displacement
    uniform int u_displace;          // 0=wave,1=ripple,2=melt,3=tunnel,4=vortex
    uniform float u_intensity;
    uniform float u_frequency;
    uniform float u_speed;

    // Feedback
    uniform float u_feedbackMix;     // 0–1, how much previous frame bleeds in
    uniform float u_feedbackZoom;    // subtle zoom per frame (1.0 = none)
    uniform float u_feedbackRotate;  // radians per frame

    // Color
    uniform float u_hueShift;        // 0–1 maps to 0–2PI
    uniform float u_saturation;      // multiplier
    uniform float u_rgbSplit;        // chromatic aberration amount
    uniform float u_brightness;      // multiplier

    // Visual
    uniform int u_kaleidoscope;      // segments (0=off)
    uniform float u_pixelate;        // grid size (0=off)
    uniform float u_scanlines;       // intensity (0=off)
    uniform float u_glitch;          // glitch intensity
    uniform float u_mirror;          // 0=off, 1=horizontal, 2=vertical, 3=both

    // Blend mode: 0=mix, 1=add, 2=multiply, 3=difference, 4=screen
    uniform int u_blendMode;

    #define PI 3.14159265
    #define TAU 6.28318530

    // --- HSV helpers ---
    vec3 rgb2hsv(vec3 c) {
      vec4 K = vec4(0.0, -1.0/3.0, 2.0/3.0, -1.0);
      vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
      vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
      float d = q.x - min(q.w, q.y);
      float e = 1.0e-10;
      return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
    }

    vec3 hsv2rgb(vec3 c) {
      vec4 K = vec4(1.0, 2.0/3.0, 1.0/3.0, 3.0);
      vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
      return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
    }

    // --- Displacement effects ---
    vec2 displace_wave(vec2 uv) {
      float amp = u_intensity * 0.06;
      float freq = u_frequency * 12.0;
      float t = u_time * u_speed;
      uv.x += sin(uv.y * freq + t) * amp;
      uv.y += cos(uv.x * freq * 0.8 + t * 0.7) * amp * 0.6;
      return uv;
    }

    vec2 displace_ripple(vec2 uv) {
      vec2 center = u_mouse;
      float dist = distance(uv, center);
      float amp = u_intensity * 0.05;
      float freq = u_frequency * 40.0;
      float t = u_time * u_speed;
      float w = sin(dist * freq - t * 5.0) * amp;
      w *= smoothstep(0.7, 0.0, dist);
      vec2 dir = normalize(uv - center + 0.0001);
      return uv + dir * w;
    }

    vec2 displace_melt(vec2 uv) {
      float amt = u_intensity * 0.12;
      float t = u_time * u_speed;
      float drip = sin(uv.x * u_frequency * 20.0 + t * 0.4) * amt;
      drip *= smoothstep(0.0, 1.0, uv.y);
      uv.y += drip;
      uv.x += cos(uv.y * 10.0 + t * 0.6) * amt * 0.4;
      return uv;
    }

    vec2 displace_tunnel(vec2 uv) {
      vec2 c = uv - 0.5;
      float r = length(c);
      float a = atan(c.y, c.x);
      float t = u_time * u_speed;
      r += sin(a * u_frequency * 6.0 + t) * u_intensity * 0.08;
      r += sin(r * 20.0 - t * 2.0) * u_intensity * 0.03;
      return vec2(cos(a), sin(a)) * r + 0.5;
    }

    vec2 displace_vortex(vec2 uv) {
      vec2 c = uv - u_mouse;
      float r = length(c);
      float a = atan(c.y, c.x);
      float twist = u_intensity * 4.0 * smoothstep(0.5, 0.0, r);
      a += twist * sin(u_time * u_speed + r * u_frequency * 10.0);
      return vec2(cos(a), sin(a)) * r + u_mouse;
    }

    // --- Kaleidoscope ---
    vec2 kaleidoscope(vec2 uv, int segs) {
      vec2 c = uv - 0.5;
      float a = atan(c.y, c.x);
      float r = length(c);
      float segAngle = TAU / float(segs);
      a = mod(a, segAngle);
      a = abs(a - segAngle * 0.5);
      return vec2(cos(a), sin(a)) * r + 0.5;
    }

    // --- Glitch ---
    vec2 glitchOffset(vec2 uv, float t) {
      float line = floor(uv.y * 40.0);
      float jitter = fract(sin(line * 43.17 + floor(t * 12.0) * 7.13) * 9381.7);
      if (jitter > 1.0 - u_glitch * 0.3) {
        uv.x += (jitter - 0.5) * u_glitch * 0.15;
      }
      return uv;
    }

    void main() {
      vec2 uv = v_uv;

      // Mirror
      if (u_mirror >= 0.5 && u_mirror < 1.5) uv.x = abs(uv.x - 0.5) + 0.5; // horiz
      if (u_mirror >= 1.5 && u_mirror < 2.5) uv.y = abs(uv.y - 0.5) + 0.5; // vert
      if (u_mirror >= 2.5) { uv.x = abs(uv.x - 0.5) + 0.5; uv.y = abs(uv.y - 0.5) + 0.5; }

      // Kaleidoscope
      if (u_kaleidoscope > 1) uv = kaleidoscope(uv, u_kaleidoscope);

      // Pixelate
      if (u_pixelate > 1.0) {
        vec2 grid = u_resolution / u_pixelate;
        uv = floor(uv * grid) / grid;
      }

      // Displacement
      if (u_displace == 0) uv = displace_wave(uv);
      else if (u_displace == 1) uv = displace_ripple(uv);
      else if (u_displace == 2) uv = displace_melt(uv);
      else if (u_displace == 3) uv = displace_tunnel(uv);
      else if (u_displace == 4) uv = displace_vortex(uv);

      // Glitch
      if (u_glitch > 0.0) uv = glitchOffset(uv, u_time);

      uv = clamp(uv, 0.0, 1.0);

      // Sample live texture with RGB split
      vec4 color;
      if (u_rgbSplit > 0.001) {
        float off = u_rgbSplit * 0.025;
        float angle = u_time * 0.5;
        vec2 rOff = vec2(cos(angle), sin(angle)) * off;
        vec2 bOff = vec2(cos(angle + 2.094), sin(angle + 2.094)) * off;
        color.r = texture2D(u_texture, uv + rOff).r;
        color.g = texture2D(u_texture, uv).g;
        color.b = texture2D(u_texture, uv + bOff).b;
        color.a = 1.0;
      } else {
        color = texture2D(u_texture, uv);
      }

      // Feedback: sample previous frame with zoom + rotate
      if (u_feedbackMix > 0.001) {
        vec2 fbUv = (uv - 0.5) / u_feedbackZoom;
        if (abs(u_feedbackRotate) > 0.0001) {
          float ca = cos(u_feedbackRotate);
          float sa = sin(u_feedbackRotate);
          fbUv = mat2(ca, -sa, sa, ca) * fbUv;
        }
        fbUv += 0.5;
        vec4 fb = texture2D(u_feedback, clamp(fbUv, 0.0, 1.0));

        // Blend modes
        vec4 blended;
        if (u_blendMode == 0) blended = mix(color, fb, u_feedbackMix);            // mix
        else if (u_blendMode == 1) blended = color + fb * u_feedbackMix;           // add
        else if (u_blendMode == 2) blended = mix(color, color * fb, u_feedbackMix);// multiply
        else if (u_blendMode == 3) blended = mix(color, abs(color - fb), u_feedbackMix); // difference
        else blended = mix(color, color + fb - color * fb, u_feedbackMix);         // screen
        color = blended;
      }

      // Hue shift + saturation
      if (abs(u_hueShift) > 0.001 || abs(u_saturation - 1.0) > 0.01) {
        vec3 hsv = rgb2hsv(color.rgb);
        hsv.x = fract(hsv.x + u_hueShift);
        hsv.y *= u_saturation;
        color.rgb = hsv2rgb(hsv);
      }

      // Brightness
      color.rgb *= u_brightness;

      // Scanlines
      if (u_scanlines > 0.0) {
        float sl = sin(v_uv.y * u_resolution.y * 0.5) * 0.5 + 0.5;
        color.rgb *= 1.0 - u_scanlines * 0.4 * sl;
      }

      gl_FragColor = clamp(color, 0.0, 1.0);
    }
  `;

  // --- WebGL helpers ---
  function compileShader(gl, src, type) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      console.error('Morphizer shader:', gl.getShaderInfoLog(s));
      return null;
    }
    return s;
  }

  function createProgram(gl) {
    const vs = compileShader(gl, VERT_SRC, gl.VERTEX_SHADER);
    const fs = compileShader(gl, FRAG_SRC, gl.FRAGMENT_SHADER);
    if (!vs || !fs) return null;
    const prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      console.error('Morphizer link:', gl.getProgramInfoLog(prog));
      return null;
    }
    return prog;
  }

  // --- FBO for feedback ---
  function createFBO(gl, w, h) {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { texture: tex, framebuffer: fb, width: w, height: h };
  }

  // --- Plugin state ---
  let api = null;
  let canvas = null;
  let gl = null;
  let program = null;
  let liveTexture = null;
  let snapshotCanvas = null; // offscreen canvas holding the captured frame
  let video = null;
  let stream = null;
  let animFrame = null;
  let panel = null;
  let startTime = 0;
  let mouseX = 0.5, mouseY = 0.5;
  let frozen = false;
  let hasTexture = false; // true once we've captured at least one frame

  // FBO ping-pong
  let fboA = null, fboB = null;
  let pingPong = 0; // alternates 0/1

  // Uniforms cache
  let U = {};

  // --- Parameters ---
  const P = {
    displace: 0,          // 0=wave,1=ripple,2=melt,3=tunnel,4=vortex
    intensity: 0.4,
    frequency: 0.5,
    speed: 1.0,
    feedbackMix: 0.0,
    feedbackZoom: 1.002,
    feedbackRotate: 0.0,
    hueShift: 0.0,
    saturation: 1.0,
    rgbSplit: 0.0,
    brightness: 1.0,
    kaleidoscope: 0,
    pixelate: 0,
    scanlines: 0.0,
    glitch: 0.0,
    mirror: 0,
    blendMode: 0,
  };

  // LFO state
  const LFOs = {
    intensity: { active: false, speed: 1.0, depth: 0.5 },
    hueShift: { active: false, speed: 0.5, depth: 1.0 },
    frequency: { active: false, speed: 0.8, depth: 0.4 },
    rgbSplit: { active: false, speed: 1.2, depth: 0.6 },
  };

  const DISPLACE_NAMES = ['wave', 'ripple', 'melt', 'tunnel', 'vortex'];
  const BLEND_NAMES = ['mix', 'add', 'multiply', 'diff', 'screen'];

  // Presets
  const PRESETS = {
    clean: { displace: 0, intensity: 0.3, frequency: 0.4, speed: 1, feedbackMix: 0, feedbackZoom: 1, feedbackRotate: 0, hueShift: 0, saturation: 1, rgbSplit: 0, brightness: 1, kaleidoscope: 0, pixelate: 0, scanlines: 0, glitch: 0, mirror: 0, blendMode: 0 },
    acid: { displace: 0, intensity: 0.7, frequency: 0.6, speed: 1.5, feedbackMix: 0.6, feedbackZoom: 1.005, feedbackRotate: 0.01, hueShift: 0, saturation: 1.5, rgbSplit: 0.3, brightness: 1.1, kaleidoscope: 0, pixelate: 0, scanlines: 0, glitch: 0, mirror: 0, blendMode: 1 },
    crt: { displace: 0, intensity: 0.1, frequency: 0.3, speed: 0.5, feedbackMix: 0.15, feedbackZoom: 1, feedbackRotate: 0, hueShift: 0, saturation: 0.8, rgbSplit: 0.4, brightness: 0.95, kaleidoscope: 0, pixelate: 3, scanlines: 0.7, glitch: 0.1, mirror: 0, blendMode: 0 },
    kaleid: { displace: 4, intensity: 0.3, frequency: 0.5, speed: 0.8, feedbackMix: 0.4, feedbackZoom: 1.003, feedbackRotate: 0.02, hueShift: 0, saturation: 1.3, rgbSplit: 0.1, brightness: 1, kaleidoscope: 6, pixelate: 0, scanlines: 0, glitch: 0, mirror: 0, blendMode: 0 },
    datamosh: { displace: 2, intensity: 0.8, frequency: 0.7, speed: 2, feedbackMix: 0.85, feedbackZoom: 1.001, feedbackRotate: 0, hueShift: 0, saturation: 1, rgbSplit: 0.5, brightness: 1, kaleidoscope: 0, pixelate: 0, scanlines: 0, glitch: 0.6, mirror: 0, blendMode: 3 },
    pixel: { displace: 0, intensity: 0.2, frequency: 0.4, speed: 0.7, feedbackMix: 0.2, feedbackZoom: 1, feedbackRotate: 0, hueShift: 0, saturation: 1.2, rgbSplit: 0, brightness: 1, kaleidoscope: 0, pixelate: 12, scanlines: 0, glitch: 0, mirror: 0, blendMode: 0 },
    void: { displace: 3, intensity: 0.9, frequency: 0.8, speed: 0.4, feedbackMix: 0.92, feedbackZoom: 0.998, feedbackRotate: -0.005, hueShift: 0, saturation: 0.5, rgbSplit: 0.2, brightness: 0.8, kaleidoscope: 0, pixelate: 0, scanlines: 0.3, glitch: 0, mirror: 0, blendMode: 4 },
    mirror: { displace: 1, intensity: 0.4, frequency: 0.5, speed: 1, feedbackMix: 0.3, feedbackZoom: 1, feedbackRotate: 0, hueShift: 0, saturation: 1, rgbSplit: 0.15, brightness: 1, kaleidoscope: 0, pixelate: 0, scanlines: 0, glitch: 0, mirror: 3, blendMode: 0 },
  };

  // --- Capture sources ---
  // 'thispage' = getDisplayMedia with preferCurrentTab (one-click share of current tab)
  // 'pick' = standard getDisplayMedia (full picker — any window/tab/screen)
  let captureSource = 'thispage';

  async function captureFrame() {
    const opts = { video: { displaySurface: 'browser' } };
    if (captureSource === 'thispage') {
      opts.preferCurrentTab = true;
      opts.selfBrowserSurface = 'include';
    }

    try {
      stream = await navigator.mediaDevices.getDisplayMedia(opts);
    } catch (e) {
      api.showToast('Morphizer: capture denied');
      return false;
    }

    video = document.createElement('video');
    video.srcObject = stream;
    video.muted = true;
    video.playsInline = true;
    await video.play();

    // Wait for a valid frame
    await new Promise(resolve => {
      const check = () => {
        if (video.readyState >= video.HAVE_CURRENT_DATA && video.videoWidth > 0) resolve();
        else requestAnimationFrame(check);
      };
      check();
    });

    // Copy frame to offscreen canvas
    const w = video.videoWidth;
    const h = video.videoHeight;
    if (!snapshotCanvas) snapshotCanvas = document.createElement('canvas');
    snapshotCanvas.width = w;
    snapshotCanvas.height = h;
    const ctx = snapshotCanvas.getContext('2d');
    ctx.drawImage(video, 0, 0, w, h);

    // Stop stream — we only need one frame
    stream.getTracks().forEach(t => t.stop());
    stream = null;
    video.srcObject = null;
    video = null;

    hasTexture = true;
    return true;
  }

  // Upload the snapshot to the live texture
  function uploadSnapshot() {
    if (!snapshotCanvas || !gl) return;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, liveTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, snapshotCanvas);
  }

  // Recapture: hide canvas, grab new frame, resume
  async function recapture() {
    if (canvas) canvas.style.display = 'none';
    // Give the browser a frame to render without our canvas
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    const ok = await captureFrame();
    if (ok) {
      uploadSnapshot();
      api.showToast('Recaptured');
    }
    if (canvas) canvas.style.display = 'block';
  }

  // --- WebGL ---
  function initGL() {
    canvas = document.createElement('canvas');
    Object.assign(canvas.style, {
      position: 'fixed', inset: '0',
      width: '100vw', height: '100vh',
      pointerEvents: 'none',
      zIndex: String((api.Z.overlay || 99998) + 1),
    });
    const dpr = Math.min(devicePixelRatio, 2); // cap for perf
    canvas.width = window.innerWidth * dpr;
    canvas.height = window.innerHeight * dpr;

    gl = canvas.getContext('webgl', { alpha: false, antialias: false, preserveDrawingBuffer: true });
    if (!gl) { api.showToast('Morphizer: no WebGL'); return false; }

    program = createProgram(gl);
    if (!program) return false;
    gl.useProgram(program);

    // Fullscreen quad
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);
    const pos = gl.getAttribLocation(program, 'a_position');
    gl.enableVertexAttribArray(pos);
    gl.vertexAttribPointer(pos, 2, gl.FLOAT, false, 0, 0);

    // Live texture
    liveTexture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, liveTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

    // FBOs for feedback ping-pong
    fboA = createFBO(gl, canvas.width, canvas.height);
    fboB = createFBO(gl, canvas.width, canvas.height);

    // Cache uniforms
    const names = [
      'u_texture','u_feedback','u_resolution','u_mouse','u_time',
      'u_displace','u_intensity','u_frequency','u_speed',
      'u_feedbackMix','u_feedbackZoom','u_feedbackRotate',
      'u_hueShift','u_saturation','u_rgbSplit','u_brightness',
      'u_kaleidoscope','u_pixelate','u_scanlines','u_glitch','u_mirror',
      'u_blendMode',
    ];
    U = {};
    names.forEach(n => { U[n] = gl.getUniformLocation(program, n); });

    document.body.appendChild(canvas);
    api.inspectorUI.add(canvas);
    return true;
  }

  function resizeFBOs() {
    const dpr = Math.min(devicePixelRatio, 2);
    const w = window.innerWidth * dpr;
    const h = window.innerHeight * dpr;
    if (canvas.width === w && canvas.height === h) return;
    canvas.width = w; canvas.height = h;
    gl.viewport(0, 0, w, h);
    // Recreate FBOs
    gl.deleteTexture(fboA.texture); gl.deleteFramebuffer(fboA.framebuffer);
    gl.deleteTexture(fboB.texture); gl.deleteFramebuffer(fboB.framebuffer);
    fboA = createFBO(gl, w, h);
    fboB = createFBO(gl, w, h);
  }

  // --- Render ---
  function render() {
    if (!gl || !hasTexture) {
      animFrame = requestAnimationFrame(render);
      return;
    }
    resizeFBOs();

    const TAU = 6.28318;

    // Apply LFOs
    const t = (performance.now() - startTime) / 1000;
    const lfoVals = {};
    Object.entries(LFOs).forEach(([key, lfo]) => {
      if (lfo.active) {
        lfoVals[key] = (Math.sin(t * lfo.speed * TAU) * 0.5 + 0.5) * lfo.depth;
      }
    });

    // Effective params with LFO modulation
    const eIntensity = P.intensity + (lfoVals.intensity || 0);
    const eHueShift = P.hueShift + (lfoVals.hueShift || 0);
    const eFrequency = P.frequency + (lfoVals.frequency || 0);
    const eRgbSplit = P.rgbSplit + (lfoVals.rgbSplit || 0);

    // The live texture is already uploaded from the snapshot — no per-frame upload needed.
    // Bind it for the shader.
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, liveTexture);

    // Bind feedback texture (read from previous frame)
    const readFBO = pingPong === 0 ? fboA : fboB;
    const writeFBO = pingPong === 0 ? fboB : fboA;

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, readFBO.texture);

    // Render to writeFBO
    gl.bindFramebuffer(gl.FRAMEBUFFER, writeFBO.framebuffer);
    gl.viewport(0, 0, canvas.width, canvas.height);

    // Set all uniforms
    gl.uniform1i(U.u_texture, 0);
    gl.uniform1i(U.u_feedback, 1);
    gl.uniform2f(U.u_resolution, canvas.width, canvas.height);
    gl.uniform2f(U.u_mouse, mouseX, 1.0 - mouseY);
    gl.uniform1f(U.u_time, t);
    gl.uniform1i(U.u_displace, P.displace);
    gl.uniform1f(U.u_intensity, Math.min(eIntensity, 1.5));
    gl.uniform1f(U.u_frequency, Math.min(eFrequency, 1.5));
    gl.uniform1f(U.u_speed, P.speed);
    gl.uniform1f(U.u_feedbackMix, P.feedbackMix);
    gl.uniform1f(U.u_feedbackZoom, P.feedbackZoom);
    gl.uniform1f(U.u_feedbackRotate, P.feedbackRotate);
    gl.uniform1f(U.u_hueShift, eHueShift);
    gl.uniform1f(U.u_saturation, P.saturation);
    gl.uniform1f(U.u_rgbSplit, Math.min(eRgbSplit, 1.5));
    gl.uniform1f(U.u_brightness, P.brightness);
    gl.uniform1i(U.u_kaleidoscope, P.kaleidoscope);
    gl.uniform1f(U.u_pixelate, P.pixelate);
    gl.uniform1f(U.u_scanlines, P.scanlines);
    gl.uniform1f(U.u_glitch, P.glitch);
    gl.uniform1f(U.u_mirror, P.mirror);
    gl.uniform1i(U.u_blendMode, P.blendMode);

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    // Copy to screen
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, canvas.width, canvas.height);
    // Use writeFBO texture as source, render with no effects (pass-through)
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, writeFBO.texture);
    // Set minimal uniforms for pass-through
    gl.uniform1i(U.u_texture, 0);
    gl.uniform1f(U.u_feedbackMix, 0.0); // no feedback on screen pass
    gl.uniform1f(U.u_intensity, 0.0);   // no displacement
    gl.uniform1f(U.u_rgbSplit, 0.0);
    gl.uniform1f(U.u_hueShift, 0.0);
    gl.uniform1f(U.u_saturation, 1.0);
    gl.uniform1f(U.u_brightness, 1.0);
    gl.uniform1i(U.u_kaleidoscope, 0);
    gl.uniform1f(U.u_pixelate, 0.0);
    gl.uniform1f(U.u_scanlines, 0.0);
    gl.uniform1f(U.u_glitch, 0.0);
    gl.uniform1f(U.u_mirror, 0.0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    pingPong = 1 - pingPong;
    animFrame = requestAnimationFrame(render);
  }

  // --- Panel UI ---
  function buildPanel() {
    panel = api.createPanel({ title: 'Morphizer', position: { top: '16px', right: '16px' }, width: '260px' });
    const C = panel._content;
    C.style.maxHeight = '70vh';
    C.style.overflowY = 'auto';

    // --- Source selector ---
    addSection(C, 'source', true);
    const srcRow = el('div', { display: 'flex', gap: '4px', marginBottom: '12px', alignItems: 'center' });
    const srcButtons = {};
    ['thispage', 'pick'].forEach(src => {
      const btn = el('button', {
        padding: '3px 8px', fontSize: '9px', fontWeight: '600',
        border: 'none', borderRadius: '3px', cursor: 'pointer',
        background: src === captureSource ? '#8b5cf6' : '#333',
        color: '#fff', fontFamily: 'inherit',
      });
      btn.textContent = src === 'thispage' ? 'this page' : 'pick source';
      btn.addEventListener('click', () => {
        captureSource = src;
        Object.entries(srcButtons).forEach(([k, b]) => {
          b.style.background = k === src ? '#8b5cf6' : '#333';
        });
      });
      srcButtons[src] = btn;
      srcRow.appendChild(btn);
    });
    const recapBtn = el('button', {
      padding: '3px 8px', fontSize: '9px', fontWeight: '600',
      border: 'none', borderRadius: '3px', cursor: 'pointer',
      background: '#555', color: '#fff', fontFamily: 'inherit', marginLeft: 'auto',
    });
    recapBtn.textContent = '⟳ recapture';
    recapBtn.addEventListener('click', recapture);
    recapBtn.addEventListener('mouseenter', () => { recapBtn.style.background = '#8b5cf6'; });
    recapBtn.addEventListener('mouseleave', () => { recapBtn.style.background = '#555'; });
    srcRow.appendChild(recapBtn);
    C.appendChild(srcRow);

    // --- Presets ---
    addSection(C, 'presets');
    const presetRow = el('div', { display: 'flex', flexWrap: 'wrap', gap: '4px', marginBottom: '12px' });
    Object.keys(PRESETS).forEach(name => {
      const btn = el('button', {
        padding: '3px 7px', fontSize: '9px', fontWeight: '600',
        border: 'none', borderRadius: '3px', cursor: 'pointer',
        background: '#333', color: '#ccc', fontFamily: 'inherit',
        textTransform: 'uppercase', letterSpacing: '0.3px',
      });
      btn.textContent = name;
      btn.addEventListener('click', () => applyPreset(name));
      btn.addEventListener('mouseenter', () => { btn.style.background = '#8b5cf6'; btn.style.color = '#fff'; });
      btn.addEventListener('mouseleave', () => { btn.style.background = '#333'; btn.style.color = '#ccc'; });
      presetRow.appendChild(btn);
    });
    C.appendChild(presetRow);

    // --- Displacement ---
    addSection(C, 'displacement');
    const displaceRow = el('div', { display: 'flex', gap: '3px', marginBottom: '8px' });
    DISPLACE_NAMES.forEach((name, i) => {
      const btn = el('button', {
        padding: '3px 6px', fontSize: '9px', fontWeight: '600',
        border: 'none', borderRadius: '3px', cursor: 'pointer',
        background: i === P.displace ? '#8b5cf6' : '#333',
        color: '#fff', fontFamily: 'inherit',
      });
      btn.textContent = name;
      btn.addEventListener('click', () => {
        P.displace = i;
        displaceRow.querySelectorAll('button').forEach((b, j) => {
          b.style.background = j === i ? '#8b5cf6' : '#333';
        });
      });
      displaceRow.appendChild(btn);
    });
    C.appendChild(displaceRow);
    addSlider(C, 'intensity', P.intensity, 0, 1, v => { P.intensity = v; });
    addSlider(C, 'frequency', P.frequency, 0, 1, v => { P.frequency = v; });
    addSlider(C, 'speed', P.speed, 0, 4, v => { P.speed = v; });

    // --- Feedback ---
    addSection(C, 'feedback');
    addSlider(C, 'mix', P.feedbackMix, 0, 0.98, v => { P.feedbackMix = v; });
    addSlider(C, 'zoom', P.feedbackZoom, 0.99, 1.02, v => { P.feedbackZoom = v; }, 0.001);
    addSlider(C, 'rotate', P.feedbackRotate, -0.05, 0.05, v => { P.feedbackRotate = v; }, 0.001);
    addBlendRow(C);

    // --- Color ---
    addSection(C, 'color');
    addSlider(C, 'hue shift', P.hueShift, 0, 1, v => { P.hueShift = v; });
    addSlider(C, 'saturation', P.saturation, 0, 3, v => { P.saturation = v; });
    addSlider(C, 'RGB split', P.rgbSplit, 0, 1, v => { P.rgbSplit = v; });
    addSlider(C, 'brightness', P.brightness, 0.2, 2, v => { P.brightness = v; });

    // --- Visual ---
    addSection(C, 'visual');
    addSlider(C, 'kaleidoscope', P.kaleidoscope, 0, 12, v => { P.kaleidoscope = Math.round(v); }, 1);
    addSlider(C, 'pixelate', P.pixelate, 0, 30, v => { P.pixelate = v; }, 1);
    addSlider(C, 'scanlines', P.scanlines, 0, 1, v => { P.scanlines = v; });
    addSlider(C, 'glitch', P.glitch, 0, 1, v => { P.glitch = v; });
    addMirrorRow(C);

    // --- LFOs ---
    addSection(C, 'LFOs');
    Object.keys(LFOs).forEach(key => {
      addLFORow(C, key);
    });

    // --- Actions ---
    addSection(C, 'actions');
    const actRow = el('div', { display: 'flex', gap: '6px', flexWrap: 'wrap' });
    actRow.appendChild(makeActionBtn('Recapture', recapture));
    actRow.appendChild(makeActionBtn('Save PNG', () => {
      if (!canvas) return;
      const link = document.createElement('a');
      link.download = 'morphizer-' + Date.now() + '.png';
      link.href = canvas.toDataURL('image/png');
      link.click();
      api.showToast('Saved');
    }));
    actRow.appendChild(makeActionBtn('Reset', () => applyPreset('clean')));
    C.appendChild(actRow);
  }

  // --- UI helpers ---
  function el(tag, styles) {
    const e = document.createElement(tag);
    if (styles) Object.assign(e.style, styles);
    return e;
  }

  function addSection(parent, text, first) {
    const s = el('div', {
      fontSize: '9px', fontWeight: '700', textTransform: 'uppercase',
      letterSpacing: '1px', color: '#666', marginBottom: '6px',
      marginTop: first ? '0' : '14px',
      paddingTop: first ? '0' : '10px',
      borderTop: first ? 'none' : '1px solid rgba(255,255,255,0.06)',
    });
    s.textContent = text;
    parent.appendChild(s);
  }

  const _sliderEls = {};
  function addSlider(parent, label, value, min, max, onChange, step) {
    const row = el('div', { marginBottom: '6px', display: 'flex', alignItems: 'center', gap: '8px' });
    const lbl = el('div', { fontSize: '10px', color: '#999', width: '70px', flexShrink: '0' });
    lbl.textContent = label;
    const input = document.createElement('input');
    input.type = 'range';
    input.min = min; input.max = max;
    input.step = step || ((max - min) / 100).toFixed(4);
    input.value = value;
    Object.assign(input.style, { flex: '1', height: '3px', accentColor: '#8b5cf6' });
    input.addEventListener('input', () => onChange(parseFloat(input.value)));
    row.appendChild(lbl);
    row.appendChild(input);
    parent.appendChild(row);
    _sliderEls[label] = input;
    return input;
  }

  function addBlendRow(parent) {
    const row = el('div', { display: 'flex', gap: '3px', marginTop: '6px' });
    BLEND_NAMES.forEach((name, i) => {
      const btn = el('button', {
        padding: '2px 5px', fontSize: '9px', border: 'none', borderRadius: '3px',
        cursor: 'pointer', background: i === P.blendMode ? '#8b5cf6' : '#333',
        color: '#fff', fontFamily: 'inherit',
      });
      btn.textContent = name;
      btn.addEventListener('click', () => {
        P.blendMode = i;
        row.querySelectorAll('button').forEach((b, j) => {
          b.style.background = j === i ? '#8b5cf6' : '#333';
        });
      });
      row.appendChild(btn);
    });
    parent.appendChild(row);
  }

  function addMirrorRow(parent) {
    const names = ['off', 'H', 'V', 'both'];
    const row = el('div', { display: 'flex', gap: '3px', alignItems: 'center', marginTop: '4px' });
    const lbl = el('div', { fontSize: '10px', color: '#999', width: '70px', flexShrink: '0' });
    lbl.textContent = 'mirror';
    row.appendChild(lbl);
    names.forEach((name, i) => {
      const btn = el('button', {
        padding: '2px 6px', fontSize: '9px', border: 'none', borderRadius: '3px',
        cursor: 'pointer', background: i === P.mirror ? '#8b5cf6' : '#333',
        color: '#fff', fontFamily: 'inherit',
      });
      btn.textContent = name;
      btn.addEventListener('click', () => {
        P.mirror = i;
        row.querySelectorAll('button').forEach((b, j) => {
          if (j === 0) return; // skip label
          b.style.background = (j - 1) === i ? '#8b5cf6' : '#333';
        });
      });
      row.appendChild(btn);
    });
    parent.appendChild(row);
  }

  function addLFORow(parent, key) {
    const lfo = LFOs[key];
    const row = el('div', { display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' });
    const toggle = el('button', {
      width: '14px', height: '14px', borderRadius: '50%', border: 'none',
      background: lfo.active ? '#8b5cf6' : '#444', cursor: 'pointer', padding: '0', flexShrink: '0',
    });
    toggle.addEventListener('click', () => {
      lfo.active = !lfo.active;
      toggle.style.background = lfo.active ? '#8b5cf6' : '#444';
    });
    const lbl = el('span', { fontSize: '10px', color: '#bbb', width: '60px' });
    lbl.textContent = key;
    row.appendChild(toggle);
    row.appendChild(lbl);
    parent.appendChild(row);
  }

  function makeActionBtn(text, onClick) {
    const btn = el('button', {
      padding: '4px 10px', fontSize: '10px', fontWeight: '600',
      border: 'none', borderRadius: '4px', cursor: 'pointer',
      background: '#333', color: '#fff', fontFamily: 'inherit',
    });
    btn.textContent = text;
    btn.addEventListener('click', onClick);
    btn.addEventListener('mouseenter', () => { btn.style.background = '#555'; });
    btn.addEventListener('mouseleave', () => { btn.style.background = '#333'; });
    return btn;
  }

  function applyPreset(name) {
    const p = PRESETS[name];
    if (!p) return;
    Object.assign(P, p);
    // Update sliders
    const map = {
      'intensity': P.intensity, 'frequency': P.frequency, 'speed': P.speed,
      'mix': P.feedbackMix, 'zoom': P.feedbackZoom, 'rotate': P.feedbackRotate,
      'hue shift': P.hueShift, 'saturation': P.saturation, 'RGB split': P.rgbSplit,
      'brightness': P.brightness, 'kaleidoscope': P.kaleidoscope,
      'pixelate': P.pixelate, 'scanlines': P.scanlines, 'glitch': P.glitch,
    };
    Object.entries(map).forEach(([label, val]) => {
      if (_sliderEls[label]) _sliderEls[label].value = val;
    });
    api.showToast('Preset: ' + name);
  }

  // --- Mouse ---
  function onMouseMove(e) {
    mouseX = e.clientX / window.innerWidth;
    mouseY = e.clientY / window.innerHeight;
  }

  // --- Plugin definition ---
  const plugin = {
    id: 'morphizer',
    label: 'Morphizer',
    enabledByDefault: true,

    button: {
      icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 3c2 3 3 6 3 9s-1 6-3 9"/><path d="M12 3c-2 3-3 6-3 9s1 6 3 9"/><path d="M3 12h18"/></svg>',
      tooltip: 'Morphizer',
      color: '#8b5cf6',
      order: 50,
    },

    init(pluginApi) { api = pluginApi; },

    async activate() {
      if (!panel) buildPanel();
      panel.style.display = 'block';

      // Init WebGL first (but don't show canvas yet)
      if (!gl) {
        if (!initGL()) { panel.style.display = 'none'; return; }
      }
      canvas.style.display = 'none'; // hidden during capture

      // Capture a single clean frame
      const ok = await captureFrame();
      if (!ok) { panel.style.display = 'none'; return; }

      // Upload snapshot and show canvas
      uploadSnapshot();
      canvas.style.display = 'block';

      startTime = performance.now();
      document.addEventListener('mousemove', onMouseMove);
      animFrame = requestAnimationFrame(render);
    },

    deactivate() {
      if (animFrame) { cancelAnimationFrame(animFrame); animFrame = null; }
      document.removeEventListener('mousemove', onMouseMove);
      if (canvas) canvas.style.display = 'none';
      if (panel) panel.style.display = 'none';
      frozen = false;
    },

    toggle() {
      if (canvas && canvas.style.display !== 'none') { this.deactivate(); return false; }
      this.activate();
      return true;
    },
  };

  // Register
  const dt = window.DomTools || (window.DomTools = { _pendingPlugins: [] });
  if (dt.registerPlugin) dt.registerPlugin(plugin);
  else dt._pendingPlugins.push(plugin);
})();

/**
 * Spacing Debugger Plugin
 * Page-wide margin (orange) and padding (green) overlays for all visible elements.
 * No hover required — global X-ray for spacing consistency.
 */
(function () {
  const MARGIN_COLOR = 'rgba(255, 165, 0, 0.25)';
  const PADDING_COLOR = 'rgba(144, 238, 144, 0.3)';
  const LABEL_BG = 'rgba(0,0,0,0.7)';
  const MAX_ELEMENTS = 120;
  const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'BR', 'HR', 'LINK', 'META', 'HEAD', 'HTML']);

  let container = null;
  let panel = null;
  let active = false;
  let api = null;
  let rafId = null;
  let showLabels = false;
  let mode = 'both'; // 'both' | 'margin' | 'padding'

  function createContainer() {
    container = document.createElement('div');
    container.id = 'dt-spacing-overlays';
    container.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:2147483639;';
    document.body.appendChild(container);
  }

  function createPanel() {
    panel = document.createElement('div');
    panel.id = 'dt-spacing-panel';
    panel.setAttribute('data-dt-ignore', '');
    panel.style.cssText = `
      position:fixed;bottom:60px;right:16px;z-index:2147483641;
      background:rgba(20,20,30,0.92);color:#e0e0e0;
      font:11px/1.6 'SF Mono',Menlo,monospace;
      padding:10px 14px;border-radius:8px;
      box-shadow:0 4px 16px rgba(0,0,0,0.3);
      pointer-events:auto;user-select:none;
    `;
    panel.innerHTML = buildPanelHTML();
    document.body.appendChild(panel);
    bindPanel();
  }

  function buildPanelHTML() {
    return `
      <div style="margin-bottom:6px;font-weight:600;font-size:12px;">Spacing Debugger</div>
      <label style="display:block;cursor:pointer;margin:3px 0;">
        <input type="checkbox" id="dt-sp-labels" ${showLabels ? 'checked' : ''}> Show labels
      </label>
      <div style="margin:6px 0 3px;">
        <label style="cursor:pointer;margin-right:8px;"><input type="radio" name="dt-sp-mode" value="both" ${mode === 'both' ? 'checked' : ''}> Both</label>
        <label style="cursor:pointer;margin-right:8px;"><input type="radio" name="dt-sp-mode" value="margin" ${mode === 'margin' ? 'checked' : ''}> Margin</label>
        <label style="cursor:pointer;"><input type="radio" name="dt-sp-mode" value="padding" ${mode === 'padding' ? 'checked' : ''}> Padding</label>
      </div>
      <div id="dt-sp-count" style="margin-top:6px;color:#888;font-size:10px;"></div>
    `;
  }

  function bindPanel() {
    panel.querySelector('#dt-sp-labels').addEventListener('change', (e) => {
      showLabels = e.target.checked;
      refresh();
    });
    panel.querySelectorAll('input[name="dt-sp-mode"]').forEach(r => {
      r.addEventListener('change', (e) => {
        mode = e.target.value;
        refresh();
      });
    });
  }

  function getVisibleElements() {
    const all = document.body.querySelectorAll('*');
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const results = [];

    for (let i = 0; i < all.length && results.length < MAX_ELEMENTS; i++) {
      const el = all[i];
      if (SKIP_TAGS.has(el.tagName)) continue;
      if (el.closest('#dt-spacing-overlays, #dt-spacing-panel, #dom-tools-toolbar, [data-dt-ignore]')) continue;

      const rect = el.getBoundingClientRect();
      if (rect.width < 10 || rect.height < 10) continue;
      if (rect.bottom < 0 || rect.top > vh || rect.right < 0 || rect.left > vw) continue;

      const cs = getComputedStyle(el);
      const mt = parseFloat(cs.marginTop) || 0;
      const mr = parseFloat(cs.marginRight) || 0;
      const mb = parseFloat(cs.marginBottom) || 0;
      const ml = parseFloat(cs.marginLeft) || 0;
      const pt = parseFloat(cs.paddingTop) || 0;
      const pr = parseFloat(cs.paddingRight) || 0;
      const pb = parseFloat(cs.paddingBottom) || 0;
      const pl = parseFloat(cs.paddingLeft) || 0;

      const hasMargin = mt || mr || mb || ml;
      const hasPadding = pt || pr || pb || pl;
      if (!hasMargin && !hasPadding) continue;

      results.push({
        rect, el,
        margin: { top: mt, right: mr, bottom: mb, left: ml },
        padding: { top: pt, right: pr, bottom: pb, left: pl },
        bt: parseFloat(cs.borderTopWidth) || 0,
        br: parseFloat(cs.borderRightWidth) || 0,
        bb: parseFloat(cs.borderBottomWidth) || 0,
        bl: parseFloat(cs.borderLeftWidth) || 0,
      });
    }
    return results;
  }

  function renderSpacingOverlays() {
    container.innerHTML = '';
    const elements = getVisibleElements();

    elements.forEach(({ rect, margin, padding, bt, br, bb, bl }) => {
      if (mode === 'both' || mode === 'margin') {
        // Top margin
        if (margin.top) addBox(rect.left, rect.top - margin.top, rect.width, margin.top, MARGIN_COLOR, showLabels ? margin.top : null);
        // Bottom margin
        if (margin.bottom) addBox(rect.left, rect.bottom, rect.width, margin.bottom, MARGIN_COLOR, showLabels ? margin.bottom : null);
        // Left margin
        if (margin.left) addBox(rect.left - margin.left, rect.top, margin.left, rect.height, MARGIN_COLOR, showLabels ? margin.left : null);
        // Right margin
        if (margin.right) addBox(rect.right, rect.top, margin.right, rect.height, MARGIN_COLOR, showLabels ? margin.right : null);
      }

      if (mode === 'both' || mode === 'padding') {
        const innerTop = rect.top + bt;
        const innerLeft = rect.left + bl;
        const innerW = rect.width - bl - br;
        const innerH = rect.height - bt - bb;

        // Top padding
        if (padding.top) addBox(innerLeft, innerTop, innerW, padding.top, PADDING_COLOR, showLabels ? padding.top : null);
        // Bottom padding
        if (padding.bottom) addBox(innerLeft, innerTop + innerH - padding.bottom, innerW, padding.bottom, PADDING_COLOR, showLabels ? padding.bottom : null);
        // Left padding
        if (padding.left) addBox(innerLeft, innerTop, padding.left, innerH, PADDING_COLOR, showLabels ? padding.left : null);
        // Right padding
        if (padding.right) addBox(innerLeft + innerW - padding.right, innerTop, padding.right, innerH, PADDING_COLOR, showLabels ? padding.right : null);
      }
    });

    const countEl = panel && panel.querySelector('#dt-sp-count');
    if (countEl) countEl.textContent = `${elements.length} elements`;
  }

  function addBox(x, y, w, h, color, label) {
    if (w <= 0 || h <= 0) return;
    const d = document.createElement('div');
    d.style.cssText = `position:fixed;top:${y}px;left:${x}px;width:${w}px;height:${h}px;background:${color};`;

    if (label !== null && (w >= 18 || h >= 18)) {
      const lbl = document.createElement('span');
      lbl.textContent = Math.round(label);
      lbl.style.cssText = `
        position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);
        font:9px/1 'SF Mono',Menlo,monospace;color:#fff;
        background:${LABEL_BG};padding:1px 3px;border-radius:2px;
      `;
      d.appendChild(lbl);
    }
    container.appendChild(d);
  }

  function refresh() {
    if (!active) return;
    renderSpacingOverlays();
  }

  function onScrollOrResize() {
    if (rafId) return;
    rafId = requestAnimationFrame(() => {
      rafId = null;
      refresh();
    });
  }

  // --- Plugin interface ---
  const plugin = {
    id: 'spacing-debugger',
    label: 'Spacing',
    icon: `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 3H3v18h18V3z"/><path d="M9 3v18M15 3v18M3 9h18M3 15h18"/></svg>`,

    toggle() {
      if (active) { this.deactivate(); return false; }
      else { this.activate(this._api); return true; }
    },

    activate(_api) {
      if (_api) api = _api;
      active = true;
      createContainer();
      createPanel();
      renderSpacingOverlays();
      window.addEventListener('scroll', onScrollOrResize, true);
      window.addEventListener('resize', onScrollOrResize);
    },

    deactivate() {
      active = false;
      window.removeEventListener('scroll', onScrollOrResize, true);
      window.removeEventListener('resize', onScrollOrResize);
      if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
      if (container) { container.remove(); container = null; }
      if (panel) { panel.remove(); panel = null; }
    },
  };

  if (window.DomTools) {
    window.DomTools.registerPlugin(plugin);
  }
})();
