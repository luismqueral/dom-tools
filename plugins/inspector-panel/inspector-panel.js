/**
 * Inspector Panel plugin — shows computed styles and CSS tokens for the
 * currently selected element in a draggable floating panel.
 * Token values are clickable — opens a combobox to swap tokens live.
 *
 * Prototype for issue #50.
 */
(function () {
  'use strict';

  const TOKEN_RE = /var\((--[\w-]+)/;

  // --- Token resolution (mirrors style-modifier.js logic) ---

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

  // Determine token family: '--sp-4' → 'sp', '--nyt-fg-dim' → 'nyt-fg', '--ts-xl' → 'ts'
  // Heuristic: last segment is the "value" (number, size name, modifier).
  // Family = everything before the last segment.
  function getFamily(tokenName) {
    const bare = tokenName.replace(/^--/, '');
    const parts = bare.split('-');
    if (parts.length <= 1) return bare;
    // Try progressively shorter prefixes — family is the longest prefix
    // that has at least one sibling. Since we call this during discovery,
    // just use "all but last segment" as the family.
    return parts.slice(0, -1).join('-');
  }

  function getFamilyTokens(tokenName) {
    const families = discoverTokenFamilies();
    const family = getFamily(tokenName);
    return families[family] || [];
  }

  // --- Token editing ---

  // Track original values for undo + copy-all
  const changes = []; // { el, prop, from, to, selector }

  function applyToken(el, cssProp, newToken, oldToken) {
    // Store original inline value if first edit on this prop
    if (!el._dtOrigStyles) el._dtOrigStyles = {};
    if (!(cssProp in el._dtOrigStyles)) {
      el._dtOrigStyles[cssProp] = el.style.getPropertyValue(cssProp) || '';
    }
    el.style.setProperty(cssProp, `var(${newToken})`);

    // Track change
    const existing = changes.find(c => c.el === el && c.prop === cssProp);
    if (existing) {
      existing.to = newToken;
    } else {
      changes.push({
        el,
        prop: cssProp,
        from: oldToken || el._dtOrigStyles[cssProp],
        to: newToken,
        selector: api.getSelector(el),
      });
    }

    // Expose for copy-all
    window.DomTools._inspectorChanges = changes;
  }

  // --- Combobox / Token Picker ---

  let activePicker = null;

  function closePicker() {
    if (activePicker) {
      activePicker.remove();
      activePicker = null;
    }
    document.removeEventListener('mousedown', onPickerOutsideClick, true);
  }

  function onPickerOutsideClick(e) {
    if (activePicker && !activePicker.contains(e.target)) {
      closePicker();
    }
  }

  function openTokenPicker(prop, currentToken, anchorEl, targetEl) {
    closePicker();

    const tokens = getFamilyTokens(currentToken);
    if (tokens.length === 0) return;

    const picker = document.createElement('div');
    activePicker = picker;
    Object.assign(picker.style, {
      position: 'absolute',
      top: '0', left: '0',
      width: '220px',
      background: 'rgba(20,20,20,0.98)',
      border: '1px solid rgba(255,255,255,0.15)',
      borderRadius: '6px',
      boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
      zIndex: '999999',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      fontSize: '11px',
      color: '#fff',
      overflow: 'hidden',
    });

    // Search input
    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = 'Filter tokens…';
    input.value = '';
    Object.assign(input.style, {
      width: '100%',
      padding: '8px 10px',
      background: 'rgba(255,255,255,0.05)',
      border: 'none',
      borderBottom: '1px solid rgba(255,255,255,0.1)',
      color: '#fff',
      fontSize: '11px',
      fontFamily: 'inherit',
      outline: 'none',
      boxSizing: 'border-box',
    });
    picker.appendChild(input);

    // List container
    const list = document.createElement('div');
    Object.assign(list.style, {
      maxHeight: '200px',
      overflowY: 'auto',
      padding: '4px 0',
    });
    picker.appendChild(list);

    let highlighted = -1;
    let filteredTokens = tokens;

    function updateHighlight() {
      const rows = list.children;
      for (let i = 0; i < rows.length; i++) {
        const isCurrent = rows[i]._tokenName === currentToken;
        rows[i].style.background = i === highlighted
          ? 'rgba(255,255,255,0.1)'
          : (isCurrent ? 'rgba(251,191,36,0.1)' : 'transparent');
      }
    }

    function renderList() {
      list.innerHTML = '';
      filteredTokens = tokens.filter(t =>
        t.name.toLowerCase().includes(input.value.toLowerCase()) ||
        t.value.toLowerCase().includes(input.value.toLowerCase())
      );
      filteredTokens.forEach((t, i) => {
        const row = document.createElement('div');
        row._tokenName = t.name;
        const isCurrent = t.name === currentToken;
        Object.assign(row.style, {
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '5px 10px',
          cursor: 'pointer',
          background: isCurrent ? 'rgba(251,191,36,0.1)' : 'transparent',
          borderLeft: isCurrent ? '2px solid #fbbf24' : '2px solid transparent',
        });
        row.addEventListener('mouseenter', () => {
          highlighted = i;
          updateHighlight();
        });
        row.addEventListener('click', (e) => {
          e.stopPropagation();
          selectToken(t.name);
        });

        const nameSpan = document.createElement('span');
        nameSpan.textContent = t.name;
        Object.assign(nameSpan.style, {
          color: isCurrent ? '#fbbf24' : '#fff',
          fontWeight: isCurrent ? '600' : '400',
        });

        const valSpan = document.createElement('span');
        valSpan.textContent = t.value;
        Object.assign(valSpan.style, {
          color: 'rgba(255,255,255,0.4)',
          fontSize: '10px',
          marginLeft: '8px',
          flexShrink: '0',
        });

        row.appendChild(nameSpan);
        row.appendChild(valSpan);
        list.appendChild(row);
      });
    }

    function selectToken(tokenName) {
      applyToken(targetEl, prop, tokenName, currentToken);
      closePicker();
      // Re-render panel with new values
      renderPanel(targetEl);
    }

    input.addEventListener('input', () => {
      highlighted = -1;
      renderList();
    });

    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        highlighted = Math.min(highlighted + 1, filteredTokens.length - 1);
        renderList();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        highlighted = Math.max(highlighted - 1, 0);
        renderList();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (highlighted >= 0 && highlighted < filteredTokens.length) {
          selectToken(filteredTokens[highlighted].name);
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        closePicker();
      }
    });

    renderList();

    // Position relative to content area
    content.style.position = 'relative';
    const anchorRect = anchorEl.getBoundingClientRect();
    const contentRect = content.getBoundingClientRect();
    picker.style.top = (anchorRect.bottom - contentRect.top + content.scrollTop + 2) + 'px';
    picker.style.left = Math.max(0, anchorRect.left - contentRect.left - 40) + 'px';

    content.appendChild(picker);
    input.focus();

    // Close on outside click (delayed to avoid catching the opening click)
    setTimeout(() => {
      document.addEventListener('mousedown', onPickerOutsideClick, true);
    }, 0);
  }

  // Properties we inspect — grouped by category
  const PROPERTY_GROUPS = [
    {
      label: 'Layout',
      props: ['display', 'position', 'top', 'right', 'bottom', 'left',
              'width', 'height', 'min-width', 'max-width', 'min-height', 'max-height',
              'overflow', 'z-index'],
    },
    {
      label: 'Spacing',
      props: ['padding-top', 'padding-right', 'padding-bottom', 'padding-left',
              'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
              'gap', 'row-gap', 'column-gap'],
    },
    {
      label: 'Flex / Grid',
      props: ['flex-direction', 'flex-wrap', 'justify-content', 'align-items',
              'align-self', 'flex-grow', 'flex-shrink', 'flex-basis',
              'grid-template-columns', 'grid-template-rows', 'grid-column', 'grid-row'],
    },
    {
      label: 'Typography',
      props: ['font-family', 'font-size', 'font-weight', 'line-height',
              'letter-spacing', 'text-align', 'text-transform', 'color'],
    },
    {
      label: 'Background & Border',
      props: ['background', 'background-color', 'border', 'border-radius',
              'box-shadow', 'opacity'],
    },
  ];

  // Resolve tokens for ALL properties (not just spacing)
  function resolveAllTokens(el) {
    const tokens = {};
    for (let s = 0; s < document.styleSheets.length; s++) {
      let rules;
      try { rules = document.styleSheets[s].cssRules; } catch (_) { continue; }
      if (!rules) continue;
      processRules(rules, el, tokens);
    }
    // Inline styles always win
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
    // Check shorthands for box model
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
    // Check all explicitly set properties
    for (let i = 0; i < style.length; i++) {
      const prop = style[i];
      const raw = style.getPropertyValue(prop);
      if (raw && TOKEN_RE.test(raw)) {
        tokens[prop] = extractToken(raw);
      }
    }
  }

  // --- Panel rendering ---

  let panel = null;
  let content = null;
  let api = null;
  let lastEl = null;

  function renderPanel(el) {
    if (!el || !content) return;
    lastEl = el;
    closePicker();

    const computed = window.getComputedStyle(el);
    const tokens = resolveAllTokens(el);
    const selector = api.getSelector(el);

    // Build DOM instead of innerHTML so we can attach click handlers
    content.innerHTML = '';

    // Selector header
    const headerDiv = document.createElement('div');
    Object.assign(headerDiv.style, { marginBottom: '10px', paddingBottom: '8px', borderBottom: '1px solid rgba(255,255,255,0.1)' });
    const selectorLabel = document.createElement('div');
    Object.assign(selectorLabel.style, { fontSize: '10px', color: 'rgba(255,255,255,0.5)', marginBottom: '2px' });
    selectorLabel.textContent = 'SELECTOR';
    const selectorCode = document.createElement('code');
    Object.assign(selectorCode.style, { fontSize: '11px', color: '#7dd3fc', wordBreak: 'break-all' });
    selectorCode.textContent = selector;
    headerDiv.appendChild(selectorLabel);
    headerDiv.appendChild(selectorCode);
    content.appendChild(headerDiv);

    // Tag + classes
    const tagDiv = document.createElement('div');
    Object.assign(tagDiv.style, { marginBottom: '10px', fontSize: '11px' });
    const tag = el.tagName.toLowerCase();
    const classes = el.classList.length ? '.' + Array.from(el.classList).join('.') : '';
    const tagSpan = document.createElement('span');
    tagSpan.style.color = '#c084fc';
    tagSpan.textContent = tag;
    tagDiv.appendChild(tagSpan);
    if (classes) {
      const classSpan = document.createElement('span');
      classSpan.style.color = '#86efac';
      classSpan.textContent = classes;
      tagDiv.appendChild(classSpan);
    }
    content.appendChild(tagDiv);

    // Property groups
    for (const group of PROPERTY_GROUPS) {
      const rows = [];
      for (const prop of group.props) {
        const val = computed.getPropertyValue(prop);
        if (!val || val === 'none' || val === 'normal' || val === 'auto' || val === '0px' || val === 'static') continue;
        if (prop === 'display' && val === 'block') continue;
        if (prop === 'overflow' && val === 'visible') continue;
        const token = tokens[prop] || null;
        rows.push({ prop, val, token });
      }
      if (rows.length === 0) continue;

      const groupDiv = document.createElement('div');
      groupDiv.style.marginBottom = '8px';
      const groupLabel = document.createElement('div');
      Object.assign(groupLabel.style, { fontSize: '9px', fontWeight: '700', color: 'rgba(255,255,255,0.4)', letterSpacing: '0.5px', marginBottom: '4px' });
      groupLabel.textContent = group.label.toUpperCase();
      groupDiv.appendChild(groupLabel);

      for (const row of rows) {
        const rowDiv = document.createElement('div');
        Object.assign(rowDiv.style, { display: 'flex', gap: '6px', alignItems: 'baseline', padding: '2px 0', fontSize: '11px' });

        const propSpan = document.createElement('span');
        Object.assign(propSpan.style, { color: 'rgba(255,255,255,0.6)', minWidth: '110px', flexShrink: '0' });
        propSpan.textContent = row.prop;
        rowDiv.appendChild(propSpan);

        const valSpan = document.createElement('span');
        Object.assign(valSpan.style, { color: '#fff', wordBreak: 'break-all' });
        valSpan.textContent = truncate(row.val, 60);
        rowDiv.appendChild(valSpan);

        if (row.token) {
          const tokenSpan = document.createElement('span');
          Object.assign(tokenSpan.style, {
            color: '#fbbf24',
            fontSize: '10px',
            whiteSpace: 'nowrap',
            cursor: 'pointer',
            padding: '1px 4px',
            borderRadius: '3px',
            background: 'rgba(251,191,36,0.1)',
            marginLeft: 'auto',
          });
          tokenSpan.textContent = row.token + ' ▾';
          tokenSpan.addEventListener('click', (e) => {
            e.stopPropagation();
            openTokenPicker(row.prop, row.token, tokenSpan, el);
          });
          rowDiv.appendChild(tokenSpan);
        }

        groupDiv.appendChild(rowDiv);
      }
      content.appendChild(groupDiv);
    }

    // Custom properties defined on the element
    const customProps = getInlineCustomProps(el);
    if (customProps.length > 0) {
      const cpDiv = document.createElement('div');
      cpDiv.style.marginBottom = '8px';
      const cpLabel = document.createElement('div');
      Object.assign(cpLabel.style, { fontSize: '9px', fontWeight: '700', color: 'rgba(255,255,255,0.4)', letterSpacing: '0.5px', marginBottom: '4px' });
      cpLabel.textContent = 'CUSTOM PROPERTIES';
      cpDiv.appendChild(cpLabel);

      for (const { name, value } of customProps) {
        const row = document.createElement('div');
        Object.assign(row.style, { display: 'flex', gap: '6px', alignItems: 'baseline', padding: '2px 0', fontSize: '11px' });
        const nameSpan = document.createElement('span');
        nameSpan.style.color = '#fbbf24';
        nameSpan.textContent = name;
        const valSpan = document.createElement('span');
        valSpan.style.color = '#fff';
        valSpan.textContent = truncate(value, 60);
        row.appendChild(nameSpan);
        row.appendChild(valSpan);
        cpDiv.appendChild(row);
      }
      content.appendChild(cpDiv);
    }
  }

  function getInlineCustomProps(el) {
    const props = [];
    if (!el.style || !el.style.length) return props;
    for (let i = 0; i < el.style.length; i++) {
      const name = el.style[i];
      if (name.startsWith('--')) {
        props.push({ name, value: el.style.getPropertyValue(name) });
      }
    }
    return props;
  }

  function truncate(str, max) {
    return str.length > max ? str.slice(0, max) + '…' : str;
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

    init(_api) {
      console.log('[inspector-panel] Plugin initialized');
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
      });
      panel.style.display = 'none';
      startPolling();

      // Initialize change tracking
      window.DomTools._inspectorChanges = changes;
    },

    enable() {},

    disable() {
      stopPolling();
      closePicker();
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
