/**
 * DOM-Tools Dev Panel
 * Non-invasive instrumentation that observes DOM-Tools state by watching
 * the DOM for telltale signals. Runs inside a shadow DOM so DOM-Tools
 * ignores it entirely.
 */
(function () {
  'use strict';

  const mount = document.getElementById('dev-panel-mount');
  if (!mount) return;

  // Mark the mount so DOM-Tools skips it
  mount.setAttribute('data-dt-ignore', '');

  const shadow = mount.attachShadow({ mode: 'open' });

  // --- Styles ---
  const style = document.createElement('style');
  style.textContent = `
    :host { display: block; }
    .panel {
      background: rgba(30,30,30,0.85);
      backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);
      color: #e5e7eb;
      border-radius: 10px; padding: 0;
      font-family: system-ui, -apple-system, sans-serif;
      font-size: 11px; line-height: 1.5;
      max-height: calc(100vh - 32px);
      overflow-y: auto;
      box-shadow: 0 4px 20px rgba(0,0,0,0.3);
      user-select: none; -webkit-user-select: none;
    }
    .panel.collapsed .panel-body { display: none; }
    .panel.collapsed { overflow: hidden; }
    .panel-header {
      display: flex; align-items: center; gap: 6px;
      padding: 10px 14px; cursor: grab;
    }
    .panel-header:active { cursor: grabbing; }
    .panel-header .grip {
      color: rgba(255,255,255,0.35); font-size: 14px; line-height: 1;
    }
    .panel-header .title {
      flex: 1;
      color: rgba(255,255,255,0.5); font-size: 11px; font-weight: 600;
      letter-spacing: 0.5px; text-transform: uppercase;
    }
    .collapse-btn {
      background: none; border: none; color: rgba(255,255,255,0.35); cursor: pointer;
      font-size: 12px; padding: 2px 4px; line-height: 1; border-radius: 4px;
    }
    .collapse-btn:hover { color: #fff; background: rgba(255,255,255,0.1); }
    .panel-body { padding: 10px 14px; }
    .section { margin-bottom: 14px; }
    .section-title {
      font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px;
      color: rgba(255,255,255,0.4); margin: 0 0 6px; font-weight: 600;
    }

    /* State mirror */
    .state-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 8px; }
    .state-row { display: flex; justify-content: space-between; align-items: center; }
    .state-key { color: rgba(255,255,255,0.4); }
    .state-val { font-weight: 600; }
    .state-val.on { color: #34d399; }
    .state-val.off { color: rgba(255,255,255,0.25); }

    /* Key log */
    .key-log {
      max-height: 160px; overflow-y: auto;
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

    /* Animation log */
    .anim-log {
      max-height: 120px; overflow-y: auto;
      background: rgba(0,0,0,0.3); border-radius: 6px;
      padding: 6px 8px;
    }
    .anim-entry { color: #6ee7b7; padding: 2px 0; border-bottom: 1px solid rgba(255,255,255,0.06); }
    .anim-entry:last-child { border-bottom: none; }
    .anim-entry .anim-time { color: rgba(255,255,255,0.25); font-size: 10px; }

    /* Controls */
    .controls { display: flex; gap: 6px; flex-wrap: wrap; }
    .btn {
      padding: 4px 10px; border: none;
      background: rgba(255,255,255,0.1); color: #e5e7eb;
      border-radius: 6px; cursor: pointer; font-size: 10px;
      font-family: inherit; transition: background 0.15s;
    }
    .btn:hover { background: rgba(255,255,255,0.18); }
    .btn.active { background: #2563eb; color: white; }

    /* Scrollbar */
    ::-webkit-scrollbar { width: 4px; }
    ::-webkit-scrollbar-track { background: transparent; }
    ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.15); border-radius: 2px; }
  `;
  shadow.appendChild(style);

  // --- Panel DOM ---
  const panel = document.createElement('div');
  panel.className = 'panel';
  panel.innerHTML = `
    <div class="panel-header" id="panel-header">
      <span class="grip">\u283F</span>
      <span class="title">Dev Panel</span>
      <button class="collapse-btn" id="collapse-btn" title="Collapse">&#x25B4;</button>
    </div>
    <div class="panel-body">
      <div class="section">
        <div class="section-title">State</div>
        <div class="state-grid" id="state-grid"></div>
      </div>

      <div class="section">
        <div class="section-title" style="display:flex;justify-content:space-between;align-items:center;">
          Key Events <span class="btn" id="clear-keys" style="margin:0;padding:2px 6px;">Clear</span>
        </div>
        <div class="key-log" id="key-log"></div>
      </div>

      <div class="section">
        <div class="section-title">Animations</div>
        <div class="anim-log" id="anim-log"></div>
      </div>

      <div class="section">
        <div class="section-title">Controls</div>
        <div class="controls">
          <button class="btn" id="btn-toggle">Toggle (Esc+Esc)</button>
          <button class="btn" id="btn-reboot">Reboot</button>
        </div>
      </div>
    </div>
  `;
  shadow.appendChild(panel);

  // --- Collapse ---
  const collapseBtn = shadow.getElementById('collapse-btn');
  collapseBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    panel.classList.toggle('collapsed');
    collapseBtn.innerHTML = panel.classList.contains('collapsed') ? '&#x25BE;' : '&#x25B4;';
    collapseBtn.title = panel.classList.contains('collapsed') ? 'Expand' : 'Collapse';
  });

  // --- Drag ---
  const header = shadow.getElementById('panel-header');
  let dragging = false, dx = 0, dy = 0;

  header.addEventListener('mousedown', (e) => {
    if (e.target === collapseBtn) return;
    dragging = true;
    const rect = mount.getBoundingClientRect();
    dx = e.clientX - rect.left;
    dy = e.clientY - rect.top;
    e.preventDefault();
  });

  document.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    let x = e.clientX - dx;
    let y = e.clientY - dy;
    x = Math.max(0, Math.min(x, window.innerWidth - mount.offsetWidth));
    y = Math.max(0, Math.min(y, window.innerHeight - mount.offsetHeight));
    mount.style.left = x + 'px';
    mount.style.top = y + 'px';
    mount.style.right = 'auto';
  });

  document.addEventListener('mouseup', () => { dragging = false; });

  const stateGrid = shadow.getElementById('state-grid');
  const keyLog = shadow.getElementById('key-log');
  const animLog = shadow.getElementById('anim-log');

  // --- State Mirror ---
  const stateChecks = [
    { label: 'Enabled', detect: () => !document.documentElement.classList.contains('dt-disabled') },
    { label: 'Toolbar', detect: () => !!document.querySelector('[data-dt-toolbar]') },
    { label: 'Bubble', detect: () => !!document.querySelector('[data-dt-bubble]') },
    { label: 'Edit Mode', detect: () => document.documentElement.classList.contains('dt-edit-active') || !!document.querySelector('[contenteditable][data-dt-editing]') },
    { label: 'Draw Mode', detect: () => !!document.querySelector('canvas[data-dt-draw]') },
    { label: 'Camera', detect: () => !!document.querySelector('[data-dt-camera-active]') },
    { label: 'Selected', detect: () => document.querySelectorAll('[data-dt-selected]').length },
    { label: 'Hovered', detect: () => { const h = document.querySelector('[data-dt-hovered]'); return h ? h.tagName.toLowerCase() : '—'; } },
  ];

  function renderState() {
    stateGrid.innerHTML = stateChecks.map(s => {
      const val = s.detect();
      const display = typeof val === 'boolean' ? (val ? 'ON' : 'OFF') : val;
      const cls = val === true || (typeof val === 'number' && val > 0) ? 'on' : 'off';
      return `<div class="state-row"><span class="state-key">${s.label}</span><span class="state-val ${cls}">${display}</span></div>`;
    }).join('');
  }

  // Poll state via rAF
  function tick() {
    renderState();
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  // --- Key Event Log ---
  const SHORTCUTS = ['Escape', 'T', 'C', 'S', 'K'];
  const MAX_KEY_ENTRIES = 50;
  let keyEntries = [];

  function formatTime() {
    const d = new Date();
    return `${d.getMinutes().toString().padStart(2, '0')}:${d.getSeconds().toString().padStart(2, '0')}.${d.getMilliseconds().toString().padStart(3, '0')}`;
  }

  document.addEventListener('keydown', (e) => {
    const mods = [e.metaKey && 'Cmd', e.ctrlKey && 'Ctrl', e.shiftKey && 'Shift', e.altKey && 'Alt'].filter(Boolean).join('+');
    const isShortcut = SHORTCUTS.includes(e.key) && (e.shiftKey || e.metaKey || e.ctrlKey || e.key === 'Escape');
    keyEntries.unshift({ key: e.key, mods, target: e.target.tagName.toLowerCase(), time: formatTime(), shortcut: isShortcut });
    if (keyEntries.length > MAX_KEY_ENTRIES) keyEntries.pop();
    renderKeyLog();
  }, true);

  function renderKeyLog() {
    keyLog.innerHTML = keyEntries.map(e =>
      `<div class="key-entry${e.shortcut ? ' shortcut' : ''}">` +
      `<span class="time">${e.time}</span> ` +
      `<span class="key">${e.key}</span>` +
      (e.mods ? ` <span class="mods">${e.mods}</span>` : '') +
      ` <span class="target">&lt;${e.target}&gt;</span>` +
      `</div>`
    ).join('');
  }

  shadow.getElementById('clear-keys').addEventListener('click', () => {
    keyEntries = [];
    renderKeyLog();
  });

  // --- Animation Interception ---
  const MAX_ANIM_ENTRIES = 30;
  let animEntries = [];
  const origAnimate = Element.prototype.animate;

  Element.prototype.animate = function (keyframes, options) {
    const el = this;
    // Only log if it looks like a nudge (short, translateY)
    const isNudge = Array.isArray(keyframes) && keyframes.some(k => k.transform && /translateY/i.test(k.transform));
    if (isNudge) {
      const tag = el.tagName.toLowerCase() + (el.className ? '.' + el.className.split(' ')[0] : '');
      const dur = typeof options === 'number' ? options : (options && options.duration) || '?';
      animEntries.unshift({ tag, duration: dur + 'ms', time: formatTime() });
      if (animEntries.length > MAX_ANIM_ENTRIES) animEntries.pop();
      renderAnimLog();
    }
    return origAnimate.call(this, keyframes, options);
  };

  // Also watch for toasts
  const observer = new MutationObserver((mutations) => {
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
  observer.observe(document.body, { childList: true, subtree: true });

  function renderAnimLog() {
    animLog.innerHTML = animEntries.map(e =>
      `<div class="anim-entry"><span class="anim-time">${e.time}</span> ${e.tag} <span style="color:#9ca3af">${e.duration}</span></div>`
    ).join('');
  }

  // --- Controls ---
  shadow.getElementById('btn-toggle').addEventListener('click', () => {
    // Simulate double-Esc
    const ev1 = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true });
    const ev2 = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true });
    document.dispatchEvent(ev1);
    setTimeout(() => document.dispatchEvent(ev2), 50);
  });

  shadow.getElementById('btn-reboot').addEventListener('click', () => {
    // Remove toolbar and re-trigger boot by reloading the script
    const toolbar = document.querySelector('[data-dt-toolbar]');
    if (toolbar) toolbar.remove();
    document.documentElement.classList.remove('dt-disabled');
    // Re-inject the bundle
    const oldScript = document.querySelector('script[src*="dom-tools"]');
    if (oldScript) {
      const newScript = document.createElement('script');
      newScript.src = oldScript.src + '?t=' + Date.now();
      oldScript.parentNode.insertBefore(newScript, oldScript.nextSibling);
    }
  });
})();
