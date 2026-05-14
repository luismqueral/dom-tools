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
  const plugin = {
    id: 'dev-panel',
    label: 'Dev Panel',
    icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>',

    activate(_api) {
      if (active) return;
      active = true;
      api = _api;

      // Use the createPanel helper from the plugin API
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

    deactivate() {
      if (!active) return;
      active = false;

      // Stop polling
      if (rafId) { cancelAnimationFrame(rafId); rafId = null; }

      // Remove keydown listener
      document.removeEventListener('keydown', onKeyDown, true);

      // Unpatch animate
      unpatchAnimate();

      // Stop toast observer
      stopToastObserver();

      // Remove panel
      if (panel) {
        panel.style.display = 'none';
        panel.remove();
        panel = null;
      }

      stateGrid = null;
      keyLog = null;
      animLog = null;
    },
  };

  if (window.DomTools) {
    window.DomTools.registerPlugin(plugin);
  }
})();
