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
  }

  function resetProp(el, cssProp) {
    el.style.removeProperty(cssProp);
    const idx = changes.findIndex(c => c.el === el && c.prop === cssProp);
    if (idx >= 0) changes.splice(idx, 1);
    window.DomTools._inspectorChanges = changes;
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

    const wrapper = el('div', { marginBottom: '10px' });

    // Label
    const label = el('div', {
      fontSize: '9px', fontWeight: '600', letterSpacing: '0.3px',
      color: accentColor + '0.7)', marginBottom: '4px', textAlign: 'center',
    });
    label.textContent = type;
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

    const sides = ['top', 'right', 'bottom', 'left'];
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
      display: 'flex', gap: '6px', alignItems: 'baseline',
      padding: '2px 0', fontSize: '11px',
    });
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
